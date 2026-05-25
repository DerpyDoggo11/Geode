import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getItem, getDropLightColor, allItems } from './items';

const loader = new GLTFLoader();
const modelCache = new Map<string, THREE.Object3D>();

async function loadDropModel(path: string): Promise<THREE.Object3D> {
  const cached = modelCache.get(path);
  if (cached) return cached.clone(true);
  const gltf = await loader.loadAsync(path);
  modelCache.set(path, gltf.scene);
  return gltf.scene.clone(true);
}

// Eagerly fetch every item GLB so the first drop doesn't stall the main thread
// parsing GLB JSON.
export async function preloadAllDropModels(): Promise<void> {
  const items = allItems();
  await Promise.all(items.map(async (item) => {
    if (!item.model) return; // block items and others with no GLB are skipped
    try {
      await loadDropModel(item.model);
    } catch {
      // Per-item failures fall back to debug cube at drop time.
    }
  }));
}

interface DropEntity {
  group: THREE.Group;
  itemId: string;
  count: number;
  baseY: number;
  age: number;
  pickupDelay: number;
  // Index into the WorldDrops.lightPool. -1 means this drop didn't get a light
  // (pool was exhausted by older drops).
  lightSlot: number;
}

const PICKUP_RADIUS = 1.8;
const PICKUP_RADIUS_SQ = PICKUP_RADIUS * PICKUP_RADIUS;
const BOB_AMPLITUDE = 0.15;
const BOB_FREQ = 1.5;
const SPIN_SPEED = 1.2;
const PICKUP_COOLDOWN = 0.8;

// Number of point lights we pre-create. This is also the cap on simultaneous
// drop-lights. Bigger numbers = more glow but more shader work per frame.
const LIGHT_POOL_SIZE = 16;

export class WorldDrops {
  private scene: THREE.Scene;
  private drops: DropEntity[] = [];

  // Pre-created lights. We never add/remove lights from the scene at runtime —
  // adding lights forces every lit material in the scene to recompile its
  // shader, which is the main cause of per-drop stutter. Instead we toggle
  // `light.intensity` and reparent the light to a drop's group as it spawns.
  private lightPool: THREE.PointLight[] = [];
  private lightAssignedTo: (DropEntity | null)[] = []; // parallel to lightPool

  // Holder for unassigned lights so they remain in the scene's light count
  // (and thus the compiled shader) but contribute nothing visually.
  private lightHolder: THREE.Group;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.lightHolder = new THREE.Group();
    this.lightHolder.position.set(0, -1000, 0); // off-camera so the unused lights don't light anything
    this.scene.add(this.lightHolder);

    for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
      // Color/intensity get overwritten when assigned to a drop. Distance and
      // decay are fixed because changing them would also recompile shaders.
      const light = new THREE.PointLight(0xffffff, 0, 4, 2);
      this.lightHolder.add(light);
      this.lightPool.push(light);
      this.lightAssignedTo.push(null);
    }
  }

  private acquireLight(d: DropEntity, color: THREE.ColorRepresentation): number {
    // Take the first unused slot; if all are taken, steal the oldest drop's light.
    let idx = this.lightAssignedTo.indexOf(null);
    if (idx < 0) {
      // Find the oldest drop with a light and reclaim.
      let oldest: DropEntity | null = null;
      let oldestAge = -1;
      for (let i = 0; i < this.drops.length; i++) {
        const other = this.drops[i];
        if (other.lightSlot >= 0 && other.age > oldestAge) {
          oldest = other;
          oldestAge = other.age;
        }
      }
      if (!oldest) return -1;
      idx = oldest.lightSlot;
      // Return the stolen drop's light to the holder.
      const stolen = this.lightPool[idx];
      this.lightHolder.attach(stolen);
      stolen.intensity = 0;
      oldest.lightSlot = -1;
    }

    const light = this.lightPool[idx];
    light.color = new THREE.Color(color);
    light.intensity = 1.2;
    d.group.attach(light); // reparent without changing world transform
    light.position.set(0, 0.3, 0); // local to the drop's group
    this.lightAssignedTo[idx] = d;
    return idx;
  }

  private releaseLight(d: DropEntity) {
    if (d.lightSlot < 0) return;
    const light = this.lightPool[d.lightSlot];
    this.lightHolder.attach(light);
    light.intensity = 0;
    this.lightAssignedTo[d.lightSlot] = null;
    d.lightSlot = -1;
  }

  /**
   * Spawn a dropped pile in front of the player.
   */
  async spawn(itemId: string, count: number, origin: THREE.Vector3, forward: THREE.Vector3) {
    if (count <= 0) return;
    const def = getItem(itemId);
    if (!def) return;

    const group = new THREE.Group();

    let model: THREE.Object3D;
    if (!def.model) {
      // Block items and others without a GLB use a small colored cube as drop visual.
      const col = new THREE.Color(getDropLightColor(itemId));
      model = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.28, 0.28),
        new THREE.MeshStandardMaterial({ color: col }),
      );
    } else {
      try {
        model = await loadDropModel(def.model);
      } catch (err) {
        console.warn(`Failed to load drop model for ${itemId}:`, err);
        model = new THREE.Mesh(
          new THREE.BoxGeometry(0.3, 0.3, 0.3),
          new THREE.MeshStandardMaterial({ color: 0xff00ff }),
        );
      }
    }
    model.scale.setScalar(0.4);
    group.add(model);

    const spawnPos = origin.clone().add(forward.clone().multiplyScalar(1.0));
    spawnPos.y += 0.5;
    group.position.copy(spawnPos);

    this.scene.add(group);

    const entity: DropEntity = {
      group,
      itemId,
      count,
      baseY: spawnPos.y - 0.5,
      age: 0,
      pickupDelay: PICKUP_COOLDOWN,
      lightSlot: -1,
    };
    entity.lightSlot = this.acquireLight(entity, getDropLightColor(itemId));
    this.drops.push(entity);
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    onPickup: (itemId: string, count: number) => boolean,
  ) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      d.pickupDelay = Math.max(0, d.pickupDelay - dt);

      const bob = Math.sin(d.age * BOB_FREQ * Math.PI * 2) * BOB_AMPLITUDE;
      d.group.position.y = d.baseY + bob + 0.4;
      d.group.rotation.y += SPIN_SPEED * dt;

      if (d.pickupDelay <= 0) {
        const dx = d.group.position.x - playerPos.x;
        const dz = d.group.position.z - playerPos.z;
        const dy = d.group.position.y - playerPos.y;
        const distSq = dx * dx + dz * dz + dy * dy * 0.5;
        if (distSq < PICKUP_RADIUS_SQ) {
          if (onPickup(d.itemId, d.count)) {
            this.despawn(i);
          }
        }
      }
    }
  }

  private despawn(index: number) {
    const d = this.drops[index];
    this.releaseLight(d);
    this.scene.remove(d.group);
    d.group.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose?.();
        const m = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach(mm => mm.dispose?.());
        else m?.dispose?.();
      }
    });
    this.drops.splice(index, 1);
  }
}