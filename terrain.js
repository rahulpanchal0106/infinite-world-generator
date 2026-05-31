import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

const noise2D = createNoise2D();

// --- 1. GLOBAL MATH ---
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

// --- 2. CHUNK SETTINGS ---
const chunkSize = 400; // Size of each square chunk
const chunkResolution = 50; // High detail for smooth hills

// We create materials ONCE globally so the GPU doesn't cry
const terrainMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x3d5c3d, roughness: 1.0 // Notice flatShading is gone for realistic curves!
});

// Shared Tree Geometry & Materials
const trunkGeo = new THREE.CylinderGeometry(0.5, 0.8, 4, 5);
const leavesGeo = new THREE.ConeGeometry(3, 8, 5);
trunkGeo.translate(0, 2, 0); 
leavesGeo.translate(0, 7, 0); 
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3219, flatShading: true });
const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2b4222, flatShading: true });

// --- 3. THE CHUNK CLASS ---
// This represents a single 400x400 piece of the world
class Chunk {
    constructor(chunkX, chunkZ, scene) {
        this.chunkX = chunkX;
        this.chunkZ = chunkZ;
        this.scene = scene;
        this.meshes = []; // Keep track so we can delete them later!

        this.buildTerrain();
        this.buildForest();
    }

    buildTerrain() {
        const geometry = new THREE.PlaneGeometry(chunkSize, chunkSize, chunkResolution, chunkResolution);
        geometry.rotateX(-Math.PI / 2);

        const positions = geometry.attributes.position.array;
        const offsetX = this.chunkX * chunkSize;
        const offsetZ = this.chunkZ * chunkSize;

        for (let i = 0; i < positions.length; i += 3) {
            // Calculate global position by adding chunk offset
            const x = positions[i] + offsetX;
            const z = positions[i + 2] + offsetZ;
            positions[i + 1] = getTerrainHeight(x, z);
        }
        
        geometry.computeVertexNormals(); 
        
        const terrain = new THREE.Mesh(geometry, terrainMaterial);
        // Move the whole chunk to its correct place in the world
        terrain.position.set(offsetX, 0, offsetZ);
        terrain.receiveShadow = true; 
        
        this.scene.add(terrain);
        this.meshes.push(terrain);
    }

    buildForest() {
        const maxTrees = 300; 
        const treePositions = [];
        const offsetX = this.chunkX * chunkSize;
        const offsetZ = this.chunkZ * chunkSize;

        // Hunt for valid spots in this specific chunk
        for(let i = 0; i < 1000; i++) {
            if (treePositions.length >= maxTrees) break;
            const lx = (Math.random() - 0.5) * chunkSize; // Local X
            const lz = (Math.random() - 0.5) * chunkSize; // Local Z
            const gx = lx + offsetX; // Global X
            const gz = lz + offsetZ; // Global Z
            const gy = getTerrainHeight(gx, gz);

            if (gy < 50) treePositions.push({ lx, gy, lz });
        }

        if (treePositions.length === 0) return;

        const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, treePositions.length);
        const leavesMesh = new THREE.InstancedMesh(leavesGeo, leavesMat, treePositions.length);
        trunkMesh.castShadow = true; trunkMesh.receiveShadow = true;
        leavesMesh.castShadow = true; leavesMesh.receiveShadow = true;

        const dummyMatrix = new THREE.Object3D();
        treePositions.forEach((pos, index) => {
            const scale = 0.7 + Math.random() * 0.8; 
            dummyMatrix.position.set(pos.lx, pos.gy, pos.lz);
            dummyMatrix.rotation.y = Math.random() * Math.PI * 2; 
            dummyMatrix.scale.set(scale, scale, scale);
            dummyMatrix.updateMatrix();
            trunkMesh.setMatrixAt(index, dummyMatrix.matrix);
            leavesMesh.setMatrixAt(index, dummyMatrix.matrix);
        });

        trunkMesh.position.set(offsetX, 0, offsetZ);
        leavesMesh.position.set(offsetX, 0, offsetZ);
        
        this.scene.add(trunkMesh);
        this.scene.add(leavesMesh);
        this.meshes.push(trunkMesh, leavesMesh);
    }

    // THE MOST IMPORTANT PART: Deleting the chunk to save memory
    dispose() {
        this.meshes.forEach(mesh => {
            this.scene.remove(mesh);
            mesh.geometry.dispose(); 
            // We don't dispose materials because they are shared!
        });
    }
}

// --- 4. THE CHUNK MANAGER ---
export class ChunkManager {
    constructor(scene) {
        this.scene = scene;
        this.chunks = new Map();
        this.chunkRadius = 2; // Loads a 5x5 grid of chunks around the player
    }

    update(playerPosition) {
        // What chunk coordinate is the player currently in?
        const currentChunkX = Math.round(playerPosition.x / chunkSize);
        const currentChunkZ = Math.round(playerPosition.z / chunkSize);

        const activeKeys = new Set();

        // 1. Generate new chunks around the player
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

        // 2. Garbage Collection: Delete chunks left behind
        for (const [key, chunk] of this.chunks.entries()) {
            if (!activeKeys.has(key)) {
                chunk.dispose();
                this.chunks.delete(key);
            }
        }
    }
}