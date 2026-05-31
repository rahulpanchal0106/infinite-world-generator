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

const terrainMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x3d5c3d, roughness: 1.0 
});

// Shared Geometries & Materials for all vegetation/props
const trunkGeo = new THREE.CylinderGeometry(0.5, 0.8, 4, 5);
const leavesGeo = new THREE.ConeGeometry(3, 8, 5);
trunkGeo.translate(0, 2, 0); 
leavesGeo.translate(0, 7, 0); 

// New: Bushes (Round low-poly shapes) and Rocks
const bushGeo = new THREE.IcosahedronGeometry(2, 0);
bushGeo.translate(0, 1.5, 0);
const rockGeo = new THREE.DodecahedronGeometry(1.5, 0);

const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3219, flatShading: true });
const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2b4222, flatShading: true });
const bushMat = new THREE.MeshStandardMaterial({ color: 0x34542a, flatShading: true });
const rockMat = new THREE.MeshStandardMaterial({ color: 0x888888, flatShading: true, roughness: 0.9 });

class Chunk {
    constructor(chunkX, chunkZ, scene) {
        this.chunkX = chunkX;
        this.chunkZ = chunkZ;
        this.scene = scene;
        this.meshes = []; 

        this.buildTerrain();
        this.buildDetails(); // Renamed from buildForest
    }

    buildTerrain() {
        const geometry = new THREE.PlaneGeometry(chunkSize, chunkSize, chunkResolution, chunkResolution);
        geometry.rotateX(-Math.PI / 2);

        const positions = geometry.attributes.position.array;
        const offsetX = this.chunkX * chunkSize;
        const offsetZ = this.chunkZ * chunkSize;

        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i] + offsetX;
            const z = positions[i + 2] + offsetZ;
            positions[i + 1] = getTerrainHeight(x, z);
        }
        
        geometry.computeVertexNormals(); 
        const terrain = new THREE.Mesh(geometry, terrainMaterial);
        terrain.position.set(offsetX, 0, offsetZ);
        terrain.receiveShadow = true; 
        
        this.scene.add(terrain);
        this.meshes.push(terrain);
    }

    buildDetails() {
        // Max items per chunk to keep performance high
        const maxTrees = 150; 
        const maxBushes = 300;
        const maxRocks = 100;
        
        const treeData = [];
        const bushData = [];
        const rockData = [];
        
        const offsetX = this.chunkX * chunkSize;
        const offsetZ = this.chunkZ * chunkSize;

        // Sample random points in the chunk
        for(let i = 0; i < 1500; i++) {
            const lx = (Math.random() - 0.5) * chunkSize; 
            const lz = (Math.random() - 0.5) * chunkSize; 
            const gx = lx + offsetX; 
            const gz = lz + offsetZ; 
            const gy = getTerrainHeight(gx, gz);

            // Only place things on valid land (above the water level we will add)
            if (gy > 22 && gy < 80) { 
                const rand = Math.random();
                if (rand < 0.1 && treeData.length < maxTrees) treeData.push({ lx, gy, lz });
                else if (rand < 0.4 && bushData.length < maxBushes) bushData.push({ lx, gy, lz });
                else if (rand < 0.5 && rockData.length < maxRocks) rockData.push({ lx, gy, lz });
            }
        }

        const dummyMatrix = new THREE.Object3D();

        // Helper function to build InstancedMeshes
        const buildInstanced = (geo, mat, data, castShadow, scaleVariance) => {
            if (data.length === 0) return null;
            const mesh = new THREE.InstancedMesh(geo, mat, data.length);
            mesh.castShadow = castShadow; 
            mesh.receiveShadow = true;
            mesh.position.set(offsetX, 0, offsetZ);
            
            data.forEach((pos, index) => {
                const scale = scaleVariance.min + Math.random() * scaleVariance.range; 
                dummyMatrix.position.set(pos.lx, pos.gy - 0.5, pos.lz); // Sink slightly into ground
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
}