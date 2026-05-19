import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const TEX_COLORS = [
  '#639922', '#EF9F27', '#888780', '#F1EFE8', '#712B13',
];

export interface LightingConfig {
  sunAzimuth: number;
  sunElevation: number;
  sunColor: string;
  sunIntensity: number;
  ambientSkyColor: string;
  ambientGroundColor: string;
  ambientIntensity: number;
  fogEnabled: boolean;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  backgroundColor: string;
}

export interface PointLightData {
  color: number;
  intensity: number;
  range: number;
  offset: [number, number, number];
}

export interface PlacedModelData {
  defIndex: number;
  pos: [number, number, number];
  rotY?: number;
  scale?: number;
  light?: PointLightData;
}

export interface SavedGLBModel {
  defIndex: number;
  name: string;
  source: 'builtin' | 'glb';
  url?: string;
  b64?: string;
}

export interface SavedIsland {
  id: string;
  role: 'player' | 'mid' | 'hub' | 'bridge';
  pos: [number, number, number];
  scale?: number;
  positions: number[];
  indices: number[];
  colors: number[];
}

export interface IslandSaveData {
  version: 6;
  mapType: 'island';
  config: { shading?: 'cel' | 'smooth'; [k: string]: unknown };
  islands: SavedIsland[];
  lighting: LightingConfig;
  glbModels: SavedGLBModel[];
  placed: PlacedModelData[];
}

export interface PlaneSaveData {
  version: 3;
  map: { width: number; length: number; density: number };
  heights: number[];
  vertColors: number[];
  waterY: number;
  voidY: number;
  waterOn: boolean;
  glbModels: SavedGLBModel[];
  placed: PlacedModelData[];
}

export type AnySaveData = IslandSaveData | PlaneSaveData | { version: 4 | 5; mapType: 'island' };

export interface LoadMapOptions {
  applyLightingToScene?: boolean;
  scene?: THREE.Scene | null;
}

export interface LoadedMap {
  terrain: THREE.Object3D;
  water: THREE.Mesh | null;
  models: THREE.Object3D[];
  islands: THREE.Mesh[];
  collidables: THREE.Object3D[];
  lighting: { sun: THREE.DirectionalLight | null; hemi: THREE.HemisphereLight | null };
  mapType: 'island' | 'plane';
  /** Spawn a fresh instance of any model that was in the loaded map's library, by name. */
  spawn: (name: string) => Promise<THREE.Object3D | null>;
}

const loader = new GLTFLoader();
const protoCache = new Map<string, THREE.Object3D>();

function makeToonGradient(): THREE.DataTexture {
  const data = new Uint8Array([64, 140, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function loadProtoFromURL(url: string): Promise<THREE.Object3D> {
  const cached = protoCache.get(url);
  if (cached) return cached;
  const gltf = await loader.loadAsync(url);
  protoCache.set(url, gltf.scene);
  return gltf.scene;
}

async function loadProtoFromBytes(b64: string, cacheKey: string): Promise<THREE.Object3D> {
  const cached = protoCache.get(cacheKey);
  if (cached) return cached;
  const gltf = await loader.parseAsync(base64ToArrayBuffer(b64), '');
  protoCache.set(cacheKey, gltf.scene);
  return gltf.scene;
}

function cloneAndPrepare(proto: THREE.Object3D): THREE.Object3D {
  const inst = proto.clone(true);
  inst.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return inst;
}

function applyLighting(
  scene: THREE.Scene,
  cfg: LightingConfig,
): { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight } {
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

function buildPlaneTerrain(data: PlaneSaveData, gradientMap: THREE.DataTexture): THREE.Mesh {
  const { width, length, density } = data.map;
  const cols = Math.max(2, Math.round(width * density) + 1);
  const rows = Math.max(2, Math.round(length * density) + 1);
  const geo = new THREE.PlaneGeometry(width, length, cols - 1, rows - 1);
  geo.rotateX(-Math.PI / 2);

  const colorArr = new Float32Array(cols * rows * 3);
  const heights = data.heights;
  const posAttr = geo.attributes['position'] as THREE.BufferAttribute;
  for (let i = 0; i < cols * rows; i++) {
    posAttr.setY(i, heights[i] ?? 0);
    const tex = data.vertColors[i] ?? 0;
    const c = new THREE.Color(TEX_COLORS[tex] ?? TEX_COLORS[0]);
    colorArr[i * 3] = c.r;
    colorArr[i * 3 + 1] = c.g;
    colorArr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
  posAttr.needsUpdate = true;
  geo.computeVertexNormals();

  if (geo.index) {
    const orig = geo.index.array;
    const out: number[] = [];
    for (let i = 0; i < orig.length; i += 3) {
      const a = orig[i] ?? 0;
      const b = orig[i + 1] ?? 0;
      const c = orig[i + 2] ?? 0;
      const ha = heights[a] ?? -Infinity;
      const hb = heights[b] ?? -Infinity;
      const hc = heights[c] ?? -Infinity;
      if (ha > data.voidY && hb > data.voidY && hc > data.voidY) {
        out.push(a, b, c);
      }
    }
    geo.setIndex(out);
  }

  const mat = new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function buildIslandsFromBaked(
  data: IslandSaveData,
  gradientMap: THREE.DataTexture,
  shading: 'cel' | 'smooth',
): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
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

    const mat: THREE.Material = shading === 'smooth'
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
    mesh.userData['islandId'] = sav.id;
    mesh.userData['role'] = sav.role;
    meshes.push(mesh);
  }
  return meshes;
}

function buildWater(data: PlaneSaveData, gradientMap: THREE.DataTexture): THREE.Mesh | null {
  if (!data.waterOn) return null;
  const g = new THREE.PlaneGeometry(data.map.width * 1.2, data.map.length * 1.2);
  g.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(g, new THREE.MeshToonMaterial({
    color: 0x378ADD, gradientMap, transparent: true, opacity: 0.6,
  }));
  mesh.position.y = data.waterY;
  return mesh;
}

function isIslandSave(data: { mapType?: string; version?: number }): boolean {
  return data.mapType === 'island'
    || data.version === 4
    || data.version === 5
    || data.version === 6;
}

async function resolveModelProto(g: SavedGLBModel): Promise<THREE.Object3D | null> {
  if (g.source === 'builtin' && g.url) {
    try {
      return await loadProtoFromURL(g.url);
    } catch (err) {
      console.warn(`Built-in "${g.name}" not found at ${g.url}; falling back to embedded bytes if any.`, err);
    }
  }
  if (g.b64) {
    return await loadProtoFromBytes(g.b64, `b64:${g.name}:${g.defIndex}`);
  }
  console.error(`Cannot resolve model "${g.name}" — no URL nor embedded bytes.`);
  return null;
}

/**
 * Load a map JSON exported from the editor. For island maps (v6),
 * pass `{ scene }` and lighting will be applied automatically.
 *
 *   const map = await loadMap('/voidIslands.json', { scene });
 *   scene.add(map.terrain);
 *   for (const m of map.models) scene.add(m);
 *   // Spawn extra models by name at runtime:
 *   const extra = await map.spawn('Crystal');
 *   if (extra) { extra.position.set(0, 5, 0); scene.add(extra); }
 */
export async function loadMap(url: string, options: LoadMapOptions = {}): Promise<LoadedMap> {
  const applyLightingToScene = options.applyLightingToScene ?? true;
  const scene = options.scene ?? null;

  const data = await fetch(url).then(r => r.json()) as AnySaveData;
  const gradientMap = makeToonGradient();

  let terrain: THREE.Object3D;
  let islands: THREE.Mesh[] = [];
  let water: THREE.Mesh | null = null;
  let lightingHandles: LoadedMap['lighting'] = { sun: null, hemi: null };

  if (isIslandSave(data as { mapType?: string; version?: number })) {
    const d = data as IslandSaveData | { version: 4 | 5 };
    if (d.version !== 6) {
      throw new Error(
        `Save format v${d.version} does not contain baked geometry. ` +
        `Open in the editor and re-save to upgrade to v6.`
      );
    }
    const islandData = d as IslandSaveData;
    const shading = (islandData.config?.shading ?? 'cel') as 'cel' | 'smooth';
    islands = buildIslandsFromBaked(islandData, gradientMap, shading);
    const group = new THREE.Group();
    for (const isl of islands) group.add(isl);
    terrain = group;

    if (applyLightingToScene && scene && islandData.lighting) {
      lightingHandles = applyLighting(scene, islandData.lighting);
    }
  } else {
    const planeData = data as PlaneSaveData;
    terrain = buildPlaneTerrain(planeData, gradientMap);
    water = buildWater(planeData, gradientMap);
  }

  const anyData = data as { glbModels?: SavedGLBModel[]; placed?: PlacedModelData[] };
  const savedGLBs = anyData.glbModels ?? [];

  const protosByIndex = new Map<number, THREE.Object3D>();
  const protosByName = new Map<string, THREE.Object3D>();
  for (const g of savedGLBs) {
    const proto = await resolveModelProto(g);
    if (!proto) continue;
    protosByIndex.set(g.defIndex, proto);
    protosByName.set(g.name, proto);
    protosByName.set(g.name.toLowerCase(), proto);
  }

  const models: THREE.Object3D[] = [];
  for (const p of anyData.placed ?? []) {
    const proto = protosByIndex.get(p.defIndex);
    if (!proto) continue;
    const m = cloneAndPrepare(proto);
    m.position.set(p.pos[0], p.pos[1], p.pos[2]);
    m.rotation.y = p.rotY || 0;
    m.scale.setScalar(p.scale || 1);
    if (p.light) {
      const light = new THREE.PointLight(p.light.color, p.light.intensity, p.light.range, 2);
      light.position.set(p.light.offset[0], p.light.offset[1], p.light.offset[2]);
      m.add(light);
    }
    models.push(m);
  }

  const collidables: THREE.Object3D[] = islands.length > 0
    ? [...islands, ...models]
    : [terrain, ...models];

  const spawn = async (name: string): Promise<THREE.Object3D | null> => {
    let proto = protosByName.get(name) ?? protosByName.get(name.toLowerCase());
    if (!proto) {
      try {
        proto = await loadProtoFromURL(`/models/${name.toLowerCase()}.glb`);
        protosByName.set(name, proto);
        protosByName.set(name.toLowerCase(), proto);
      } catch (err) {
        console.error(`spawn("${name}"): not in map library and no /models/${name.toLowerCase()}.glb found.`, err);
        return null;
      }
    }
    return cloneAndPrepare(proto);
  };

  return {
    terrain,
    water,
    models,
    islands,
    collidables,
    lighting: lightingHandles,
    mapType: isIslandSave(data as { mapType?: string; version?: number }) ? 'island' : 'plane',
    spawn,
  };
}