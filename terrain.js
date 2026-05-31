import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

const noise2D = createNoise2D();
export const worldSize = 2000;

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

export function buildTerrain(scene) {
    const geometry = new THREE.PlaneGeometry(worldSize, worldSize, 150, 150);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position.array;
    for (let i = 0; i < positions.length; i += 3) {
        positions[i + 1] = getTerrainHeight(positions[i], positions[i + 2]);
    }
    geometry.computeVertexNormals(); 

    const material = new THREE.MeshStandardMaterial({ 
        color: 0x3d5c3d, flatShading: true, roughness: 1.0 
    });
    const terrain = new THREE.Mesh(geometry, material);
    terrain.receiveShadow = true; 
    scene.add(terrain);
}

export function buildForest(scene) {
    const treeCount = 3000;
    const trunkGeo = new THREE.CylinderGeometry(0.5, 0.8, 4, 5);
    const leavesGeo = new THREE.ConeGeometry(3, 8, 5);
    trunkGeo.translate(0, 2, 0); 
    leavesGeo.translate(0, 7, 0); 

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3219, flatShading: true });
    const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2b4222, flatShading: true });

    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    const leavesMesh = new THREE.InstancedMesh(leavesGeo, leavesMat, treeCount);
    trunkMesh.castShadow = true; trunkMesh.receiveShadow = true;
    leavesMesh.castShadow = true; leavesMesh.receiveShadow = true;

    const dummyMatrix = new THREE.Object3D();
    let placedTrees = 0;

    for(let i=0; i < 20000; i++) {
        if(placedTrees >= treeCount) break;
        const tx = (Math.random() - 0.5) * worldSize;
        const tz = (Math.random() - 0.5) * worldSize;
        const ty = getTerrainHeight(tx, tz);

        if(ty < 50) {
            const scale = 0.7 + Math.random() * 0.8; 
            dummyMatrix.position.set(tx, ty, tz);
            dummyMatrix.rotation.y = Math.random() * Math.PI * 2; 
            dummyMatrix.scale.set(scale, scale, scale);
            dummyMatrix.updateMatrix();

            trunkMesh.setMatrixAt(placedTrees, dummyMatrix.matrix);
            leavesMesh.setMatrixAt(placedTrees, dummyMatrix.matrix);
            placedTrees++;
        }
    }
    scene.add(trunkMesh);
    scene.add(leavesMesh);
}