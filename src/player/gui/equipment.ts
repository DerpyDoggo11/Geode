import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getItem, type ItemDef, type SlotType } from './items';

const loader = new GLTFLoader();
const modelCache = new Map<string, THREE.Object3D>();

async function loadModel(path: string): Promise<THREE.Object3D> {
  const cached = modelCache.get(path);
  if (cached) return cached.clone(true);
  try {
    const gltf = await loader.loadAsync(path);
    modelCache.set(path, gltf.scene);
    return gltf.scene.clone(true);
  } catch (err) {
    // GLTFLoader throws a confusing JSON.parse error when the file is missing
    // (Vite serves index.html as a fallback). Verify with a HEAD probe.
    const resp = await fetch(path, { method: 'HEAD' });
    const ct = resp.headers.get('content-type') ?? '';
    if (!resp.ok) {
      throw new Error(`GLB not found at ${path} (HTTP ${resp.status})`);
    }
    if (ct.includes('text/html')) {
      throw new Error(`GLB path ${path} returned HTML — file not served at this URL`);
    }
    throw err;
  }
}

export type EquipSlotName = 'mainhand' | 'offhand' | 'helmet' | 'chestplate';

interface Anchor {
  parent: THREE.Object3D;
  offset?: THREE.Vector3;
  rotation?: THREE.Euler;
  scale?: number;
}

export class Equipment {
  private anchors: Record<EquipSlotName, Anchor>;
  private attached: Partial<Record<EquipSlotName, THREE.Object3D>> = {};
  private loadTokens: Partial<Record<EquipSlotName, number>> = {};

  constructor(anchors: Record<EquipSlotName, Anchor>) {
    this.anchors = anchors;
  }

  async equip(slot: EquipSlotName, itemId: string | null) {
    // Bump a token so an in-flight async load for this slot can detect it was superseded.
    const token = (this.loadTokens[slot] ?? 0) + 1;
    this.loadTokens[slot] = token;

    this.detach(slot);
    if (!itemId) return;

    const def = getItem(itemId);
    if (!def) return;

    let model: THREE.Object3D;
    try {
      model = await loadModel(def.model);
    } catch (err) {
      console.warn(`Failed to load model for ${itemId}:`, err);
      return;
    }

    // A later equip() call might have superseded this one while we awaited.
    if (this.loadTokens[slot] !== token) return;

    const anchor = this.anchors[slot];

    // Apply anchor defaults first, then let the item's own attach transform override.
    if (anchor.offset) model.position.copy(anchor.offset);
    if (anchor.rotation) model.rotation.copy(anchor.rotation);
    if (anchor.scale !== undefined) model.scale.setScalar(anchor.scale);

    const at = def.attach;
    if (at) {
      if (at.offset) model.position.set(at.offset[0], at.offset[1], at.offset[2]);
      if (at.rotation) model.rotation.set(at.rotation[0], at.rotation[1], at.rotation[2]);
      if (at.scale !== undefined) model.scale.setScalar(at.scale);
    }

    anchor.parent.add(model);
    this.attached[slot] = model;
  }

  private detach(slot: EquipSlotName) {
    const existing = this.attached[slot];
    if (existing) {
      existing.parent?.remove(existing);
      this.attached[slot] = undefined;
    }
  }

  // Map a logical inventory slot type to the equipment anchor it visually attaches to.
  static slotForItem(item: ItemDef): EquipSlotName | null {
    switch (item.slot) {
      case 'weapon': return 'mainhand';
      case 'offhand': return 'offhand';
      case 'helmet': return 'helmet';
      case 'chestplate': return 'chestplate';
      default: return null;
    }
  }
}

export function armorEquipIndex(slot: SlotType): number | null {
  // Mirrors EQUIP_BASE layout in inventory.ts: 100=helmet, 101=chestplate, 102=offhand
  switch (slot) {
    case 'helmet': return 100;
    case 'chestplate': return 101;
    case 'offhand': return 102;
    default: return null;
  }
}