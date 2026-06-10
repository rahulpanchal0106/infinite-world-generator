import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { Animal, PlayerBase, Monster } from './entities.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Fixed-seed PRNG — every browser gets identical terrain and the same spawn point
function mulberry32(seed) {
    return () => {
        seed |= 0;
        seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

const noise2D = createNoise2D(mulberry32(12345));

export function getBiomeData(x, z) {
    const seed = window.GameSettings ? window.GameSettings.worldSeedOffset : 0;
    
    // THE FIX: The perfect middle ground.
    // Realistic: 0.0001 (Biomes span ~10,000 units. A massive, immersive journey.)
    // Arcade: 0.0004 (Biomes span ~2,500 units. About 6 chunks wide.)
    const scale = (window.GameSettings && window.GameSettings.biomeScale === 'realistic') ? 0.0001 : 0.0004;
    
    return {
        temp: noise2D((x + seed) * scale + 8000, (z + seed) * scale + 8000) * 0.5 + 0.5,
        moisture: noise2D((x + seed) * scale + 10000, (z + seed) * scale + 10000) * 0.5 + 0.5,
        // Towns kept slightly more frequent so you can still find them!
        townNoise: noise2D((x + seed) * 0.0008 - 5000, (z +  seed) * 0.0008 - 5000) * 0.5 + 0.5,
        vegNoise: noise2D((x + seed) * 0.008, (z + seed) * 0.008) * 0.5 + 0.5 
    };
}

// --- 1. TERRAIN MATH ---
export function getTerrainHeight(x, z) {
    const seed = window.GameSettings ? window.GameSettings.worldSeedOffset : 0;
    const px = x + seed;
    const pz = z + seed;

    const { temp } = getBiomeData(x, z);

    let y = 0;
    let n1 = noise2D(px * 0.001, pz * 0.001) * 0.5 + 0.5;
    n1 = Math.pow(n1, 3);
    let mountHeight = n1 * 300; 
    let n2 = noise2D(px * 0.005, pz * 0.005) * 0.5 + 0.5;
    let hillHeight = n2 * 40;
    let n3 = noise2D(px * 0.05, pz * 0.05) * 0.5 + 0.5;
    let detailHeight = n3 * 3;

    if (temp > 0.6) {
        const desertBlend = Math.min(1, (temp - 0.6) * 10); 
        mountHeight = mountHeight * (1.0 - (desertBlend * 0.85)); 
        hillHeight = hillHeight * (1.0 - (desertBlend * 0.3));
        y += 28 * desertBlend; 
    }

    y += mountHeight + hillHeight + detailHeight;
    return Math.max(0, y); 
}

const chunkSize = 400;
const chunkResolution = 50;
const MAX_CUSTOM_TREES_PER_CHUNK = 12; // heavy model — cap the per-chunk budget
const TREE_VIEW_RADIUS = 1;            // only render custom trees within ±1 chunk
const LEAF_KEEP_RATIO = 0.5;           // drop half the leaf cards (tris + overdraw)
const HOUSE_VIEW_RADIUS = 2;           // 97k-tri house GLB — cull beyond ±2 chunks
const terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0 });

// --- 2. NATURE GEOMETRIES & MATERIALS ---
const trunkGeo = new THREE.CylinderGeometry(1.0, 1.6, 8, 5);
const leavesGeo = new THREE.ConeGeometry(6, 16, 5);
trunkGeo.translate(0, 4, 0); leavesGeo.translate(0, 14, 0);
const pineLeavesGeo = new THREE.ConeGeometry(4, 20, 5); pineLeavesGeo.translate(0, 12, 0);
const cactusGeo = new THREE.CylinderGeometry(0.8, 0.8, 8, 5); cactusGeo.translate(0, 4, 0);
const rockGeo = new THREE.DodecahedronGeometry(1.5, 0);

const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3219, flatShading: true });
const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2b4222, flatShading: true });
const pineMat = new THREE.MeshStandardMaterial({ color: 0x1a3320, flatShading: true });
const cactusMat = new THREE.MeshStandardMaterial({ color: 0x477a43, flatShading: true });
const rockMat = new THREE.MeshStandardMaterial({ color: 0x88949e, flatShading: true, roughness: 0.9 });

// --- CROSS-PLANE GRASS (Pillar 2) ---
// Two PlaneGeometries intersecting at 90° — 4 triangles total per instance vs 80
// for an IcosahedronGeometry. Canvas-baked grass texture with alphaTest for a
// zero-overdraw cutout look that still responds to scene lighting.
function makeGrassTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const drawBlade = (cx, tipColor) => {
        const g = ctx.createLinearGradient(cx, 62, cx, 2);
        g.addColorStop(0,   'rgba(22,56,12,1)');
        g.addColorStop(0.6, tipColor);
        g.addColorStop(1,   'rgba(90,160,50,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(cx - 3, 62); ctx.lineTo(cx + 3, 62);
        ctx.lineTo(cx + 1,  4); ctx.lineTo(cx - 1,  4);
        ctx.closePath();
        ctx.fill();
    };
    drawBlade(12, 'rgba(55,120,30,1)');
    drawBlade(26, 'rgba(70,145,38,1)');
    drawBlade(38, 'rgba(62,132,34,1)');
    drawBlade(52, 'rgba(50,115,28,1)');
    const tex = new THREE.CanvasTexture(canvas);
    return tex;
}

// Merge two perpendicular planes into one geometry so the pair costs 1 draw call.
const _gA = new THREE.PlaneGeometry(3.5, 3.0); _gA.translate(0, 1.5, 0);
const _gB = new THREE.PlaneGeometry(3.5, 3.0); _gB.rotateY(Math.PI / 2); _gB.translate(0, 1.5, 0);
const grassGeo = mergeGeometries([_gA, _gB]);
const grassMat = new THREE.MeshLambertMaterial({
    map: makeGrassTexture(),
    alphaTest: 0.3,
    side: THREE.DoubleSide,
    transparent: false,
});

// Load custom tree model (AlanTree.fbx).
// The file is Z-up (UpAxis=2) and references textures by absolute Windows
// paths (C:/Users/AWSA/Desktop/Tree/*.tga) that don't exist here. So we:
//   1. rotate it to Y-up,
//   2. replace the broken-texture materials with stylized bark/leaf colours,
//   3. normalise its height and drop the base to y=0,
// wrapping it in a transform-free pivot so each placed tree can take a clean
// random yaw + scale without fighting the axis-correction rotation.
// Baked, ready-to-instance parts: [{ geometry, material }]. Each chunk draws
// ALL its custom trees with one InstancedMesh per part (GPU instancing) instead
// of cloning a full mesh per tree, which was tanking performance.
// Build a position-only sub-geometry from a triangle range, optionally keeping
// only `keepRatio` of the triangles (deterministic so every client matches).
function buildTreeSubGeometry(srcPos, start, count, keepRatio) {
    const triCount = count / 3;
    const out = [];
    let s = (0x9e3779b9 ^ start) >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let t = 0; t < triCount; t++) {
        if (keepRatio < 1 && rnd() > keepRatio) continue;
        const base = (start + t * 3) * 3;
        for (let k = 0; k < 9; k++) out.push(srcPos[base + k]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    geo.computeVertexNormals();
    return geo;
}

let alanTreeParts = null;
const fbxLoader = new FBXLoader();
fbxLoader.load('/models/AlanTree.fbx', (fbx) => {
    fbx.rotation.x = -Math.PI / 2; // Z-up → Y-up

    // Cheap single-sided Lambert (no PBR, no double-sided overdraw) — the
    // biggest fill-rate win for dense foliage on weak GPUs.
    const barkMat = new THREE.MeshLambertMaterial({ color: 0x5b3a1e });
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x3a6b2a });
    // The mesh uses a MATERIAL ARRAY (BroadleafBark + SampleLeaves_2), so map
    // each sub-material by its own name — replacing the whole thing with one
    // material turned the trunk green too.
    const pickMat = (m) => {
        const n = ((m && m.name) || '').toLowerCase();
        const isBark = n.includes('bark') || n.includes('trunk') || n.includes('wood') || n.includes('branch');
        return isBark ? barkMat : leafMat;
    };
    fbx.traverse(c => {
        if (!c.isMesh) return;
        c.material = Array.isArray(c.material) ? c.material.map(pickMat) : pickMat(c.material);
    });

    const pivot = new THREE.Group();
    pivot.add(fbx);

    // Normalise to ~18 units tall, then sit the base on the ground (y=0).
    pivot.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(pivot).getSize(new THREE.Vector3());
    fbx.scale.multiplyScalar(18 / (size.y || 1));
    pivot.updateMatrixWorld(true);
    fbx.position.y -= new THREE.Box3().setFromObject(pivot).min.y;
    pivot.updateMatrixWorld(true);

    // Bake world transform, split by material group, and drop half the leaf
    // triangles. Geometries/materials are built ONCE and shared by every chunk.
    const parts = [];
    pivot.traverse(c => {
        if (!c.isMesh) return;
        let geo = c.geometry.clone();
        geo.applyMatrix4(c.matrixWorld);
        if (geo.index) geo = geo.toNonIndexed();
        const pos = geo.attributes.position.array;
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        const groups = (geo.groups && geo.groups.length)
            ? geo.groups
            : [{ start: 0, count: geo.attributes.position.count, materialIndex: 0 }];
        for (const g of groups) {
            const mat  = mats[g.materialIndex] || mats[0];
            const keep = (mat === leafMat) ? LEAF_KEEP_RATIO : 1.0;
            parts.push({ geometry: buildTreeSubGeometry(pos, g.start, g.count, keep), material: mat });
        }
    });
    alanTreeParts = parts;
}, undefined, (err) => {
    console.error('Error loading AlanTree.fbx:', err);
});

// Medieval house GLB — loaded once, baked into per-part geometries for instancing.
// Same approach as AlanTree: normalise height, sit base at y=0, bake world
// transform into geometry so each placed house can take a clean rotation.
let medievalHouseParts = null;
const gltfLoader = new GLTFLoader();
gltfLoader.load('/models/medieval_house_-_free.glb', (gltf) => {
    const root = gltf.scene;

    // Normalize to ~12 units tall, base at y=0
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const scaleFactor = 12 / (size.y || 1);
    root.scale.setScalar(scaleFactor);
    root.updateMatrixWorld(true);

    const box2 = new THREE.Box3().setFromObject(root);
    root.position.y -= box2.min.y;
    root.updateMatrixWorld(true);

    const parts = [];
    root.traverse(c => {
        if (!c.isMesh) return;
        const geometry = c.geometry.clone();
        geometry.applyMatrix4(c.matrixWorld);
        const mat = c.material;
        parts.push({ geometry, material: Array.isArray(mat) ? mat : mat });
    });
    medievalHouseParts = parts;
}, undefined, (err) => {
    console.error('Error loading medieval_house_-_free.glb:', err);
});

// Seeded per-chunk RNG — same chunk coords always produce same layout on every client
function makeChunkRNG(chunkX, chunkZ) {
    let seed = Math.abs((chunkX * 73856093) ^ (chunkZ * 19349663)) % 2147483647 || 1;
    return () => {
        seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
        return seed / 0x7fffffff;
    };
}

// --- 3. ARCHITECTURE ---
const wallMat = new THREE.MeshStandardMaterial({ color: 0xe8e5d1, flatShading: true }); 
const roofMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21, flatShading: true }); 
const floorMat = new THREE.MeshStandardMaterial({ color: 0x3d2817, flatShading: true }); 

// --- 4. THE CHUNK CLASS ---
class Chunk {
   constructor(chunkX, chunkZ, scene) {
        this.chunkX = chunkX;
        this.chunkZ = chunkZ;
        this.scene = scene;
        this.meshes = [];
        this.obstacles = [];
        this.animals = [];
        this.monsters = [];
        this.treeMeshes = [];   // high-poly custom trees — distance-culled per frame
        this.houseMeshes = [];  // high-poly house GLBs — distance-culled per frame
        this.buildTerrain();
        this.buildWorld(); 
    }

    buildTerrain() {
        const geometry = new THREE.PlaneGeometry(chunkSize, chunkSize, chunkResolution, chunkResolution);
        geometry.rotateX(-Math.PI / 2);
        
        const positions = geometry.attributes.position.array;
        const colors = [];
        const offsetX = this.chunkX * chunkSize;
        const offsetZ = this.chunkZ * chunkSize;

        const cTundra = new THREE.Color(0xc9d4db); 
        const cForest = new THREE.Color(0x3d5c3d); 
        const cDesert = new THREE.Color(0xd2b48c); 
        const cRock = new THREE.Color(0x8a959e); 
        const cSandstone = new THREE.Color(0xb08d6a); 
        const cSnow = new THREE.Color(0xffffff); 

        for (let i = 0; i < positions.length; i += 3) {
            const gx = positions[i] + offsetX;
            const gz = positions[i + 2] + offsetZ;
            const gy = getTerrainHeight(gx, gz);
            positions[i + 1] = gy;

            const { temp } = getBiomeData(gx, gz);
            const vertexColor = new THREE.Color();

            if (temp < 0.4) vertexColor.lerpColors(cTundra, cForest, Math.max(0, (temp - 0.3) * 10));
            else if (temp > 0.6) vertexColor.lerpColors(cForest, cDesert, Math.max(0, (temp - 0.6) * 10));
            else vertexColor.copy(cForest);

            const gyNext = getTerrainHeight(gx + 1, gz);
            const slope = Math.abs(gyNext - gy);

            // UPGRADE: Dynamic Rock and Snow lines based on Temperature!
            const rockLine = 150 + (temp * 60); // Hotter = rocks start higher
            const snowLine = 220 + (temp * 100); // Hotter = snow starts MUCH higher
            
            let rockBlend = Math.max(0, Math.min(1, (slope - 0.6) / 0.4)); 
            let altRockBlend = Math.max(0, Math.min(1, (gy - rockLine) / 40));
            
            let currentRockColor = temp > 0.6 ? cSandstone : cRock;
            vertexColor.lerp(currentRockColor, Math.max(rockBlend, altRockBlend));

            if (gy > snowLine && temp < 0.60) { // Deep deserts never get snow
                let snowBlend = Math.max(0, Math.min(1, (gy - snowLine) / 40));
                let snowStickiness = 1.0 - Math.max(0, Math.min(1, (slope - 0.7) / 0.5));
                vertexColor.lerp(cSnow, snowBlend * snowStickiness);
            }

            colors.push(vertexColor.r, vertexColor.g, vertexColor.b);
        }
        
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.computeVertexNormals(); 
        
        const terrain = new THREE.Mesh(geometry, terrainMaterial);
        terrain.position.set(offsetX, 0, offsetZ);
        terrain.receiveShadow = true; 
        terrain.castShadow = true; 
        
        this.scene.add(terrain);
        this.meshes.push(terrain);
    }

    buildHollowCabin(gx, gy, gz, rotationAngle) {
        if (medievalHouseParts) {
            // Bake world transform into geometry clones, group by material.
            // _flushHouseMeshes() will call mergeGeometries() on each group at
            // the end of buildWorld — collapsing all houses in the chunk into
            // one draw call per unique material instead of N_houses × N_parts.
            const mtx = new THREE.Matrix4().compose(
                new THREE.Vector3(gx, gy, gz),
                new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationAngle),
                new THREE.Vector3(1, 1, 1)
            );
            const aabb = new THREE.Box3();
            medievalHouseParts.forEach(({ geometry, material }) => {
                const mat = Array.isArray(material) ? material[0] : material;
                const geo = geometry.clone();
                geo.applyMatrix4(mtx);
                geo.computeBoundingBox();
                aabb.union(geo.boundingBox);
                if (!this._houseGeosByMat.has(mat)) this._houseGeosByMat.set(mat, []);
                this._houseGeosByMat.get(mat).push(geo);
            });
            if (!aabb.isEmpty()) {
                this.obstacles.push({ type: 'box', minX: aabb.min.x, maxX: aabb.max.x, minZ: aabb.min.z, maxZ: aabb.max.z });
            }
            return;
        }

        // Fallback: procedural cabin used before GLB finishes loading
        const cabinGroup = new THREE.Group();
        const wallThickness = 0.8, width = 10, depth = 10, visibleHeight = 7, foundationDepth = 4;
        const totalHeight = visibleHeight + foundationDepth, doorWidth = 3, doorHeight = 5;
        const yOffset = (totalHeight / 2) - foundationDepth;

        const backWall = new THREE.Mesh(new THREE.BoxGeometry(width, totalHeight, wallThickness), wallMat); backWall.position.set(0, yOffset, -depth/2);
        const leftWall = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, totalHeight, depth), wallMat); leftWall.position.set(-width/2, yOffset, 0);
        const rightWall = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, totalHeight, depth), wallMat); rightWall.position.set(width/2, yOffset, 0);

        const frontWallWidth = (width - doorWidth) / 2;
        const frontLeft = new THREE.Mesh(new THREE.BoxGeometry(frontWallWidth, totalHeight, wallThickness), wallMat); frontLeft.position.set(-width/2 + frontWallWidth/2, yOffset, depth/2);
        const frontRight = new THREE.Mesh(new THREE.BoxGeometry(frontWallWidth, totalHeight, wallThickness), wallMat); frontRight.position.set(width/2 - frontWallWidth/2, yOffset, depth/2);

        const headerHeight = totalHeight - (doorHeight + foundationDepth);
        const frontHeader = new THREE.Mesh(new THREE.BoxGeometry(doorWidth, headerHeight, wallThickness), wallMat); frontHeader.position.set(0, totalHeight - headerHeight/2 - foundationDepth, depth/2);

        const pillarGeo = new THREE.BoxGeometry(1.2, totalHeight + 0.5, 1.2);
        const p1 = new THREE.Mesh(pillarGeo, trunkMat); p1.position.set(-width/2, yOffset, -depth/2);
        const p2 = new THREE.Mesh(pillarGeo, trunkMat); p2.position.set(width/2, yOffset, -depth/2);
        const p3 = new THREE.Mesh(pillarGeo, trunkMat); p3.position.set(-width/2, yOffset, depth/2);
        const p4 = new THREE.Mesh(pillarGeo, trunkMat); p4.position.set(width/2, yOffset, depth/2);

        const floor = new THREE.Mesh(new THREE.PlaneGeometry(width - 1.5, depth - 1.5), floorMat); floor.rotateX(-Math.PI / 2); floor.position.set(0, 0.2, 0);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(8.5, 5, 4), roofMat); roof.rotateY(Math.PI / 4); roof.position.set(0, visibleHeight + 2.5, 0);

        [backWall, leftWall, rightWall, frontLeft, frontRight, frontHeader, p1, p2, p3, p4, floor, roof].forEach(m => {
            m.castShadow = true; m.receiveShadow = true; cabinGroup.add(m);
        });

        cabinGroup.position.set(gx, gy, gz); cabinGroup.rotation.y = rotationAngle;
        this.scene.add(cabinGroup); this.meshes.push(cabinGroup);

        cabinGroup.updateMatrixWorld(true);
        const addWallCollision = (mesh) => {
            const box = new THREE.Box3().setFromObject(mesh);
            this.obstacles.push({ type: 'box', minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z });
        };
        addWallCollision(backWall); addWallCollision(leftWall); addWallCollision(rightWall); addWallCollision(frontLeft); addWallCollision(frontRight);
    }

    buildWorld() {
        const rng = makeChunkRNG(this.chunkX, this.chunkZ); // seeded — identical on every client
        const oakData = [], pineData = [], cactusData = [], bushData = [], rockData = [], alanTreeData = [];
        const offsetX = this.chunkX * chunkSize;
        const offsetZ = this.chunkZ * chunkSize;
        const houseLocations = [];
        this._houseGeosByMat = new Map(); // accumulate world-space house geos; flushed below

        for(let i = 0; i < 4000; i++) {
            const lx = (rng() - 0.5) * chunkSize;
            const lz = (rng() - 0.5) * chunkSize;
            const gx = lx + offsetX;
            const gz = lz + offsetZ;
            const gy = getTerrainHeight(gx, gz);
            const gyNext = getTerrainHeight(gx + 1, gz);
            const slope = Math.abs(gyNext - gy);

            const { temp, moisture, townNoise, vegNoise } = getBiomeData(gx, gz);
            const treeLine = 40 + (moisture * 160);

            if (gy > 26) {
                const rand = rng();
                let insideHouseRadius = false;

                houseLocations.forEach(h => {
                    const dx = gx - h.x; const dz = gz - h.z;
                    if (dx*dx + dz*dz < 250) insideHouseRadius = true;
                });

                if (townNoise > 0.92 && slope < 0.25 && gy < 80 && temp > 0.35 && temp < 0.65) {
                    if (rand < 0.15 && !insideHouseRadius && houseLocations.length < 8) {
                        const streetRotation = Math.floor(rng() * 4) * (Math.PI / 2);
                        this.buildHollowCabin(gx, gy, gz, streetRotation);
                        houseLocations.push({x: gx, z: gz});
                        insideHouseRadius = true;
                    }
                }

                if (!insideHouseRadius) {
                    const isTownZone = townNoise > 0.92;
                    const treeChance = isTownZone ? 0.005 : (0.05 * vegNoise * (moisture + 0.2));

                    if (slope < 0.8 && gy < treeLine) {
                        if (rand < treeChance) {
                            if (temp < 0.35) {
                                pineData.push({ lx, gy, lz });
                                this.obstacles.push({ type: 'circle', x: gx, z: gz, r: 2.5 });
                            } else if (temp > 0.65) {
                                if (rng() > 0.90) {
                                    cactusData.push({ lx, gy, lz });
                                    this.obstacles.push({ type: 'circle', x: gx, z: gz, r: 1.0 });
                                }
                            } else {
                                // Collect for GPU instancing (one draw call per part
                                // for ALL trees in this chunk). The model is ~24k tris,
                                // so cap density per chunk to keep the triangle budget
                                // sane. Fall back to low-poly oak if not loaded yet.
                                if (!alanTreeParts) {
                                    oakData.push({ lx, gy, lz });
                                    this.obstacles.push({ type: 'circle', x: gx, z: gz, r: 2.5 });
                                } else if (alanTreeData.length < MAX_CUSTOM_TREES_PER_CHUNK) {
                                    alanTreeData.push({ lx, gy, lz });
                                    this.obstacles.push({ type: 'circle', x: gx, z: gz, r: 2.5 });
                                }
                            }
                        }
                        else if (rand < 0.15 * vegNoise && temp < 0.65) {
                            bushData.push({ lx, gy, lz });
                        }
                    }
                }

                if (rand > 0.98 && rockData.length < 40 && !insideHouseRadius) {
                    rockData.push({ lx, gy, lz });
                    this.obstacles.push({ type: 'circle', x: gx, z: gz, r: 2.0 });
                }
            }
        }

        const dummyMatrix = new THREE.Object3D();
        const buildInstanced = (geo, mat, data, castShadow, scaleVariance) => {
            if (data.length === 0) return null;
            const mesh = new THREE.InstancedMesh(geo, mat, data.length);
            mesh.castShadow = castShadow; mesh.receiveShadow = true;
            mesh.position.set(offsetX, 0, offsetZ);

            data.forEach((pos, index) => {
                const scale = scaleVariance.min + rng() * scaleVariance.range;
                dummyMatrix.position.set(pos.lx, pos.gy - 0.2, pos.lz);
                dummyMatrix.rotation.y = rng() * Math.PI * 2;
                dummyMatrix.scale.set(scale, scale, scale);
                dummyMatrix.updateMatrix();
                mesh.setMatrixAt(index, dummyMatrix.matrix);
            });
            return mesh;
        };

        const meshesToAdd = [
            buildInstanced(trunkGeo, trunkMat, oakData, true, {min: 0.7, range: 0.8}),
            buildInstanced(leavesGeo, leavesMat, oakData, true, {min: 0.7, range: 0.8}),
            buildInstanced(trunkGeo, trunkMat, pineData, true, {min: 0.8, range: 0.5}),
            buildInstanced(pineLeavesGeo, pineMat, pineData, true, {min: 0.8, range: 0.5}),
            buildInstanced(cactusGeo, cactusMat, cactusData, true, {min: 0.8, range: 1.2}),
            buildInstanced(grassGeo, grassMat, bushData, false, {min: 0.5, range: 0.6}),
            buildInstanced(rockGeo, rockMat, rockData, true, {min: 0.5, range: 1.5})
        ];

        meshesToAdd.forEach(mesh => {
            if (mesh) { this.scene.add(mesh); this.meshes.push(mesh); }
        });

        // Custom AlanTree forest — GPU-instanced (one InstancedMesh per geometry
        // part covers EVERY tree in this chunk). Per-tree transform is computed
        // once and shared by all parts so trunk + leaves stay aligned.
        if (alanTreeParts && alanTreeData.length > 0) {
            const treeMatrices = alanTreeData.map(pos => {
                const s = 0.85 + rng() * 0.3;          // ~15–23 units tall
                dummyMatrix.position.set(pos.lx, pos.gy - 0.2, pos.lz);
                dummyMatrix.rotation.set(0, rng() * Math.PI * 2, 0);
                dummyMatrix.scale.set(s, s, s);
                dummyMatrix.updateMatrix();
                return dummyMatrix.matrix.clone();
            });
            alanTreeParts.forEach(part => {
                const inst = new THREE.InstancedMesh(part.geometry, part.material, treeMatrices.length);
                // Shadows OFF: a 24k-tri tree re-rendered into the shadow map per
                // instance was the main framerate killer. Stylized look survives.
                inst.castShadow = false; inst.receiveShadow = false;
                inst.position.set(offsetX, 0, offsetZ);
                treeMatrices.forEach((m, i) => inst.setMatrixAt(i, m));
                inst.instanceMatrix.needsUpdate = true;
                inst.isCustomTree = true;   // disposal: shared geo/mat must NOT be freed
                this.scene.add(inst);
                this.meshes.push(inst);
                this.treeMeshes.push(inst);
            });
        }

        // Flush house geometry — merge each material group into one Mesh (Pillar 4).
        // Result: entire town = N_unique_materials draw calls instead of N_houses × N_parts.
        this._houseGeosByMat.forEach((geos, mat) => {
            try {
                const merged = mergeGeometries(geos);
                geos.forEach(g => g.dispose()); // free intermediate clones
                if (!merged) return;
                const mesh = new THREE.Mesh(merged, mat);
                mesh.castShadow = false; // merged 97k-tri shadow pass is the main perf killer
                mesh.receiveShadow = true;
                this.scene.add(mesh);
                this.meshes.push(mesh);
                this.houseMeshes.push(mesh);
            } catch (_) {
                geos.forEach(g => g.dispose());
            }
        });
        this._houseGeosByMat = null;

        // Animals — seeded so every client spawns the same ones in the same spots
        const animalCount = Math.floor(rng() * 5);
        for(let i = 0; i < animalCount; i++) {
            const ax = (rng() - 0.5) * chunkSize + offsetX;
            const az = (rng() - 0.5) * chunkSize + offsetZ;
            const ay = getTerrainHeight(ax, az);
            const slope = Math.abs(getTerrainHeight(ax + 1, az) - ay);
            if (ay > 28 && slope < 0.5) {
                const { temp } = getBiomeData(ax, az);
                let type = 'deer';
                if (temp > 0.65) type = 'camel';
                else if (temp < 0.35) type = 'bear';
                const animal = new Animal(type, ax, ay, az, this.scene);
                animal.entityId = `a:${this.chunkX},${this.chunkZ},${i}`;
                this.animals.push(animal);
            }
        }

        const monsterCount = Math.floor(rng() * 2);
        for(let i = 0; i < monsterCount; i++) {
            const mx = (rng() - 0.5) * chunkSize + offsetX;
            const mz = (rng() - 0.5) * chunkSize + offsetZ;
            const my = getTerrainHeight(mx, mz);
            if (my > 22) {
                const monster = new Monster(mx, my, mz, this.scene);
                monster.entityId = `m:${this.chunkX},${this.chunkZ},${i}`;
                this.monsters.push(monster);
            }
        }
    }

    dispose() {
        this.meshes.forEach(mesh => {
            if (mesh.isCustomTree) {
                this.scene.remove(mesh);
                // Frees the per-chunk instance buffer only; the baked geometry
                // and materials are shared across all chunks, so leave them.
                if (mesh.isInstancedMesh) mesh.dispose();
                return;
            }
            // Plain meshes (merged houses, terrain): dispose unique geometry, keep shared materials.
            if (mesh.isGroup) mesh.children.forEach(child => { if (child.geometry) child.geometry.dispose(); });
            else if (mesh.geometry) mesh.geometry.dispose();
            this.scene.remove(mesh);
        });
        // Delete animals!
        this.animals.forEach(animal => animal.dispose()); 
        this.monsters.forEach(monster => monster.dispose());
    }
}

export function findTownSpawn() {
    let searchRadius = 0;
    const step = 40; 
    while (searchRadius < 20000) {
        const circumference = Math.max(1, 2 * Math.PI * searchRadius);
        const angleStep = step / circumference; 
        for (let angle = 0; angle < Math.PI * 2; angle += Math.max(angleStep, 0.1)) {
            const gx = searchRadius * Math.cos(angle);
            const gz = searchRadius * Math.sin(angle);
            
            const { temp, townNoise } = getBiomeData(gx, gz);
            
            // 0.82–0.91: near the town but outside where cabins are built (>0.92)
            if (townNoise > 0.82 && townNoise < 0.91 && temp > 0.35 && temp < 0.65) {
                const gy = getTerrainHeight(gx, gz);
                if (gy > 26 && gy < 80) {
                    const gyNext = getTerrainHeight(gx + 1, gz);
                    if (Math.abs(gyNext - gy) < 0.25) return { x: gx, y: gy + 1.7, z: gz };
                }
            }
        }
        searchRadius += step;
    }
    return { x: 0, y: getTerrainHeight(0, 0) + 1.7, z: 0 };
}

export class ChunkManager {
    constructor(scene) {
        this.scene = scene;
        this.chunks = new Map();
        this.chunkRadius = 4;
        this._treeRebuildDone  = false;  // chunks built before AlanTree.glb loaded use
        this._houseRebuildDone = false;  // low-poly fallbacks — rebuild once models arrive
    }

    update(playerPosition) {
        // The first chunks are built at startup BEFORE the heavy models finish
        // downloading, so they use the old fallback trees/cabins. Once a model
        // becomes available, drop every loaded chunk so it rebuilds with the
        // real model — fixes the "some trees new, some old" inconsistency.
        let needRebuild = false;
        if (!this._treeRebuildDone  && alanTreeParts)      { this._treeRebuildDone  = true; needRebuild = true; }
        if (!this._houseRebuildDone && medievalHouseParts) { this._houseRebuildDone = true; needRebuild = true; }
        if (needRebuild) {
            for (const chunk of this.chunks.values()) chunk.dispose();
            this.chunks.clear();
        }

        const currentChunkX = Math.round(playerPosition.x / chunkSize);
        const currentChunkZ = Math.round(playerPosition.z / chunkSize);
        const activeKeys = new Set();

        for (let x = -this.chunkRadius; x <= this.chunkRadius; x++) {
            for (let z = -this.chunkRadius; z <= this.chunkRadius; z++) {
                const cx = currentChunkX + x;
                const cz = currentChunkZ + z;
                const key = `${cx},${cz}`;
                activeKeys.add(key);

                if (!this.chunks.has(key)) this.chunks.set(key, new Chunk(cx, cz, this.scene));
            }
        }

        for (const [key, chunk] of this.chunks.entries()) {
            if (!activeKeys.has(key)) {
                chunk.dispose();
                this.chunks.delete(key);
                continue;
            }
            // Only render the expensive high-poly models in nearby chunks; hide
            // them in far ones (terrain still shows). Huge triangle-budget saver.
            const dx = Math.abs(chunk.chunkX - currentChunkX);
            const dz = Math.abs(chunk.chunkZ - currentChunkZ);
            if (chunk.treeMeshes.length > 0) {
                const near = dx <= TREE_VIEW_RADIUS && dz <= TREE_VIEW_RADIUS;
                for (const t of chunk.treeMeshes) t.visible = near;
            }
            if (chunk.houseMeshes.length > 0) {
                const near = dx <= HOUSE_VIEW_RADIUS && dz <= HOUSE_VIEW_RADIUS;
                for (const h of chunk.houseMeshes) h.visible = near;
            }
        }
    }
    // Add this right below the ChunkManager update() function
    updateEntities(delta, getTerrainHeightFunc, player) {
     for (const chunk of this.chunks.values()) {
         chunk.animals.forEach(animal => animal.update(delta, getTerrainHeightFunc, player));
         chunk.monsters.forEach(monster => monster.update(delta, getTerrainHeightFunc, player)); // <--- ADD THIS
     }
 }

    checkCollision(px, pz, radius) {
        for (const chunk of this.chunks.values()) {
            for (const obs of chunk.obstacles) {
                if (obs.type === 'circle') {
                    const dx = px - obs.x;
                    const dz = pz - obs.z;
                    if (dx * dx + dz * dz < (obs.r + radius) * (obs.r + radius)) return true;
                } 
                else if (obs.type === 'box') {
                    const closestX = Math.max(obs.minX, Math.min(px, obs.maxX));
                    const closestZ = Math.max(obs.minZ, Math.min(pz, obs.maxZ));
                    const dx = px - closestX;
                    const dz = pz - closestZ;
                    if (dx * dx + dz * dz < radius * radius) return true;
                }
            }
        }
        return false;
    }
}