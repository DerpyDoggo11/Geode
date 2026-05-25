import * as THREE from 'three';
import { loadMap } from './map/map';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast, StaticGeometryGenerator, MeshBVH } from 'three-mesh-bvh';
import {
  createInventory, toggleInventory, setCharacterPreview, setHealth, isInventoryOpen,
  handleInventoryMouseMove, handleInventoryMouseUp, handleInventoryMouseDown,
  selectHotbar, toggleOffhand, onEquipChange, refreshEquipment,
  onItemDrop, tryAddItem, dropHeldOne, dropHeldStack,
  consumeArrow, consumeItemById, getHeldItemId, getOffhandItemId,
} from './player/gui/inventory';
import { Equipment } from './player/gui/equipment';
import { loadItems, getItem, isBlockItem } from './player/gui/items';
import { WorldDrops, preloadAllDropModels } from './player/gui/worldDrops';
import { WeaponAnimator } from './player/weaponAnim';


function applyToonShader(model, gradientSteps = 3) {
  const colors = new Uint8Array(gradientSteps);
  for (let i = 0; i < gradientSteps; i++) {
    colors[i] = (i / (gradientSteps - 1)) * 255;
  }
  const gradientMap = new THREE.DataTexture(colors, gradientSteps, 1, THREE.RedFormat);
  gradientMap.needsUpdate = true;

  model.traverse((o) => {
    if (!o.isMesh) return;
    const old = o.material;
    const toon = new THREE.MeshToonMaterial({
      color: old.color ? old.color.clone() : new THREE.Color(0xffffff),
      map: old.map || null,
      gradientMap,
    });
    o.material = toon;
  });
}

function addToonOutline(model, thickness = 0.03, color = 0x000000) {
  const outlineMaterial = new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide,
  });

  const outlineMeshes = [];

  model.traverse((o) => {
    if (!o.isMesh) return;
    const outline = new THREE.Mesh(o.geometry, outlineMaterial);
    outline.scale.setScalar(1 + thickness);
    outline.castShadow = false;
    outline.receiveShadow = false;
    outlineMeshes.push({ outline, parent: o });
  });

  for (const { outline, parent } of outlineMeshes) {
    parent.add(outline);
  }
}

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const loader = new GLTFLoader();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const map = await loadMap('/map.json', { scene });
scene.add(map.terrain);
for (const m of map.models) scene.add(m);

scene.add(new THREE.AmbientLight(0xffffff, 0.1));
const sun = new THREE.DirectionalLight(0xffffff, 0.5);
sun.position.set(5, 10, 5);
scene.add(sun);

scene.updateMatrixWorld(true);

const staticGenerator = new StaticGeometryGenerator(map.collidables);
staticGenerator.attributes = ['position'];
const mergedGeometry = staticGenerator.generate();
mergedGeometry.boundsTree = new MeshBVH(mergedGeometry);

const collider = new THREE.Mesh(mergedGeometry);
collider.visible = false;
scene.add(collider);

const SPHERE_RADIUS = 1;
let cube;

await loadItems('/data/items.json');

// Warm up the drop-model cache in the background. Without this, the first
// Q-drop or world-drop fetches+parses a GLB on the main thread and hitches.
void preloadAllDropModels();

const gltf = await loader.loadAsync('/models/commander.glb');
cube = gltf.scene;
cube.position.set(0, 10, 0);
cube.traverse(o => {
  if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
});

const light = new THREE.PointLight(0xff0000, 100, 100);
light.position.set(50, 50, 50);
cube.add(light);

const playerLight = new THREE.PointLight(0xFFFFFF, 5, 5, 2);
playerLight.position.set(0, -1, 0);
cube.add(playerLight);

applyToonShader(cube, 3);
addToonOutline(cube, 0.05);

const MODEL_FORWARD_OFFSET = 0;

let leftEar = cube.getObjectByName('Sphere001');
let rightEar = cube.getObjectByName('Sphere002');
let rightArm = cube.getObjectByName('Sphere009');
let leftArm  = cube.getObjectByName('Sphere010');

// Capture the arm's rest-pose rotations from the GLB so the animation
// system can restore them when returning to idle. Only z is animated by
// the walk bob; x/y must come back to their model-imported values.
const rightArmRestX = rightArm?.rotation.x ?? 0;
const rightArmRestY = rightArm?.rotation.y ?? 0;

scene.add(cube);

const equipment = new Equipment({
  mainhand: { parent: rightArm ?? cube, scale: 1 },
  offhand:  { parent: leftArm  ?? cube, scale: 1 },
  helmet:    { parent: cube, scale: 1 },
  chestplate:{ parent: cube, scale: 1 },
});

let previewEquipment: Equipment | null = null;

const weaponAnimator = new WeaponAnimator();

let currentMainhand: string | null = null;

onEquipChange((c) => {
  currentMainhand = c.mainhand;

  equipment.equip('mainhand',  c.mainhand);
  equipment.equip('offhand',   c.offhand);
  equipment.equip('helmet',    c.helmet);
  equipment.equip('chestplate', c.chestplate);

  weaponAnimator.setWeapon(c.mainhand);

  if (previewEquipment) {
    previewEquipment.equip('mainhand',  c.mainhand);
    previewEquipment.equip('offhand',   c.offhand);
    previewEquipment.equip('helmet',    c.helmet);
    previewEquipment.equip('chestplate', c.chestplate);
  }
});

// STEP 5: world drops. The inventory fires a drop request; we spawn an entity
// in front of the player.
const worldDrops = new WorldDrops(scene);

onItemDrop(({ itemId, count }) => {
  const forward = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
  worldDrops.spawn(itemId, count, cube.position, forward);
});


// ─── Bow / projectile system ──────────────────────────────────────────────────

const BOW_GRAVITY    = -22;   // m/s² applied to arrows
const BOW_MIN_POWER  = 8;     // m/s at zero charge
const BOW_MAX_POWER  = 28;    // m/s at full charge
const BOW_AIM_SENS   = 0.003; // radians per pixel of mouse Y movement
const BOW_CHARGE_MAX = 0.8;   // seconds for full charge (green on color ramp)

let bowCharging = false;
let bowAimPitch = 0.12; // radians; positive = upward
let bowHoldTime = 0;    // total seconds bow has been held this charge

// ── Aim indicator: flat 2D rectangle lying in world space ────────────────────
const AIM_LINE_LENGTH = 4.0;
const AIM_LINE_WIDTH  = 0.09;

// PlaneGeometry in XY plane; height axis (+Y) will be oriented toward aim direction at runtime
const _aimGeo = new THREE.PlaneGeometry(AIM_LINE_WIDTH, AIM_LINE_LENGTH);
const _aimMat4 = new THREE.Matrix4(); // reused each frame for quaternion construction
const aimLineMat = new THREE.MeshBasicMaterial({
  color: 0xff3300,
  transparent: true,
  opacity: 0.88,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const aimLineMesh = new THREE.Mesh(_aimGeo, aimLineMat);
aimLineMesh.visible = false;
aimLineMesh.renderOrder = 2;
scene.add(aimLineMesh);

// Color ramp: red→yellow→green (optimal at full charge)→yellow→red (overcharged)
function getChargeColor(holdTime: number, chargeMax: number): THREE.Color {
  const t = holdTime / chargeMax; // 0=uncharged, 1=full, >1=overcharged
  if (t <= 0.5) {
    return new THREE.Color(1, t * 2, 0);             // red → yellow
  } else if (t <= 1.0) {
    return new THREE.Color(2 - t * 2, 1, 0);         // yellow → green
  } else if (t <= 1.5) {
    return new THREE.Color((t - 1) * 2, 1, 0);       // green → yellow
  } else {
    return new THREE.Color(1, Math.max(0, 1 - (t - 1.5) * 2), 0); // yellow → red
  }
}

// Brief muzzle flash when an arrow fires
const bowFlashLight = new THREE.PointLight(0xffcc44, 0, 7, 2);
scene.add(bowFlashLight);
let bowFlashAge = Infinity;

// Arrow entities in flight
interface ArrowEntity {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  age: number;
  maxAge: number;
  stuck: boolean;
  pickupDelay: number; // seconds before player can pick up a stuck arrow
}
const activeArrows: ArrowEntity[] = [];
const arrowRaycaster = new THREE.Raycaster();
const arrowUpVec = new THREE.Vector3(0, 1, 0);

// Tapered arrow: small tip (radiusTop), wide feathers (radiusBottom), clearly visible
const arrowGeo = new THREE.CylinderGeometry(0.06, 0.18, 1.5, 6);
const arrowMat = new THREE.MeshStandardMaterial({ color: 0x7a4a1e });

function fireArrow(yaw: number, pitch: number, chargeNorm: number) {
  if (!consumeArrow()) return;

  const power = BOW_MIN_POWER + (BOW_MAX_POWER - BOW_MIN_POWER) * chargeNorm;
  const dir = new THREE.Vector3(
    Math.cos(pitch) * -Math.sin(yaw),
    Math.sin(pitch),
    Math.cos(pitch) * -Math.cos(yaw),
  ).normalize();

  const origin = cube.position.clone();
  origin.y += 0.45;
  origin.addScaledVector(dir, 0.6);

  const mesh = new THREE.Mesh(arrowGeo, arrowMat.clone());
  mesh.position.copy(origin);
  mesh.quaternion.setFromUnitVectors(arrowUpVec, dir);
  mesh.castShadow = true;
  scene.add(mesh);

  // Muzzle flash
  bowFlashLight.position.copy(origin);
  bowFlashAge = 0;

  activeArrows.push({
    mesh,
    vel: dir.clone().multiplyScalar(power),
    age: 0,
    maxAge: 8,
    stuck: false,
    pickupDelay: 0,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

// ─── Block placement / mining system ─────────────────────────────────────────

interface PlacedBlock {
  id: string;
  mesh: THREE.Mesh;
  skirt: THREE.Mesh | null;
  size: number;
}
const placedBlocks: PlacedBlock[] = [];

// Terrain meshes used for surface detection
const terrainMeshes: THREE.Mesh[] = map.mapType === 'island'
  ? map.islands
  : [map.terrain as THREE.Mesh];

// Collidables used to rebuild the BVH when blocks are added/removed
let blockCollidables: THREE.Mesh[] = [];

function rebuildBlockCollider() {
  const allCollidables = [...map.collidables, ...blockCollidables];
  const gen = new StaticGeometryGenerator(allCollidables);
  gen.attributes = ['position'];
  const merged = gen.generate();
  merged.boundsTree = new MeshBVH(merged);
  collider.geometry.dispose();
  collider.geometry = merged;
}

// Shared toon gradient for block materials (3-step: dark / mid / bright)
function makeBlockGradient(): THREE.DataTexture {
  const data = new Uint8Array([64, 140, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
const blockGradient = makeBlockGradient();

// ─── Face-culling helpers for seamless block merging ─────────────────────────
type FaceDir = 'px'|'nx'|'py'|'ny'|'pz'|'nz';
const FACE_OPP: Record<FaceDir, FaceDir> = {
  px:'nx', nx:'px', py:'ny', ny:'py', pz:'nz', nz:'pz'
};
void FACE_OPP; // referenced only for type safety

/** Box geometry with specified faces omitted — used so adjacent blocks merge seamlessly. */
function buildBlockGeo(size: number, skip: Set<FaceDir>): THREE.BufferGeometry {
  const h = size / 2;
  const pos: number[] = [], nor: number[] = [];
  const face = (v: number[][], n: [number, number, number]) => {
    pos.push(...v[0], ...v[1], ...v[2],  ...v[0], ...v[2], ...v[3]);
    for (let i = 0; i < 6; i++) nor.push(...n);
  };
  if (!skip.has('px')) face([[h,-h,-h],[h,h,-h],[h,h,h],[h,-h,h]], [1,0,0]);
  if (!skip.has('nx')) face([[-h,-h,h],[-h,h,h],[-h,h,-h],[-h,-h,-h]], [-1,0,0]);
  if (!skip.has('py')) face([[-h,h,-h],[-h,h,h],[h,h,h],[h,h,-h]], [0,1,0]);
  if (!skip.has('ny')) face([[-h,-h,h],[-h,-h,-h],[h,-h,-h],[h,-h,h]], [0,-1,0]);
  if (!skip.has('pz')) face([[-h,-h,h],[h,-h,h],[h,h,h],[-h,h,h]], [0,0,1]);
  if (!skip.has('nz')) face([[h,-h,-h],[-h,-h,-h],[-h,h,-h],[h,h,-h]], [0,0,-1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal',   new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/** Which faces of a hypothetical block at `center` are covered by existing placed blocks. */
function getHiddenFaces(center: THREE.Vector3, size: number): Set<FaceDir> {
  const hidden = new Set<FaceDir>();
  const TOL = size * 0.18;
  for (const b of placedBlocks) {
    const dx = b.mesh.position.x - center.x;
    const dy = b.mesh.position.y - center.y;
    const dz = b.mesh.position.z - center.z;
    const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
    if (Math.abs(ax - size) < TOL && ay < TOL && az < TOL) hidden.add(dx > 0 ? 'px' : 'nx');
    else if (Math.abs(ay - size) < TOL && ax < TOL && az < TOL) hidden.add(dy > 0 ? 'py' : 'ny');
    else if (Math.abs(az - size) < TOL && ax < TOL && ay < TOL) hidden.add(dz > 0 ? 'pz' : 'nz');
  }
  return hidden;
}

/** Rebuild the mesh geometry of an existing block to reflect current neighbors. */
function refreshBlockGeometry(block: PlacedBlock): void {
  const geo = buildBlockGeo(block.size, getHiddenFaces(block.mesh.position, block.size));
  const old = block.mesh.geometry;
  block.mesh.geometry = geo;
  const outline = block.mesh.children[0] as THREE.Mesh | undefined;
  if (outline) outline.geometry = geo;
  old.dispose();
}

/** All placed blocks whose center is exactly one block-size away from `center`. */
function getAdjacentBlocks(center: THREE.Vector3, size: number): PlacedBlock[] {
  const TOL = size * 0.18;
  return placedBlocks.filter(b => {
    const ax = Math.abs(b.mesh.position.x - center.x);
    const ay = Math.abs(b.mesh.position.y - center.y);
    const az = Math.abs(b.mesh.position.z - center.z);
    return (
      (Math.abs(ax - size) < TOL && ay < TOL && az < TOL) ||
      (Math.abs(ay - size) < TOL && ax < TOL && az < TOL) ||
      (Math.abs(az - size) < TOL && ax < TOL && ay < TOL)
    );
  });
}

// Ghost preview block (semi-transparent)
const _previewBoxGeo = new THREE.BoxGeometry(1, 1, 1);
const blockPreviewMesh = new THREE.Mesh(
  _previewBoxGeo,
  new THREE.MeshStandardMaterial({
    color: 0x888780,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  }),
);
blockPreviewMesh.visible = false;
scene.add(blockPreviewMesh);
// Wireframe overlay on the preview
const _previewEdges = new THREE.EdgesGeometry(_previewBoxGeo);
blockPreviewMesh.add(new THREE.LineSegments(
  _previewEdges,
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }),
));

const blockRaycaster = new THREE.Raycaster();
const _blockRayDir = new THREE.Vector3();
let blockPlacePos: THREE.Vector3 | null = null;    // raw surface hit point
let blockPlaceOnTerrain = false;                   // true when placing on terrain (skirt needed)

// Mining state
let miningBlock: PlacedBlock | null = null;
let miningProgress = 0; // 0..1 fraction of totalMineTime elapsed
let miningTotalTime = 1; // seconds to fully mine current block
let isMouseDownLeft = false;

// ─── Block system helpers ─────────────────────────────────────────────────────

/**
 * Build the gradient skirt mesh that visually connects the block base to the terrain.
 * Inner vertices (at hitPoint.y) use block color; outer vertices (slightly below/wider)
 * use an earth tone so the block appears to root into the ground.
 */
function createSkirtMesh(hitPoint: THREE.Vector3, size: number): THREE.Mesh {
  const half  = size / 2;
  const flare = size * 0.22;   // outward spread beyond block edge
  const depth = size * 0.11;   // downward embed below surface

  const baseY  = hitPoint.y;
  const outerY = hitPoint.y - depth;

  // Inner square corners (block base perimeter at terrain level)
  const inn: [number, number, number][] = [
    [hitPoint.x - half,         baseY,  hitPoint.z - half        ],
    [hitPoint.x + half,         baseY,  hitPoint.z - half        ],
    [hitPoint.x + half,         baseY,  hitPoint.z + half        ],
    [hitPoint.x - half,         baseY,  hitPoint.z + half        ],
  ];
  // Outer square corners (flared out + slightly below)
  const out: [number, number, number][] = [
    [hitPoint.x - half - flare, outerY, hitPoint.z - half - flare],
    [hitPoint.x + half + flare, outerY, hitPoint.z - half - flare],
    [hitPoint.x + half + flare, outerY, hitPoint.z + half + flare],
    [hitPoint.x - half - flare, outerY, hitPoint.z + half + flare],
  ];

  // Stone color (inner) → earth tone (outer)
  const ci: [number, number, number] = [0.533, 0.533, 0.502]; // #888780
  const co: [number, number, number] = [0.36,  0.32,  0.27 ]; // dark earth

  const pos: number[] = [];
  const col: number[] = [];

  // 4 side trapezoidal panels
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const [a, b, c, d] = [inn[i], inn[j], out[j], out[i]];
    pos.push(...a, ...b, ...c,  ...a, ...c, ...d);
    col.push(...ci, ...ci, ...co,  ...ci, ...co, ...co);
  }

  // Bottom cap (flat at outerY, fills the base so no hole shows underground)
  pos.push(...out[0], ...out[1], ...out[2],  ...out[0], ...out[2], ...out[3]);
  col.push(...co, ...co, ...co,  ...co, ...co, ...co);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function isPositionOccupied(centerPos: THREE.Vector3, blockSize: number): boolean {
  const thresh = blockSize * 0.85;
  for (const b of placedBlocks) {
    if (b.mesh.position.distanceTo(centerPos) < thresh) return true;
  }
  return false;
}

function spawnPlacedBlock(id: string, hitPoint: THREE.Vector3, onTerrain: boolean): boolean {
  const blockDef = getItem(id)?.block;
  if (!blockDef) return false;
  const size = blockDef.size ?? 3.0;
  const centerPos = new THREE.Vector3(hitPoint.x, hitPoint.y + size / 2, hitPoint.z);

  if (cube.position.distanceTo(centerPos) < SPHERE_RADIUS + size * 0.4) return false;
  if (isPositionOccupied(centerPos, size)) return false;

  // Geometry with hidden faces for seamless merging with existing neighbors
  const hidden = getHiddenFaces(centerPos, size);
  const geo = buildBlockGeo(size, hidden);
  const mat = new THREE.MeshToonMaterial({ color: 0x888780, gradientMap: blockGradient });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(centerPos);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData['blockId'] = id;

  const outlineMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
  const outline = new THREE.Mesh(geo, outlineMat);
  outline.scale.setScalar(1.03);
  mesh.add(outline);

  const skirt = onTerrain ? createSkirtMesh(hitPoint, size) : null;
  if (skirt) scene.add(skirt);

  scene.add(mesh);
  placedBlocks.push({ id, mesh, skirt, size });
  blockCollidables.push(mesh);

  // Now that the new block is in placedBlocks, refresh all neighbors so their
  // now-covered faces are removed too
  for (const adj of getAdjacentBlocks(centerPos, size)) refreshBlockGeometry(adj);

  rebuildBlockCollider();
  return true;
}

function removeBlock(block: PlacedBlock) {
  // Remove from arrays first so neighbors' getHiddenFaces won't find this block
  const idx = placedBlocks.indexOf(block);
  if (idx !== -1) placedBlocks.splice(idx, 1);
  const ci = blockCollidables.indexOf(block.mesh);
  if (ci !== -1) blockCollidables.splice(ci, 1);

  // Restore exposed faces on neighbors now that this block is gone
  for (const adj of getAdjacentBlocks(block.mesh.position, block.size)) {
    refreshBlockGeometry(adj);
  }

  scene.remove(block.mesh);
  block.mesh.geometry.dispose();
  if (block.skirt) {
    scene.remove(block.skirt);
    block.skirt.geometry.dispose();
  }
  rebuildBlockCollider();
}

// ─── Mining & preview UI elements (created after createInventory) ─────────────
let miningBarEl: HTMLElement | null = null;
let miningFillEl: HTMLElement | null = null;

function setMiningProgress(t: number | null) {
  if (!miningBarEl || !miningFillEl) return;
  if (t === null) { miningBarEl.style.display = 'none'; return; }
  miningBarEl.style.display = 'block';
  miningFillEl.style.width = `${Math.round(t * 100)}%`;
}

// ─────────────────────────────────────────────────────────────────────────────

const keys = {};
document.addEventListener('keydown', (e) => { keys[e.code] = true; });
document.addEventListener('keyup',   (e) => { keys[e.code] = false; });

let cameraYaw = 0;
let lookYawOffset = 0;
const MOUSE_SENSITIVITY = 0.01;
const LOOK_SNAPBACK_SPEED = 10;
let isPointerLocked = false;

document.addEventListener('click', () => {
  renderer.domElement.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  isPointerLocked = document.pointerLockElement === renderer.domElement;
});

document.addEventListener('mousemove', (e) => {
  if (isInventoryOpen()) {
    handleInventoryMouseMove(e.movementX, e.movementY);
    return;
  }
  if (!isPointerLocked) return;
  const dx = e.movementX * MOUSE_SENSITIVITY;
  const altHeld = keys['AltLeft'] || keys['AltRight'];
  if (altHeld) {
    lookYawOffset += dx;
  } else {
    cameraYaw -= dx;
  }
  // While bow is charging, mouse Y adjusts the aim pitch (up/down angle)
  if (bowCharging) {
    bowAimPitch = Math.max(-0.25, Math.min(1.35, bowAimPitch - e.movementY * BOW_AIM_SENS));
  }
});

document.addEventListener('mousedown', (e) => {
  if (isInventoryOpen()) {
    if (e.button === 0 || e.button === 2) handleInventoryMouseDown(e.button);
    return;
  }
  if (!isPointerLocked) return;

  if (e.button === 0) {
    isMouseDownLeft = true;
    // Bow: start charging — reset pitch to a slight upward default each draw
    if (!weaponAnimator.isEquipping() && getItem(currentMainhand)?.animation?.type === 'bow') {
      bowCharging = true;
      bowHoldTime = 0;
      bowAimPitch = 0.12;
    }
  }

  // Right-click: block placement from mainhand or offhand
  if (e.button === 2) {
    const mainId = getHeldItemId();
    const offId = getOffhandItemId();
    const blockId = isBlockItem(mainId) ? mainId : isBlockItem(offId) ? offId : null;
    if (blockId && blockPlacePos) {
      if (spawnPlacedBlock(blockId, blockPlacePos, blockPlaceOnTerrain)) {
        consumeItemById(blockId);
      }
      return;
    }
  }

  weaponAnimator.onMouseDown(e.button);
});

document.addEventListener('mouseup', (e) => {
  if (isInventoryOpen()) {
    if (e.button === 0 || e.button === 2) handleInventoryMouseUp(e.button);
    return;
  }
  if (!isPointerLocked) return;
  if (e.button === 0) {
    isMouseDownLeft = false;
    miningBlock = null;
    miningProgress = 0;
    setMiningProgress(null);
    if (bowCharging) {
      bowCharging = false;
      aimLineMesh.visible = false;
      fireArrow(cameraYaw, bowAimPitch, weaponAnimator.getChargeNormalized());
    }
  }
  weaponAnimator.onMouseUp(e.button);
});

document.addEventListener('contextmenu', (e) => e.preventDefault());


// UNDO FOR PRODUCTION
// window.addEventListener('beforeunload', (e) => {
//   e.preventDefault();
//   e.returnValue = '';
// });

document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl) {
    if ('wtnlh'.includes(e.key.toLowerCase())) { e.preventDefault(); return; }
    if (e.key === 'Tab') { e.preventDefault(); return; }

    // UNDO FOR PRODUCTION
    //if (e.key === 'r' || e.key === 'R' || e.key === 'F5') { e.preventDefault(); return; }

    if ('fgpsdhjuaq'.includes(e.key.toLowerCase())) { e.preventDefault(); return; }
    if (['+', '-', '=', '_', '0'].includes(e.key)) { e.preventDefault(); return; }
    if (e.key >= '1' && e.key <= '9') { e.preventDefault(); return; }
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); return; }
  }
  if (e.key === 'Backspace') { e.preventDefault(); return; }

  if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault(); return;
  }

  if (e.key === 'F1')  { e.preventDefault(); return; }
  if (e.key === 'F3')  { e.preventDefault(); return; }
  if (e.key === 'F5')  { e.preventDefault(); return; }
  if (e.key === 'F6')  { e.preventDefault(); return; }
}, { capture: true }); 

const velocity = new THREE.Vector3();

const ACCEL = 450;
const AIR_ACCEL = 80;
const FRICTION = 10;
const AIR_FRICTION = 0.4;
const BASE_MAX_SPEED = 10;
const SPRINT_MULTIPLIER = 3;
const SNEAK_MULTIPLIER = 0.9;
const GRAVITY = -100;
const JUMP_SPEED = 30;

const WALKABLE_SLOPE = Math.cos(THREE.MathUtils.degToRad(50));
const MAX_STEP_DIST = SPHERE_RADIUS * 0.5;

const SPRINT_STRETCH = 1.1;
const SNEAK_HEIGHT = 0.8;
const SCALE_LERP_SPEED = 8;

const LEDGE_PROBE_DIST = SPHERE_RADIUS;
const LEDGE_DROP_THRESHOLD = 100;

const tempBox = new THREE.Box3();
const triPoint = new THREE.Vector3();
const spherePoint = new THREE.Vector3();
const pushDir = new THREE.Vector3();

function resolveCollisions() {
  tempBox.makeEmpty();
  tempBox.expandByPoint(cube.position);
  tempBox.min.addScalar(-SPHERE_RADIUS);
  tempBox.max.addScalar(SPHERE_RADIUS);
  let grounded = false;
  collider.geometry.boundsTree.shapecast({
    intersectsBounds: (box) => box.intersectsBox(tempBox),
    intersectsTriangle: (tri) => {
      spherePoint.copy(cube.position);
      tri.closestPointToPoint(spherePoint, triPoint);
      const delta = pushDir.subVectors(spherePoint, triPoint);
      const distSq = delta.lengthSq();
      if (distSq < SPHERE_RADIUS * SPHERE_RADIUS) {
        const dist = Math.sqrt(distSq);
        const depth = SPHERE_RADIUS - dist;
        if (dist > 1e-6) {
          delta.multiplyScalar(1 / dist);
        } else {
          tri.getNormal(delta);
        }
        cube.position.addScaledVector(delta, depth);
        const into = velocity.dot(delta);
        if (into < 0) velocity.addScaledVector(delta, -into);
        if (delta.y > WALKABLE_SLOPE) grounded = true;
      }
    },
  });
  return grounded;
}

const scanRay = new THREE.Raycaster();
const scanOrigin = new THREE.Vector3();
const scanDir = new THREE.Vector3(0, -1, 0);

function isLedgeAhead(dx: number, dz: number): boolean {
  const feetY = cube.position.y - SPHERE_RADIUS;
  scanOrigin.set(
    cube.position.x + dx * LEDGE_PROBE_DIST,
    cube.position.y + SPHERE_RADIUS,
    cube.position.z + dz * LEDGE_PROBE_DIST,
  );
  scanRay.set(scanOrigin, scanDir);
  scanRay.far = SPHERE_RADIUS * 2 + LEDGE_DROP_THRESHOLD;
  const hits = scanRay.intersectObject(collider, false);
  if (hits.length === 0) return true;
  return hits[0].point.y < feetY - LEDGE_DROP_THRESHOLD;
}

const stepVec = new THREE.Vector3();
let onGround = false;
let lastTime = 0;
let walkPhase = 0;

let currentSprintScale = 1.5;
let currentSneakScale = 1;

const CAMERA_OFFSET = new THREE.Vector3(10, 10, 10);
const CAMERA_DIST = Math.hypot(CAMERA_OFFSET.x, CAMERA_OFFSET.z);
const CAMERA_HEIGHT = CAMERA_OFFSET.y;

function lerpAngle(a, b, t) {
  let diff = b - a;
  diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function animate(time) {
  const dt = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;

  if (resizeRendererToDisplaySize(renderer)) {
    const canvas = renderer.domElement;
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
  }

  const forwardX = -Math.sin(cameraYaw);
  const forwardZ = -Math.cos(cameraYaw);
  const rightX = -forwardZ;
  const rightZ =  forwardX;

  let inX = 0, inZ = 0;
  if (keys['KeyW']) { inX += forwardX; inZ += forwardZ; }
  if (keys['KeyS']) { inX -= forwardX; inZ -= forwardZ; }
  if (keys['KeyD']) { inX += rightX;   inZ += rightZ;   }
  if (keys['KeyA']) { inX -= rightX;   inZ -= rightZ;   }
  const inLen = Math.hypot(inX, inZ);
  const hasInput = inLen > 0;
  if (hasInput) { inX /= inLen; inZ /= inLen; }

  const shiftHeld  = keys['ShiftLeft'] || keys['ShiftRight'];
  const cHeld = keys['KeyC'];

  const sprinting = shiftHeld && keys['KeyW'] && !cHeld;
  const sneaking  = cHeld;

  let maxSpeed = BASE_MAX_SPEED;
  if (sprinting) maxSpeed *= SPRINT_MULTIPLIER;
  else if (sneaking) maxSpeed *= SNEAK_MULTIPLIER;

  maxSpeed *= getItem(getHeldItemId())?.speedModifier ?? 1;
  maxSpeed *= getItem(getOffhandItemId())?.speedModifier ?? 1;

  const accel   = onGround ? ACCEL : AIR_ACCEL;
  const friction = onGround ? FRICTION : AIR_FRICTION;

  const hSpeedPre = onGround ? 0 : Math.hypot(velocity.x, velocity.z);

  velocity.x += inX * accel * dt;
  velocity.z += inZ * accel * dt;

  const hFriction = Math.max(0, 1 - friction * dt);
  velocity.x *= hFriction;
  velocity.z *= hFriction;

  const hSpeed = Math.hypot(velocity.x, velocity.z);
  if (onGround) {
    if (hSpeed > maxSpeed) {
      velocity.x *= maxSpeed / hSpeed;
      velocity.z *= maxSpeed / hSpeed;
    }
  } else {
    const airCap = Math.max(maxSpeed, hSpeedPre);
    if (hSpeed > airCap) {
      velocity.x *= airCap / hSpeed;
      velocity.z *= airCap / hSpeed;
    }
  }

  velocity.y += GRAVITY * dt;

  if (keys['Space'] && onGround) {
    velocity.y = JUMP_SPEED;
    onGround = false;
  }

  if (keys['KeyR']) {
    cube.position.set(0, 10, 0);
    velocity.set(0, 0, 0);
  }

  stepVec.copy(velocity).multiplyScalar(dt);
  const totalDist = stepVec.length();
  const steps = Math.max(1, Math.ceil(totalDist / MAX_STEP_DIST));
  stepVec.divideScalar(steps);

  let groundedThisFrame = false;
  for (let i = 0; i < steps; i++) {
    if (sneaking && onGround) {
      const moveLen = Math.hypot(stepVec.x, stepVec.z);
      if (moveLen > 1e-6) {
        const dx = stepVec.x / moveLen;
        const dz = stepVec.z / moveLen;
        if (isLedgeAhead(dx, dz)) {
          stepVec.x = 0;
          stepVec.z = 0;
          velocity.x = 0;
          velocity.z = 0;
        }
      }
    }
    cube.position.add(stepVec);
    if (resolveCollisions()) groundedThisFrame = true;
  }
  onGround = groundedThisFrame;

  worldDrops.update(dt, cube.position, (itemId, count) => {
    const leftover = tryAddItem(itemId, count);
    if (leftover === count) return false;
    if (leftover > 0) {
      const forward = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
      worldDrops.spawn(itemId, leftover, cube.position, forward);
    }
    return true;
  });

  const ROT_SPEED = 12;
  const rotT = 1 - Math.exp(-ROT_SPEED * dt);
  const targetCharYaw = cameraYaw + MODEL_FORWARD_OFFSET;
  cube.rotation.y = lerpAngle(cube.rotation.y, targetCharYaw + 89.5, rotT);

  const altHeld = keys['AltLeft'] || keys['AltRight'];
  if (!altHeld) {
    const k = 1 - Math.exp(-LOOK_SNAPBACK_SPEED * dt);
    lookYawOffset += (0 - lookYawOffset) * k;
  }
  
  const targetSprint = sprinting ? SPRINT_STRETCH : 1;
  const targetSneak  = sneaking  ? SNEAK_HEIGHT  : 1;
  const sLerp = 1 - Math.exp(-SCALE_LERP_SPEED * dt);
  currentSprintScale += (targetSprint - currentSprintScale) * sLerp;
  currentSneakScale  += (targetSneak  - currentSneakScale)  * sLerp;
  cube.scale.x = currentSprintScale;
  cube.scale.y = currentSneakScale;
  const yaw = cameraYaw + lookYawOffset;
  camera.position.set(
    cube.position.x + Math.sin(yaw) * CAMERA_DIST,
    cube.position.y + CAMERA_HEIGHT,
    cube.position.z + Math.cos(yaw) * CAMERA_DIST
  );
  camera.lookAt(cube.position.x, cube.position.y + 1, cube.position.z);

  walkPhase = (walkPhase ?? 0) + hSpeed * dt * 2;

  const attackPose = weaponAnimator.update(dt);
  if (attackPose.active) {
    if (rightArm) {
      // When bow charging, tilt arm up/down with aim pitch
      const pitchOffset = bowCharging ? -bowAimPitch : 0;
      rightArm.rotation.x = rightArmRestX + attackPose.rotX + pitchOffset;
      rightArm.rotation.y = rightArmRestY + attackPose.rotY;
      rightArm.rotation.z = attackPose.rotZ;
    }
  } else {
    if (rightArm) {
      rightArm.rotation.x = rightArmRestX;
      rightArm.rotation.y = rightArmRestY;
      rightArm.rotation.z = Math.sin(walkPhase) * 0.05;
    }
  }
  if (leftArm)  leftArm.rotation.z  = -Math.cos(walkPhase) * 0.05;
  if (rightEar) rightEar.rotation.x = Math.sin(walkPhase) * 0.2;
  if (leftEar)  leftEar.rotation.x  = -Math.cos(walkPhase) * 0.2;

  // Bow charge color ramp + aim line
  if (bowCharging) {
    bowHoldTime += dt;
    aimLineMat.color.copy(getChargeColor(bowHoldTime, BOW_CHARGE_MAX));

    // Aim direction in world space (respects both yaw and vertical pitch)
    const aimDir = new THREE.Vector3(
      Math.cos(bowAimPitch) * -Math.sin(cameraYaw),
      Math.sin(bowAimPitch),
      Math.cos(bowAimPitch) * -Math.cos(cameraYaw),
    );

    // Originate line at the bow (right arm world position)
    const bowOrigin = new THREE.Vector3();
    if (rightArm) rightArm.getWorldPosition(bowOrigin);
    else bowOrigin.set(cube.position.x, cube.position.y + 0.45, cube.position.z);

    // Center the line half-length ahead of the bow
    aimLineMesh.position.copy(bowOrigin).addScaledVector(aimDir, AIM_LINE_LENGTH * 0.5);

    // Orient: local +Y (height axis of plane) → aimDir; local +X stays horizontal
    const lx = new THREE.Vector3(-Math.cos(cameraYaw), 0, Math.sin(cameraYaw));
    const lz = new THREE.Vector3().crossVectors(aimDir, lx).normalize();
    _aimMat4.makeBasis(lx, aimDir, lz);
    aimLineMesh.quaternion.setFromRotationMatrix(_aimMat4);

    aimLineMesh.visible = true;
  } else {
    aimLineMesh.visible = false;
  }

  // Muzzle flash decay
  if (bowFlashAge < Infinity) {
    bowFlashAge += dt;
    bowFlashLight.intensity = Math.max(0, 4 - bowFlashAge * 20);
    if (bowFlashLight.intensity <= 0) { bowFlashAge = Infinity; }
  }

  for (let i = activeArrows.length - 1; i >= 0; i--) {
    const a = activeArrows[i];
    a.age += dt;
    if (a.age >= a.maxAge) {
      scene.remove(a.mesh);
      activeArrows.splice(i, 1);
      continue;
    }
    if (a.stuck) {
      a.pickupDelay -= dt;
      if (a.pickupDelay <= 0 && cube.position.distanceTo(a.mesh.position) < 2.5) {
        const leftover = tryAddItem('arrow', 1);
        if (leftover === 0) {
          scene.remove(a.mesh);
          activeArrows.splice(i, 1);
          continue;
        }
      }
      continue;
    }

    a.vel.y += BOW_GRAVITY * dt;
    const speed = a.vel.length();

    let hitSurface = false;
    if (speed > 0.05) {
      const velDir = a.vel.clone().normalize();
      // Lookahead: full step distance plus generous margin so fast arrows never tunnel
      arrowRaycaster.near = 0;
      arrowRaycaster.far = speed * dt + 0.6;
      arrowRaycaster.set(a.mesh.position, velDir);
      const hits = arrowRaycaster.intersectObject(collider, false);
      if (hits.length > 0) {
        a.mesh.position.copy(hits[0].point).addScaledVector(velDir, -0.325);
        a.vel.set(0, 0, 0);
        a.stuck = true;
        a.pickupDelay = 0.8;
        a.maxAge = a.age + 30;
        hitSurface = true;
      }
    }
    if (hitSurface) continue;

    a.mesh.position.addScaledVector(a.vel, dt);

    if (speed > 0.05) {
      a.mesh.quaternion.setFromUnitVectors(arrowUpVec, a.vel.clone().normalize());
    }
  }

  // ── Block preview & mining ──────────────────────────────────────────────────
  {
    const mainId = getHeldItemId();
    const offId  = getOffhandItemId();
    const heldBlockId = isBlockItem(mainId) ? mainId : isBlockItem(offId) ? offId : null;

    // Block placement target: cast downward from in front of the player
    const BLOCK_PLACE_DIST = 4.0;
    const aheadX = cube.position.x + forwardX * BLOCK_PLACE_DIST;
    const aheadZ = cube.position.z + forwardZ * BLOCK_PLACE_DIST;

    // ── Placement preview ───────────────────────────────────────────────────
    if (heldBlockId && !isInventoryOpen()) {
      const blockDef = getItem(heldBlockId)!.block!;
      const bSize = blockDef.size ?? 3.0;

      // Cast straight down — hit terrain OR tops of placed blocks
      _blockRayDir.set(0, -1, 0);
      blockRaycaster.set(
        new THREE.Vector3(aheadX, cube.position.y + 20, aheadZ),
        _blockRayDir
      );
      blockRaycaster.far = 40;
      const blockMeshSurfaces = placedBlocks.map(b => b.mesh);
      const surfaceHits = blockRaycaster.intersectObjects(
        [...terrainMeshes, ...blockMeshSurfaces], false
      );

      let previewCenter: THREE.Vector3 | null = null;
      let hitPtForPlace: THREE.Vector3 | null = null;
      let previewOnTerrain = false;

      if (surfaceHits.length > 0) {
        const hit = surfaceHits[0];
        const hitPt = hit.point;
        const centerPos = new THREE.Vector3(hitPt.x, hitPt.y + bSize / 2, hitPt.z);
        if (!isPositionOccupied(centerPos, bSize) &&
            cube.position.distanceTo(centerPos) >= SPHERE_RADIUS + bSize * 0.4) {
          previewCenter = centerPos;
          hitPtForPlace = hitPt.clone();
          previewOnTerrain = terrainMeshes.includes(hit.object as THREE.Mesh);
        }
      } else {
        // Void below — bridge: top of block flush with player foot level
        const feetY = cube.position.y - SPHERE_RADIUS;
        const centerPos = new THREE.Vector3(aheadX, feetY - bSize / 2, aheadZ);
        if (!isPositionOccupied(centerPos, bSize) &&
            cube.position.distanceTo(centerPos) >= SPHERE_RADIUS + bSize * 0.4) {
          previewCenter = centerPos;
          hitPtForPlace = new THREE.Vector3(aheadX, feetY - bSize, aheadZ);
          previewOnTerrain = false;
        }
      }

      if (previewCenter) {
        // Build preview geometry with hidden faces so the merge is visible in preview too
        const hidden = getHiddenFaces(previewCenter, bSize);
        const previewGeo = buildBlockGeo(bSize, hidden);
        blockPreviewMesh.geometry.dispose();
        blockPreviewMesh.geometry = previewGeo;
        const edgesChild = blockPreviewMesh.children[0] as THREE.LineSegments | undefined;
        if (edgesChild) {
          edgesChild.geometry.dispose();
          edgesChild.geometry = new THREE.EdgesGeometry(previewGeo);
        }
        blockPreviewMesh.scale.set(1, 1, 1);
        blockPreviewMesh.position.copy(previewCenter);
        blockPreviewMesh.visible = true;
        (blockPreviewMesh.material as THREE.MeshStandardMaterial).opacity = 0.45;
        blockPlacePos = hitPtForPlace;
        blockPlaceOnTerrain = previewOnTerrain;
      } else {
        blockPreviewMesh.visible = false;
        blockPlacePos = null;
      }
    } else {
      blockPreviewMesh.visible = false;
      blockPlacePos = null;
    }

    // ── Mining ──────────────────────────────────────────────────────────────
    const miningSpeed = (getItem(mainId)?.stats?.['miningSpeed'] as number | undefined) ?? 0;

    if (isMouseDownLeft && miningSpeed > 0 && !isInventoryOpen()) {
      // Forward ray from player chest toward facing direction
      _blockRayDir.set(forwardX, 0, forwardZ);
      blockRaycaster.set(
        new THREE.Vector3(cube.position.x, cube.position.y + 0.3, cube.position.z),
        _blockRayDir
      );
      blockRaycaster.far = 5;

      const blockMeshes = placedBlocks.map(b => b.mesh);
      const blockHits = blockRaycaster.intersectObjects(blockMeshes, false);

      if (blockHits.length > 0) {
        const hitMesh = blockHits[0].object as THREE.Mesh;
        const hitBlock = placedBlocks.find(b => b.mesh === hitMesh) ?? null;

        if (hitBlock) {
          if (miningBlock !== hitBlock) {
            miningBlock = hitBlock;
            miningProgress = 0;
            const def = getItem(hitBlock.id)?.block;
            miningTotalTime = (def?.hardness ?? 5) / miningSpeed;
          }

          miningProgress += dt;
          setMiningProgress(miningProgress / miningTotalTime);

          if (!weaponAnimator.isAttacking()) {
            weaponAnimator.onMouseDown(0);
          }

          if (miningProgress >= miningTotalTime) {
            const minedId = miningBlock.id;
            const dropPos  = miningBlock.mesh.position.clone();
            removeBlock(miningBlock);
            miningBlock = null;
            miningProgress = 0;
            setMiningProgress(null);
            worldDrops.spawn(minedId, 1, dropPos, new THREE.Vector3(forwardX, 0, forwardZ));
          }
        } else {
          miningBlock = null;
          miningProgress = 0;
          setMiningProgress(null);
        }
      } else {
        miningBlock = null;
        miningProgress = 0;
        setMiningProgress(null);
      }
    } else if (!isMouseDownLeft || miningSpeed === 0) {
      if (miningBlock) {
        miningBlock = null;
        miningProgress = 0;
        setMiningProgress(null);
      }
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  renderer.render(scene, camera);

  previewModel.rotation.y += dt * 0.5;
  previewRenderer.render(previewScene, previewCamera);
}

renderer.setAnimationLoop(animate);

function resizeRendererToDisplaySize(renderer) {
  const canvas = renderer.domElement;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const needResize = canvas.width !== width || canvas.height !== height;
  if (needResize) renderer.setSize(width, height, false);
  return needResize;
}

createInventory();
setHealth(8);

// Mining progress bar
const _miningBar = document.createElement('div');
_miningBar.id = 'mining-progress';
const _miningFill = document.createElement('div');
_miningFill.id = 'mining-progress-fill';
_miningBar.appendChild(_miningFill);
document.body.appendChild(_miningBar);
miningBarEl  = _miningBar;
miningFillEl = _miningFill;

// Give the player some stone to test with
tryAddItem('stone', 20);


document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') {
    e.preventDefault();
    toggleInventory();
    return;
  }

  if (e.code === 'Digit1') selectHotbar(0);
  else if (e.code === 'Digit2') selectHotbar(1);
  else if (e.code === 'Digit3') selectHotbar(2);
  else if (e.code === 'Digit4') selectHotbar(3);
  else if (e.code === 'Digit5') selectHotbar(4);

  if (e.code === 'KeyF') {
    toggleOffhand();
  }

  if (e.code === 'KeyQ' && !isInventoryOpen()) {
    if (e.shiftKey) dropHeldStack();
    else dropHeldOne();
  }
});

const previewRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
previewRenderer.setClearColor(0x000000, 0);
previewRenderer.setPixelRatio(window.devicePixelRatio || 1);
previewRenderer.setSize(280, 400);

const previewScene = new THREE.Scene();
const previewCamera = new THREE.PerspectiveCamera(40, 280 / 400, 0.1, 100);

const previewModel = cube.clone();
const previewPivot = new THREE.Group();
previewPivot.add(previewModel);

const previewRightArm = previewModel.getObjectByName('Sphere009');
const previewLeftArm  = previewModel.getObjectByName('Sphere010');

previewEquipment = new Equipment({
  mainhand: { parent: previewRightArm ?? previewModel, scale: 1 },
  offhand:  { parent: previewLeftArm  ?? previewModel, scale: 1 },
  helmet:    { parent: previewModel, scale: 1 },
  chestplate:{ parent: previewModel, scale: 1 },
});

refreshEquipment();

const box = new THREE.Box3().setFromObject(previewModel);
const center = box.getCenter(new THREE.Vector3());
center.y += 0.5;
previewModel.position.sub(center);

previewScene.add(previewPivot);

const size = box.getSize(new THREE.Vector3());
const maxDim = Math.max(size.x, size.y, size.z);
previewCamera.position.set(0, 0, maxDim * 4);
previewCamera.lookAt(0, 0, 0);

previewScene.add(new THREE.AmbientLight(0xffffff, 1.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
dirLight.position.set(2, 5, 3);
previewScene.add(dirLight);

setCharacterPreview(previewRenderer.domElement);