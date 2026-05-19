import * as THREE from 'three';
import { loadMap } from './map/map';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast, StaticGeometryGenerator, MeshBVH } from 'three-mesh-bvh';
import { createInventory, toggleInventory, setCharacterPreview } from './player/gui/inventory';

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
cube.traverse(o => {
  console.log(`${o.type.padEnd(12)} "${o.name}"`);
});
let leftEar = cube.getObjectByName('Sphere001');
let rightEar = cube.getObjectByName('Sphere002');

let leftArm = cube.getObjectByName('Sphere009');
let rightArm = cube.getObjectByName('Sphere010');

scene.add(cube);

const keys = {};
document.addEventListener('keydown', (e) => { keys[e.code] = true; });
document.addEventListener('keyup',   (e) => { keys[e.code] = false; });

const velocity = new THREE.Vector3();
const ACCEL = 1500;
const FRICTION = 10;
const MAX_SPEED = 1000;
const GRAVITY = -30;
const JUMP_SPEED = 12;

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

const cameraForward = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const stepVec = new THREE.Vector3();
let onGround = false;
let lastTime = 0;
let walkPhase = 0;

function animate(time) {
  const dt = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;

  if (resizeRendererToDisplaySize(renderer)) {
    const canvas = renderer.domElement;
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
  }

  camera.getWorldDirection(cameraForward);
  cameraForward.y = 0;
  cameraForward.normalize();
  cameraRight.crossVectors(cameraForward, camera.up).normalize();

  const input = new THREE.Vector3();
  if (keys['KeyW']) input.add(cameraForward);
  if (keys['KeyS']) input.sub(cameraForward);
  if (keys['KeyD']) input.add(cameraRight);
  if (keys['KeyA']) input.sub(cameraRight);
  if (input.lengthSq() > 0) input.normalize();

  velocity.x += input.x * ACCEL * dt;
  velocity.z += input.z * ACCEL * dt;

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

  if (hSpeed > 0.1) {
    const targetAngle = Math.atan2(velocity.x, velocity.z);
    cube.rotation.y = targetAngle;
  }

  walkPhase = (walkPhase ?? 0) + hSpeed * dt * 2;
  rightArm.rotation.z = Math.sin(walkPhase) * 2;
  leftArm.rotation.z  = -Math.cos(walkPhase) * 2;

  rightEar.rotation.x = Math.sin(walkPhase) * 0.6;
  leftEar.rotation.x  = -Math.cos(walkPhase) * 0.6;


  const offset = new THREE.Vector3(10, 15, 10);
  camera.position.copy(cube.position).add(offset);
  camera.lookAt(cube.position);

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

document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') {
    e.preventDefault();
    toggleInventory();
  }
});

const previewRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
previewRenderer.setSize(140, 220);
const previewScene = new THREE.Scene();
const previewCamera = new THREE.PerspectiveCamera(40, 140/220, 0.1, 100);
previewCamera.position.set(5, 0, 5);
previewCamera.lookAt(0, 0, 0);
previewScene.add(new THREE.AmbientLight(0xffffff, 1));

const previewModel = cube.clone();
previewModel.position.set(0, 0, 0);
previewScene.add(previewModel);

setCharacterPreview(previewRenderer.domElement);

