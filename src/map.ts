import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const TEX_COLORS = [
  '#639922', '#EF9F27', '#888780', '#F1EFE8', '#712B13',
];

function makeToonGradient() {
  const data = new Uint8Array([64, 140, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function buildTerrain(data, gradientMap) {
  const { width, length, density } = data.map;
  const cols = Math.max(2, Math.round(width * density) + 1);
  const rows = Math.max(2, Math.round(length * density) + 1);
  const geo = new THREE.PlaneGeometry(width, length, cols - 1, rows - 1);
  geo.rotateX(-Math.PI / 2);

  const colorArr = new Float32Array(cols * rows * 3);
  const heights = data.heights;
  for (let i = 0; i < cols * rows; i++) {
    geo.attributes.position.setY(i, heights[i]);
    const c = new THREE.Color(TEX_COLORS[data.vertColors[i]] || TEX_COLORS[0]);
    colorArr[i * 3] = c.r;
    colorArr[i * 3 + 1] = c.g;
    colorArr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
  geo.attributes.position.needsUpdate = true;
  geo.computeVertexNormals();

  const orig = geo.index.array;
  const out = [];
  for (let i = 0; i < orig.length; i += 3) {
    const a = orig[i], b = orig[i + 1], c = orig[i + 2];
    if (heights[a] > data.voidY && heights[b] > data.voidY && heights[c] > data.voidY) {
      out.push(a, b, c);
    }
  }
  geo.setIndex(out);

  const mat = new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

function buildWater(data, gradientMap) {
  if (!data.waterOn) return null;
  const g = new THREE.PlaneGeometry(data.map.width * 1.2, data.map.length * 1.2);
  g.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(g, new THREE.MeshToonMaterial({
    color: 0x378ADD, gradientMap, transparent: true, opacity: 0.6,
  }));
  mesh.position.y = data.waterY;
  return mesh;
}

export async function loadMap(url) {
  const data = await fetch(url).then(r => r.json());
  const gradientMap = makeToonGradient();
  const loader = new GLTFLoader();

  const terrain = buildTerrain(data, gradientMap);
  terrain.receiveShadow = true;
  const water = buildWater(data, gradientMap);

  const protos = new Map();
  for (const g of data.glbModels || []) {
    const buf = base64ToArrayBuffer(g.b64);
    const gltf = await loader.parseAsync(buf, '');
    protos.set(g.defIndex, gltf.scene);
  }

  const models = [];
  for (const p of data.placed) {
    const proto = protos.get(p.defIndex);
    if (!proto) continue; 
    const m = proto.clone(true);
    m.position.set(p.pos[0], p.pos[1], p.pos[2]);
    m.rotation.y = p.rotY || 0;
    m.scale.setScalar(p.scale || 1);
    m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    if (p.light) {
      const light = new THREE.PointLight(p.light.color, p.light.intensity, p.light.range, 2);
      light.position.set(...p.light.offset);
      m.add(light);
    }
    models.push(m);
  }

  const collidables = [terrain, ...models];

  return { terrain, water, models, collidables };
}