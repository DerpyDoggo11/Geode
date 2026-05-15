import * as THREE from 'three';
import { loadMap } from './map';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const light = new THREE.DirectionalLight(0xffffff, 1.5);
light.position.set(-1, 2, 4);
light.castShadow = true;
light.shadow.camera.left = -20;
light.shadow.camera.right = 20;
light.shadow.camera.top = 20;
light.shadow.camera.bottom = -20;
light.shadow.mapSize.width = 2048;
light.shadow.mapSize.height = 2048;
scene.add(light);

const ambient = new THREE.HemisphereLight(0xb1e1ff, 0xb97a20, 0.2);
scene.add(ambient);

const SPHERE_RADIUS = 1;
// const geometry = new THREE.SphereGeometry(SPHERE_RADIUS, 8, 8);
// const material = new THREE.MeshToonMaterial({ color: '#667db4' });
// const cube = new THREE.Mesh(geometry, material);
// cube.castShadow = true;
// cube.position.set(0, 10, 0);
// scene.add(cube);

let cube;
loader.load(
    '/models/commander.glb',
    (gltf) => {
        cube = gltf.scene
        scene.add(cube);
    },
    (xhr) => {
        console.log((xhr.loaded / xhr.total * 100) + '% loaded');
    },
    (error) => {
        console.error('An error happened', error);
    }
);


const map = await loadMap('/map.json', { scene });
scene.add(map.terrain);
for (const m of map.models) scene.add(m);

const keys = {};
document.addEventListener("keydown", (e) => { keys[e.code] = true; });
document.addEventListener("keyup",   (e) => { keys[e.code] = false; });

const velocity = new THREE.Vector3();
const ACCEL = 80;
const FRICTION = 10;
const MAX_SPEED = 10;
const GRAVITY = -30;
const JUMP_SPEED = 12;
const GROUND_TOLERANCE = 0.1;

const downRay = new THREE.Raycaster();
const rayOrigin = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

function getGroundHeight(worldX, worldZ) {
  rayOrigin.set(worldX, 1000, worldZ);
  downRay.set(rayOrigin, DOWN);
  const hits = downRay.intersectObjects(map.collidables, true);
  return hits.length > 0 ? hits[0].point.y : -Infinity;
}

const cameraForward = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
let onGround = false;
let lastTime = 0;

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
  if (keys["KeyW"]) input.add(cameraForward);
  if (keys["KeyS"]) input.sub(cameraForward);
  if (keys["KeyD"]) input.add(cameraRight);
  if (keys["KeyA"]) input.sub(cameraRight);
  if (input.lengthSq() > 0) input.normalize();

  velocity.x += input.x * ACCEL * dt;
  velocity.z += input.z * ACCEL * dt;

  const horizontalFriction = Math.max(0, 1 - FRICTION * dt);
  velocity.x *= horizontalFriction;
  velocity.z *= horizontalFriction;

  const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
  if (horizontalSpeed > MAX_SPEED) {
    velocity.x *= MAX_SPEED / horizontalSpeed;
    velocity.z *= MAX_SPEED / horizontalSpeed;
  }

  velocity.y += GRAVITY * dt;

  if (keys["Space"] && onGround) {
    velocity.y = JUMP_SPEED;
    onGround = false;
  }

  if (keys["KeyR"]) {
    cube.position.set(0, 10, 0);
    velocity.set(0, 0, 0);
  }

  cube.position.addScaledVector(velocity, dt);

  const groundY = getGroundHeight(cube.position.x, cube.position.z);
  const targetY = groundY + SPHERE_RADIUS;
  const distanceAboveGround = cube.position.y - targetY;

  if (distanceAboveGround <= GROUND_TOLERANCE) {
    cube.position.y = targetY;
    if (velocity.y < 0) velocity.y = 0;
    onGround = true;
  } else {
    onGround = false;
  }

  const offset = new THREE.Vector3(5, 10, 5);
  camera.position.copy(cube.position).add(offset);
  camera.lookAt(cube.position);

  cube.rotation.x = time / 2000;
  cube.rotation.y = time / 1000;
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

function resizeRendererToDisplaySize(renderer) {
  const canvas = renderer.domElement;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const needResize = canvas.width !== width || canvas.height !== height;
  if (needResize) {
    renderer.setSize(width, height, false);
  }
  return needResize;
}