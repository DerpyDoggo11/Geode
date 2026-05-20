import * as THREE from 'three';
import { loadMap } from './map/map';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast, StaticGeometryGenerator, MeshBVH } from 'three-mesh-bvh';
import { createInventory, toggleInventory, setCharacterPreview, setHealth, isInventoryOpen, handleInventoryMouseMove, handleInventoryMouseUp, handleInventoryMouseDown } from './player/gui/inventory';


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

const gltf = await loader.loadAsync('/models/commander.glb');
cube = gltf.scene;
cube.position.set(0, 10, 0);
cube.traverse(o => {
  if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
});

applyToonShader(cube, 3);
addToonOutline(cube, 0.05);

const MODEL_FORWARD_OFFSET = 0;

let leftEar = cube.getObjectByName('Sphere001');
let rightEar = cube.getObjectByName('Sphere002');
let leftArm = cube.getObjectByName('Sphere009');
let rightArm = cube.getObjectByName('Sphere010');

scene.add(cube);


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
  if (!isPointerLocked) return;
  if (isInventoryOpen()) {
    handleInventoryMouseMove(e.movementX, e.movementY);
    return;
  }
  const dx = e.movementX * MOUSE_SENSITIVITY;
  const shiftHeld = keys['ShiftLeft'] || keys['ShiftRight'];
  if (shiftHeld) {
    lookYawOffset += dx;
  } else {
    cameraYaw -= dx;
  }
});

document.addEventListener('mousedown', (e) => {
  if (!isPointerLocked) return;
  if (isInventoryOpen() && e.button === 0) {
    handleInventoryMouseDown();
  }
});

document.addEventListener('mouseup', (e) => {
  if (!isPointerLocked) return;
  if (isInventoryOpen() && e.button === 0) {
    handleInventoryMouseUp();
  }
});

const velocity = new THREE.Vector3();
const ACCEL = 1500;
const FRICTION = 10;
const MAX_SPEED = 1000;
const GRAVITY = -200;
const JUMP_SPEED = 100;
const WALKABLE_SLOPE = Math.cos(THREE.MathUtils.degToRad(50));
const MAX_STEP_DIST = SPHERE_RADIUS * 0.5;

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

const stepVec = new THREE.Vector3();
let onGround = false;
let lastTime = 0;
let walkPhase = 0;

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

  velocity.x += inX * ACCEL * dt;
  velocity.z += inZ * ACCEL * dt;

  const horizontalFriction = Math.max(0, 1 - FRICTION * dt);
  velocity.x *= horizontalFriction;
  velocity.z *= horizontalFriction;

  const hSpeed = Math.hypot(velocity.x, velocity.z);
  if (hSpeed > MAX_SPEED) {
    velocity.x *= MAX_SPEED / hSpeed;
    velocity.z *= MAX_SPEED / hSpeed;
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
    cube.position.add(stepVec);
    if (resolveCollisions()) groundedThisFrame = true;
  }
  onGround = groundedThisFrame;

  const ROT_SPEED = 12;
  const rotT = 1 - Math.exp(-ROT_SPEED * dt);
  const targetCharYaw = cameraYaw + MODEL_FORWARD_OFFSET;
  cube.rotation.y = lerpAngle(cube.rotation.y, targetCharYaw + 90, rotT);

  const shiftHeld = keys['ShiftLeft'] || keys['ShiftRight'];
  if (!shiftHeld) {
    const k = 1 - Math.exp(-LOOK_SNAPBACK_SPEED * dt);
    lookYawOffset += (0 - lookYawOffset) * k;
  }

  const yaw = cameraYaw + lookYawOffset;
  camera.position.set(
    cube.position.x + Math.sin(yaw) * CAMERA_DIST,
    cube.position.y + CAMERA_HEIGHT,
    cube.position.z + Math.cos(yaw) * CAMERA_DIST
  );
  camera.lookAt(cube.position.x, cube.position.y + 1, cube.position.z);

  walkPhase = (walkPhase ?? 0) + hSpeed * dt * 2;
  if (rightArm) rightArm.rotation.z = Math.sin(walkPhase) * 2;
  if (leftArm)  leftArm.rotation.z  = -Math.cos(walkPhase) * 2;
  if (rightEar) rightEar.rotation.x = Math.sin(walkPhase) * 0.6;
  if (leftEar)  leftEar.rotation.x  = -Math.cos(walkPhase) * 0.6;

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
setHealth(5);


document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') {
    e.preventDefault();
    toggleInventory();
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