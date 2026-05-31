import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

const noise2D = createNoise2D();

// --- 1. TERRAIN MATH ---
export function getTerrainHeight(x, z) {
    let y = 0;
    let n1 = noise2D(x * 0.001, z * 0.001) * 0.5 + 0.5;
    n1 = Math.pow(n1, 3);
    y += n1 * 300; 
    let n2 = noise2D(x * 0.005, z * 0.005) * 0.5 + 0.5;
    y += n2 * 40;
    let n3 = noise2D(x * 0.05, z * 0.05) * 0.5 + 0.5;
    y += n3 * 3;
    return Math.max(0, y); 
}

const chunkSize = 400; 
const chunkResolution = 50; 
const terrainMaterial = new THREE.MeshStandardMaterial({ color: 0x3d5c3d, roughness: 1.0 });

// --- 2. NATURE GEOMETRIES & MATERIALS ---
const trunkGeo = new THREE.CylinderGeometry(1.0, 1.6, 8, 5); 
const leavesGeo = new THREE.ConeGeometry(6, 16, 5);
trunkGeo.translate(0, 4, 0); 
// Shift leaves up to rest on the taller trunk (with a little overlap)
leavesGeo.translate(0, 14, 0);
const bushGeo = new THREE.IcosahedronGeometry(2, 0);
bushGeo.translate(0, 1.5, 0);
const rockGeo = new THREE.DodecahedronGeometry(1.5, 0);

const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3219, flatShading: true });
const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2b4222, flatShading: true });
const bushMat = new THREE.MeshStandardMaterial({ color: 0x34542a, flatShading: true });
const rockMat = new THREE.MeshStandardMaterial({ color: 0x666666, flatShading: true, roughness: 0.9 });

// --- 3. ARCHITECTURE MATERIALS ---
const wallMat = new THREE.MeshStandardMaterial({ color: 0xe8e5d1, flatShading: true }); // Warmer, rustic plaster
const roofMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21, flatShading: true }); // Dark wood shingle color
const floorMat = new THREE.MeshStandardMaterial({ color: 0x3d2817, flatShading: true }); // Dark floor

// --- 4. THE CHUNK CLASS ---
class Chunk {
    constructor(chunkX, chunkZ, scene) {
        this.chunkX = chunkX;
        this.chunkZ = chunkZ;
        this.scene = scene;
        this.meshes = []; 
        this.obstacles = []; 

        this.buildTerrain();
        this.buildWorld(); 
    }

    buildTerrain() {
        const geometry = new THREE.PlaneGeometry(chunkSize, chunkSize, chunkResolution, chunkResolution);
        geometry.rotateX(-Math.PI / 2);
        const positions = geometry.attributes.position.array;
        const offsetX = this.chunkX * chunkSize;
        const offsetZ = this.chunkZ * chunkSize;

        for (let i = 0; i < positions.length; i += 3) {
            positions[i + 1] = getTerrainHeight(positions[i] + offsetX, positions[i + 2] + offsetZ);
        }
        
        geometry.computeVertexNormals(); 
        const terrain = new THREE.Mesh(geometry, terrainMaterial);
        terrain.position.set(offsetX, 0, offsetZ);
        
        terrain.receiveShadow = true; 
        terrain.castShadow = true; // <--- ADD THIS BRAND NEW LINE
        
        this.scene.add(terrain);
        this.meshes.push(terrain);
    }
    // --- UPGRADED: DETAILED, GROUNDED CABIN ---
    buildHollowCabin(gx, gy, gz, rotationAngle) {
        const cabinGroup = new THREE.Group();
        
        // NEW DIMENSIONS: Smaller footprint, deep foundations
        const wallThickness = 0.8;
        const width = 10;
        const depth = 10;
        const visibleHeight = 7;
        const foundationDepth = 4; // Pushes 4 units underground to hide slopes
        const totalHeight = visibleHeight + foundationDepth;
        const doorWidth = 3;
        const doorHeight = 5; 

        // Center offset so the foundation sinks into the ground
        const yOffset = (totalHeight / 2) - foundationDepth;

        // 1. THE WALLS
        const backWall = new THREE.Mesh(new THREE.BoxGeometry(width, totalHeight, wallThickness), wallMat);
        backWall.position.set(0, yOffset, -depth/2);
        
        const leftWall = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, totalHeight, depth), wallMat);
        leftWall.position.set(-width/2, yOffset, 0);
        
        const rightWall = new THREE.Mesh(new THREE.BoxGeometry(wallThickness, totalHeight, depth), wallMat);
        rightWall.position.set(width/2, yOffset, 0);

        // Front wall split into 3 pieces (Left, Right, and Header above the door)
        const frontWallWidth = (width - doorWidth) / 2;
        const frontLeft = new THREE.Mesh(new THREE.BoxGeometry(frontWallWidth, totalHeight, wallThickness), wallMat);
        frontLeft.position.set(-width/2 + frontWallWidth/2, yOffset, depth/2);
        
        const frontRight = new THREE.Mesh(new THREE.BoxGeometry(frontWallWidth, totalHeight, wallThickness), wallMat);
        frontRight.position.set(width/2 - frontWallWidth/2, yOffset, depth/2);

        const headerHeight = totalHeight - (doorHeight + foundationDepth);
        const frontHeader = new THREE.Mesh(new THREE.BoxGeometry(doorWidth, headerHeight, wallThickness), wallMat);
        frontHeader.position.set(0, totalHeight - headerHeight/2 - foundationDepth, depth/2);

        // 2. TIMBER FRAME CORNER PILLARS (Hides the ugly seams!)
        const pillarGeo = new THREE.BoxGeometry(1.2, totalHeight + 0.5, 1.2);
        const p1 = new THREE.Mesh(pillarGeo, trunkMat); p1.position.set(-width/2, yOffset, -depth/2);
        const p2 = new THREE.Mesh(pillarGeo, trunkMat); p2.position.set(width/2, yOffset, -depth/2);
        const p3 = new THREE.Mesh(pillarGeo, trunkMat); p3.position.set(-width/2, yOffset, depth/2);
        const p4 = new THREE.Mesh(pillarGeo, trunkMat); p4.position.set(width/2, yOffset, depth/2);

        // 3. FLOOR & ROOF
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(width - 1.5, depth - 1.5), floorMat);
        floor.rotateX(-Math.PI / 2);
        floor.position.set(0, 0.2, 0); // Sits just slightly above the grass

        // Roof is now wider than the house (radius 8 vs width 10) to create overhangs
        const roof = new THREE.Mesh(new THREE.ConeGeometry(8.5, 5, 4), roofMat);
        roof.rotateY(Math.PI / 4);
        roof.position.set(0, visibleHeight + 2.5, 0); 

        // Add everything to the group
        [backWall, leftWall, rightWall, frontLeft, frontRight, frontHeader, p1, p2, p3, p4, floor, roof].forEach(m => {
            m.castShadow = true;
            m.receiveShadow = true;
            cabinGroup.add(m);
        });

        cabinGroup.position.set(gx, gy, gz);
        cabinGroup.rotation.y = rotationAngle;
        
        this.scene.add(cabinGroup);
        this.meshes.push(cabinGroup);

        // 4. PHYSICS COLLISIONS
        cabinGroup.updateMatrixWorld(true);

        const addWallCollision = (mesh) => {
            const box = new THREE.Box3().setFromObject(mesh);
            this.obstacles.push({
                type: 'box',
                minX: box.min.x, maxX: box.max.x,
                minZ: box.min.z, maxZ: box.max.z
            });
        };

        // We only add collision to the ground-level walls, leaving the door open
        addWallCollision(backWall);
        addWallCollision(leftWall);
        addWallCollision(rightWall);
        addWallCollision(frontLeft);
        addWallCollision(frontRight);
    }

    buildWorld() {
        const treeData = [], bushData = [], rockData = [];
        const offsetX = this.chunkX * chunkSize;
        const offsetZ = this.chunkZ * chunkSize;
        const houseLocations = []; 

        for(let i = 0; i < 4000; i++) {
            const lx = (Math.random() - 0.5) * chunkSize; 
            const lz = (Math.random() - 0.5) * chunkSize; 
            const gx = lx + offsetX; 
            const gz = lz + offsetZ; 
            const gy = getTerrainHeight(gx, gz);
            const gyNext = getTerrainHeight(gx + 1, gz);
            const slope = Math.abs(gyNext - gy);

            const moisture = noise2D(gx * 0.002 + 10000, gz * 0.002 + 10000) * 0.5 + 0.5;
            const treeLine = 40 + (moisture * 160); 
            const townNoise = noise2D(gx * 0.0003 - 5000, gz * 0.0003 - 5000) * 0.5 + 0.5;

            if (gy > 26) { 
                const rand = Math.random();
                let insideHouseRadius = false;

                houseLocations.forEach(h => {
                    const dx = gx - h.x; const dz = gz - h.z;
                    if (dx*dx + dz*dz < 250) insideHouseRadius = true; // Reduced clearance for smaller houses
                });
                
                if (townNoise > 0.92 && slope < 0.25 && gy < 80) {
                    if (rand < 0.15 && !insideHouseRadius && houseLocations.length < 15) {
                        const streetRotation = Math.floor(Math.random() * 4) * (Math.PI / 2);
                        this.buildHollowCabin(gx, gy, gz, streetRotation);
                        houseLocations.push({x: gx, z: gz});
                        insideHouseRadius = true; 
                    }
                } 
                
                if (!insideHouseRadius) {
                    const isTownZone = townNoise > 0.92;
                    const treeChance = isTownZone ? 0.01 : 0.05; 

                    if (slope < 0.8 && gy < treeLine) {
                        if (rand < treeChance && treeData.length < 150) {
                            treeData.push({ lx, gy, lz });
                            this.obstacles.push({ type: 'circle', x: gx, z: gz, r: 1.2 });
                        }
                        else if (rand < 0.15 && bushData.length < 200) bushData.push({ lx, gy, lz });
                    }
                }
                
                if (rand > 0.95 && rockData.length < 80 && !insideHouseRadius) {
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
                const scale = scaleVariance.min + Math.random() * scaleVariance.range; 
                dummyMatrix.position.set(pos.lx, pos.gy - 0.2, pos.lz); 
                dummyMatrix.rotation.y = Math.random() * Math.PI * 2; 
                dummyMatrix.scale.set(scale, scale, scale);
                dummyMatrix.updateMatrix();
                mesh.setMatrixAt(index, dummyMatrix.matrix);
            });
            return mesh;
        };

        const meshesToAdd = [
            buildInstanced(trunkGeo, trunkMat, treeData, true, {min: 0.7, range: 0.8}),
            buildInstanced(leavesGeo, leavesMat, treeData, true, {min: 0.7, range: 0.8}),
            buildInstanced(bushGeo, bushMat, bushData, false, {min: 0.3, range: 0.7}),
            buildInstanced(rockGeo, rockMat, rockData, true, {min: 0.5, range: 1.5})
        ];

        meshesToAdd.forEach(mesh => {
            if (mesh) {
                this.scene.add(mesh);
                this.meshes.push(mesh);
            }
        });
    }

    dispose() {
        this.meshes.forEach(mesh => {
            if (mesh.isGroup) {
                mesh.children.forEach(child => {
                    if (child.geometry) child.geometry.dispose();
                });
            } else if (mesh.geometry) {
                mesh.geometry.dispose(); 
            }
            this.scene.remove(mesh);
        });
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
            const townNoise = noise2D(gx * 0.0003 - 5000, gz * 0.0003 - 5000) * 0.5 + 0.5;
            
            if (townNoise > 0.92) {
                const gy = getTerrainHeight(gx, gz);
                if (gy > 26 && gy < 80) {
                    const gyNext = getTerrainHeight(gx + 1, gz);
                    if (Math.abs(gyNext - gy) < 0.25) return { x: gx, y: gy + 5, z: gz }; 
                }
            }
        }
        searchRadius += step;
    }
    return { x: 0, y: getTerrainHeight(0, 0) + 5, z: 0 };
}

export class ChunkManager {
    constructor(scene) {
        this.scene = scene;
        this.chunks = new Map();
        this.chunkRadius = 4; 
    }

    update(playerPosition) {
        const currentChunkX = Math.round(playerPosition.x / chunkSize);
        const currentChunkZ = Math.round(playerPosition.z / chunkSize);
        const activeKeys = new Set();

        for (let x = -this.chunkRadius; x <= this.chunkRadius; x++) {
            for (let z = -this.chunkRadius; z <= this.chunkRadius; z++) {
                const cx = currentChunkX + x;
                const cz = currentChunkZ + z;
                const key = `${cx},${cz}`;
                activeKeys.add(key);

                if (!this.chunks.has(key)) {
                    this.chunks.set(key, new Chunk(cx, cz, this.scene));
                }
            }
        }

        for (const [key, chunk] of this.chunks.entries()) {
            if (!activeKeys.has(key)) {
                chunk.dispose();
                this.chunks.delete(key);
            }
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