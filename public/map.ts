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

function applyLighting(scene, cfg) {
  if (!cfg) return { sun: null, hemi: null };
  const azRad = (cfg.sunAzimuth * Math.PI) / 180;
  const elRad = (cfg.sunElevation * Math.PI) / 180;
  const dist = 50;
  const sun = new THREE.DirectionalLight(cfg.sunColor, cfg.sunIntensity);
  sun.position.set(
    Math.cos(elRad) * Math.cos(azRad) * dist,
    Math.sin(elRad) * dist,
    Math.cos(elRad) * Math.sin(azRad) * dist,
  );
  sun.castShadow = true;
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -60;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  scene.add(sun);

  const hemi = new THREE.HemisphereLight(
    cfg.ambientSkyColor,
    cfg.ambientGroundColor,
    cfg.ambientIntensity,
  );
  scene.add(hemi);

  scene.background = new THREE.Color(cfg.backgroundColor);
  scene.fog = cfg.fogEnabled
    ? new THREE.Fog(cfg.fogColor, cfg.fogNear, cfg.fogFar)
    : null;

  return { sun, hemi };
}

function buildPlaneTerrain(data, gradientMap) {
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
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function buildIslandsFromBaked(data, gradientMap, shading) {
  const meshes = [];
  for (const sav of data.islands) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sav.positions), 3));
    if (sav.colors && sav.colors.length > 0) {
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(sav.colors), 3));
    }
    if (sav.indices && sav.indices.length > 0) {
      geo.setIndex(sav.indices);
    }
    geo.computeVertexNormals();

    const mat = shading === 'smooth'
      ? new THREE.MeshStandardMaterial({
          vertexColors: true,
          side: THREE.DoubleSide,
          roughness: 0.9,
          metalness: 0.0,
        })
      : new THREE.MeshToonMaterial({
          vertexColors: true,
          gradientMap,
          side: THREE.DoubleSide,
        });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(sav.pos[0], sav.pos[1], sav.pos[2]);
    if (sav.scale !== undefined) mesh.scale.setScalar(sav.scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.islandId = sav.id;
    mesh.userData.role = sav.role;
    meshes.push(mesh);
  }
  return meshes;
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

function isIslandSave(data) {
  return data.mapType === 'island'
    || data.version === 4
    || data.version === 5
    || data.version === 6;
}

/**
 * Load a map JSON exported from the editor. For island maps (v6),
 * pass `{ scene }` in options and lighting will be applied automatically.
 *
 *   const map = await loadMap('/voidIslands.json', { scene });
 *   scene.add(map.terrain);
 *   for (const m of map.models) scene.add(m);
 *   // raycast against map.collidables for ground collision
 */
export async function loadMap(url, options = {}) {
  const { applyLightingToScene = true, scene = null } = options;
  const data = await fetch(url).then(r => r.json());
  const gradientMap = makeToonGradient();
  const loader = new GLTFLoader();

  let terrain;
  let islands = [];
  let water = null;
  let lightingHandles = { sun: null, hemi: null };

  if (isIslandSave(data)) {
    if (data.version !== 6) {
      throw new Error(
        `Save format v${data.version} does not contain baked geometry. ` +
        `Open in the editor and re-save to upgrade to v6.`
      );
    }
    const shading = data.config?.shading ?? 'cel';
    islands = buildIslandsFromBaked(data, gradientMap, shading);
    terrain = new THREE.Group();
    for (const isl of islands) terrain.add(isl);

    if (applyLightingToScene && scene && data.lighting) {
      lightingHandles = applyLighting(scene, data.lighting);
    }
  } else {
    terrain = buildPlaneTerrain(data, gradientMap);
    water = buildWater(data, gradientMap);
  }

  const protos = new Map();
  for (const g of data.glbModels || []) {
    const buf = base64ToArrayBuffer(g.b64);
    const gltf = await loader.parseAsync(buf, '');
    protos.set(g.defIndex, gltf.scene);
  }

  const models = [];
  for (const p of data.placed || []) {
    const proto = protos.get(p.defIndex);
    if (!proto) continue;
    const m = proto.clone(true);
    m.position.set(p.pos[0], p.pos[1], p.pos[2]);
    m.rotation.y = p.rotY || 0;
    m.scale.setScalar(p.scale || 1);
    m.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    if (p.light) {
      const light = new THREE.PointLight(p.light.color, p.light.intensity, p.light.range, 2);
      light.position.set(...p.light.offset);
      m.add(light);
    }
    models.push(m);
  }

  const collidables = islands.length > 0
    ? [...islands, ...models]
    : [terrain, ...models];

  return {
    terrain,
    water,
    models,
    islands,
    collidables,
    lighting: lightingHandles,
    mapType: isIslandSave(data) ? 'island' : 'plane',
  };
}
