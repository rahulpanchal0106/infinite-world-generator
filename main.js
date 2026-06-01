import * as THREE from 'three';
import DynamicEnvironment from './environment.js';
import { ChunkManager, getTerrainHeight, findTownSpawn } from './terrain.js';
import { Player } from './player.js';

// --- NEW: GLOBAL SETTINGS STATE ---
window.GameSettings = {
    biomeScale: 'realistic', 
    worldSeedOffset: 0 // Used to randomly generate new worlds
};

// 1. Core Setup
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x87CEEB, 500, 3500);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Infinite Ocean
const waterGeometry = new THREE.PlaneGeometry(8000, 8000);
waterGeometry.rotateX(-Math.PI / 2);
const waterMaterial = new THREE.MeshPhysicalMaterial({ color: 0x0066ff, transparent: true, opacity: 0.7, roughness: 0.1, transmission: 0.5 });
const ocean = new THREE.Mesh(waterGeometry, waterMaterial);
ocean.position.y = 25; 
scene.add(ocean);

// Initialize Game Modules
const environment = new DynamicEnvironment(scene, { dayDurationSeconds: 60, cloudSpeed: 40 });
let chunkManager = new ChunkManager(scene);

// --- UI AND SETTINGS LOGIC ---
const uiElement = document.getElementById('ui');
const settingsMenu = document.getElementById('settingsMenu');
// NEW: We added 'scene' as the final argument so the player's raycaster can check the world
const player = new Player(
    camera, 
    document.body, 
    uiElement, 
    getTerrainHeight, 
    (x, z, r) => chunkManager.checkCollision(x, z, r),
    scene 
);
// When player presses ESC, PointerLock unlocks. We catch that event here:
player.controls.addEventListener('unlock', () => {
    uiElement.style.display = 'none';
    settingsMenu.style.display = 'block'; // Show our new settings menu
});

document.getElementById('btn-resume').addEventListener('click', () => {
    settingsMenu.style.display = 'none';
    player.controls.lock(); // Goes back to the game
});

// Apply Settings
document.getElementById('setting-biome').addEventListener('change', (e) => {
    window.GameSettings.biomeScale = e.target.value;
});

document.getElementById('setting-time').addEventListener('change', (e) => {
    environment.dayDurationSeconds = parseInt(e.target.value);
});

// The "Regenerate World" Nuke Button
document.getElementById('btn-regenerate').addEventListener('click', () => {
    // 1. Change the mathematical seed offset
    window.GameSettings.worldSeedOffset = Math.random() * 100000;
    
    // 2. Delete all existing chunks
    chunkManager.chunks.forEach(chunk => chunk.dispose());
    chunkManager.chunks.clear();

    // 3. Find a new town and teleport!
    const spawnPoint = findTownSpawn();
    camera.position.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);
    chunkManager.update(camera.position);
    
    settingsMenu.style.display = 'none';
    player.controls.lock();
});

// Initial Spawn
const spawnPoint = findTownSpawn();
camera.position.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);
chunkManager.update(camera.position);

// Render Loop
let prevTime = performance.now();
function animate() {
    requestAnimationFrame(animate);
    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    environment.update(delta, camera.position);
    player.update(delta);
    chunkManager.update(camera.position);
    
    // --- NEW: RUN ANIMAL AI ---
    chunkManager.updateEntities(delta, getTerrainHeight, player);
    
    ocean.position.x = camera.position.x;
    ocean.position.z = camera.position.z;

    renderer.render(scene, camera);
    prevTime = time;
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});