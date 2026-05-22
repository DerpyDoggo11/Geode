import * as THREE from 'three';
import { loadMap } from './map/map';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast, StaticGeometryGenerator, MeshBVH } from 'three-mesh-bvh';
import {
  createInventory, toggleInventory, setCharacterPreview, setHealth, isInventoryOpen,
  handleInventoryMouseMove, handleInventoryMouseUp, handleInventoryMouseDown,
  selectHotbar, toggleOffhand, onEquipChange, refreshEquipment,
  // STEP 5: drop & pickup hooks.
  onItemDrop, tryAddItem, dropHeldOne, dropHeldStack,
} from './player/gui/inventory';
import { Equipment } from './player/gui/equipment';
import { loadItems } from './player/gui/items';
import { WorldDrops, preloadAllDropModels } from './player/gui/worldDrops';


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

scene.add(cube);

const equipment = new Equipment({
  mainhand: { parent: rightArm ?? cube, scale: 1 },
  offhand:  { parent: leftArm  ?? cube, scale: 1 },
  helmet:    { parent: cube, scale: 1 },
  chestplate:{ parent: cube, scale: 1 },
});

let previewEquipment: Equipment | null = null;

onEquipChange((c) => {
  equipment.equip('mainhand',  c.mainhand);
  equipment.equip('offhand',   c.offhand);
  equipment.equip('helmet',    c.helmet);
  equipment.equip('chestplate', c.chestplate);

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
});

document.addEventListener('mousedown', (e) => {
  if (isInventoryOpen()) {
    if (e.button === 0 || e.button === 2) handleInventoryMouseDown(e.button);
    return;
  }
  if (!isPointerLocked) return;
});

document.addEventListener('mouseup', (e) => {
  if (isInventoryOpen()) {
    if (e.button === 0 || e.button === 2) handleInventoryMouseUp(e.button);
    return;
  }
  if (!isPointerLocked) return;
});

document.addEventListener('contextmenu', (e) => e.preventDefault());

const velocity = new THREE.Vector3();
const ACCEL = 450;
const FRICTION = 10;
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

  velocity.x += inX * ACCEL * dt;
  velocity.z += inZ * ACCEL * dt;

  const horizontalFriction = Math.max(0, 1 - FRICTION * dt);
  velocity.x *= horizontalFriction;
  velocity.z *= horizontalFriction;

  const hSpeed = Math.hypot(velocity.x, velocity.z);
  if (hSpeed > maxSpeed) {
    velocity.x *= maxSpeed / hSpeed;
    velocity.z *= maxSpeed / hSpeed;
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

  // STEP 5: animate drops & check pickup. The callback returns true to despawn.
  // tryAddItem returns leftover; if leftover is the full count, nothing fit
  // and the drop stays. Otherwise some/all was absorbed — leave the drop only
  // if some leftover remains, by spawning a replacement smaller pile.
  worldDrops.update(dt, cube.position, (itemId, count) => {
    const leftover = tryAddItem(itemId, count);
    if (leftover === count) return false; // no room — leave drop as is
    if (leftover > 0) {
      // Partial pickup: respawn the remainder so the player can come back for it.
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
  if (rightArm) rightArm.rotation.z = Math.sin(walkPhase) * 0.05;
  if (leftArm)  leftArm.rotation.z  = -Math.cos(walkPhase) * 0.05;
  if (rightEar) rightEar.rotation.x = Math.sin(walkPhase) * 0.2;
  if (leftEar)  leftEar.rotation.x  = -Math.cos(walkPhase) * 0.2;

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
setHealth(10);


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

  // STEP 5: Q = drop one from the held hotbar slot. Shift+Q = drop whole stack.
  // Gated on inventory closed so Q doesn't conflict with future in-inventory keys,
  // and Shift+Q doesn't accidentally fire while sprint-walking through the menu.
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