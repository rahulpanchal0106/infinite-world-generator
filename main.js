import * as THREE from 'three';
import DynamicEnvironment from './environment.js';
import { ChunkManager, getTerrainHeight } from './terrain.js';
import { Player } from './player.js';

// 1. Core Setup
const scene = new THREE.Scene();
// Push fog way back to reveal the epic horizon
scene.fog = new THREE.Fog(0x87CEEB, 500, 3500);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
// --- NEW: THE INFINITE OCEAN ---
const waterGeometry = new THREE.PlaneGeometry(8000, 8000);
waterGeometry.rotateX(-Math.PI / 2);
const waterMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x0066ff,
    transparent: true,
    opacity: 0.7,
    roughness: 0.1,
    metalness: 0.1,
    transmission: 0.5 // Gives it a nice glassy, deep look
});
const ocean = new THREE.Mesh(waterGeometry, waterMaterial);
ocean.position.y = 25; // Sea level!
scene.add(ocean);
// 2. Initialize Game Modules
const environment = new DynamicEnvironment(scene, { dayDurationSeconds: 60, cloudSpeed: 40 });

// Start the Infinite Chunk Manager
const chunkManager = new ChunkManager(scene);

const uiElement = document.getElementById('ui');
const player = new Player(camera, document.body, uiElement, getTerrainHeight);

camera.position.set(0, getTerrainHeight(0, 0) + 5, 0);

// 3. Render Loop
let prevTime = performance.now();

function animate() {
    requestAnimationFrame(animate);
    
    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    environment.update(delta);
    player.update(delta);
    
    // TELL THE WORLD WHERE THE PLAYER IS
    chunkManager.update(camera.position);

    // FIX: Lock the sky sphere to the player so you can never walk out of it
    if (environment.skyMesh) {
        environment.skyMesh.position.copy(camera.position);
    }

    // TELL THE WORLD WHERE THE PLAYER IS
    chunkManager.update(camera.position);

    // Lock the sky sphere to the player
    if (environment.skyMesh) {
        environment.skyMesh.position.copy(camera.position);
    }
    
    // NEW: Lock the infinite ocean to the player's X and Z (keep Y at 25)
    ocean.position.x = camera.position.x;
    ocean.position.z = camera.position.z;

    renderer.render(scene, camera);

    renderer.render(scene, camera);
    prevTime = time;
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});