import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

const noise2D = createNoise2D();

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

const trunkGeo = new THREE.CylinderGeometry(0.5, 0.8, 4, 5);
const leavesGeo = new THREE.ConeGeometry(3, 8, 5);
trunkGeo.translate(0, 2, 0); 
leavesGeo.translate(0, 7, 0); 

const bushGeo = new THREE.IcosahedronGeometry(2, 0);
bushGeo.translate(0, 1.5, 0);
const rockGeo = new THREE.DodecahedronGeometry(1.5, 0);

const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3219, flatShading: true });
const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2b4222, flatShading: true });
const bushMat = new THREE.MeshStandardMaterial({ color: 0x34542a, flatShading: true });
const rockMat = new THREE.MeshStandardMaterial({ color: 0x666666, flatShading: true, roughness: 0.9 });

class Chunk {
    constructor(chunkX, chunkZ, scene) {
        this.chunkX = chunkX;
        this.chunkZ = chunkZ;
        this.scene = scene;
        this.meshes = []; 
        this.obstacles = []; // NEW: Store invisible collision cylinders here!

        this.buildTerrain();
        this.buildEcosystem(); 
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
        
        this.scene.add(terrain);
        this.meshes.push(terrain);
    }

    buildEcosystem() {
        const maxTrees = 150; 
        const maxBushes = 200;
        const maxRocks = 80;
        
        const treeData = [];
        const bushData = [];
        const rockData = [];
        
        const offsetX = this.chunkX * chunkSize;
        const offsetZ = this.chunkZ * chunkSize;

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

            if (gy > 26) { 
                const rand = Math.random();
                if (slope < 0.8 && gy < treeLine) {
                    if (rand < 0.05 && treeData.length < maxTrees) {
                        treeData.push({ lx, gy, lz });
                        // NEW: Add to collision map! (Radius 1.2)
                        this.obstacles.push({ x: gx, z: gz, r: 1.2 });
                    }
                    else if (rand < 0.15 && bushData.length < maxBushes) bushData.push({ lx, gy, lz }); // Bushes have no collision
                }
                if (rand > 0.95 && rockData.length < maxRocks) {
                    rockData.push({ lx, gy, lz });
                    // NEW: Add to collision map! (Radius 2.0)
                    this.obstacles.push({ x: gx, z: gz, r: 2.0 });
                }
            }
        }

        const dummyMatrix = new THREE.Object3D();

        const buildInstanced = (geo, mat, data, castShadow, scaleVariance) => {
            if (data.length === 0) return null;
            const mesh = new THREE.InstancedMesh(geo, mat, data.length);
            mesh.castShadow = castShadow; 
            mesh.receiveShadow = true;
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

        const trunkMesh = buildInstanced(trunkGeo, trunkMat, treeData, true, {min: 0.7, range: 0.8});
        const leavesMesh = buildInstanced(leavesGeo, leavesMat, treeData, true, {min: 0.7, range: 0.8});
        const bushes = buildInstanced(bushGeo, bushMat, bushData, false, {min: 0.3, range: 0.7});
        const rocks = buildInstanced(rockGeo, rockMat, rockData, true, {min: 0.5, range: 1.5});

        [trunkMesh, leavesMesh, bushes, rocks].forEach(mesh => {
            if (mesh) {
                this.scene.add(mesh);
                this.meshes.push(mesh);
            }
        });
    }

    dispose() {
        this.meshes.forEach(mesh => {
            this.scene.remove(mesh);
            mesh.geometry.dispose(); 
        });
    }
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

    // NEW: Ask all active chunks if the player is hitting an obstacle!
    checkCollision(px, pz, radius) {
        for (const chunk of this.chunks.values()) {
            for (const obs of chunk.obstacles) {
                const dx = px - obs.x;
                const dz = pz - obs.z;
                // Pythagoras: A^2 + B^2 = C^2. If distance squared is less than radii squared, it's a hit!
                if (dx * dx + dz * dz < (obs.r + radius) * (obs.r + radius)) {
                    return true;
                }
            }
        }
        return false;
    }
}