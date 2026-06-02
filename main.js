import * as THREE from 'three';
import DynamicEnvironment from './environment.js';
import { ChunkManager, getTerrainHeight, findTownSpawn } from './terrain.js';
import { Player } from './player.js';
import { NetworkManager } from './network.js';
import { RemotePlayer } from './remote-player.js';

// --- GLOBAL SETTINGS STATE ---
window.GameSettings = {
    biomeScale: 'realistic',
    worldSeedOffset: 0
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
const uiElement    = document.getElementById('ui');
const settingsMenu = document.getElementById('settingsMenu');

const player = new Player(
    camera,
    document.body,
    uiElement,
    getTerrainHeight,
    (x, z, r) => chunkManager.checkCollision(x, z, r),
    scene
);

player.controls.addEventListener('unlock', () => {
    uiElement.style.display = 'none';
    settingsMenu.style.display = 'block';
});

document.getElementById('btn-resume').addEventListener('click', () => {
    settingsMenu.style.display = 'none';
    player.controls.lock();
});

document.getElementById('setting-biome').addEventListener('change', (e) => {
    window.GameSettings.biomeScale = e.target.value;
});

document.getElementById('setting-time').addEventListener('change', (e) => {
    environment.dayDurationSeconds = parseInt(e.target.value);
});

document.getElementById('btn-regenerate').addEventListener('click', () => {
    window.GameSettings.worldSeedOffset = Math.random() * 100000;
    chunkManager.chunks.forEach(chunk => chunk.dispose());
    chunkManager.chunks.clear();
    const sp = findTownSpawn();
    camera.position.set(sp.x, sp.y, sp.z);
    chunkManager.update(camera.position);
    settingsMenu.style.display = 'none';
    player.controls.lock();
});

// Initial Spawn  — same deterministic point every player lands on
const spawnPoint = findTownSpawn();
camera.position.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);
chunkManager.update(camera.position);

// ─────────────────────────────────────────────
// MULTIPLAYER
// ─────────────────────────────────────────────
const network       = new NetworkManager('ws://localhost:3000');
const remotePlayers = new Map(); // id → RemotePlayer

// Another player joined — spawn them at the SAME town spawn point
network.on('join', (msg) => {
    if (msg.id === network.playerId || remotePlayers.has(msg.id)) return;
    const rp = new RemotePlayer(msg.id, scene, spawnPoint.x, spawnPoint.y, spawnPoint.z);
    remotePlayers.set(msg.id, rp);
    refreshMpHUD();
});

// A player disconnected — remove their mesh
network.on('leave', (msg) => {
    remotePlayers.get(msg.id)?.dispose();
    remotePlayers.delete(msg.id);
    refreshMpHUD();
});

// Full snapshot from the server — create or update every remote player
network.on('snapshot', (msg) => {
    for (const state of (msg.players ?? [])) {
        if (state.id === network.playerId) continue;
        let rp = remotePlayers.get(state.id);
        if (!rp) {
            // Use the position from the snapshot so late-joiners land correctly
            rp = new RemotePlayer(state.id, scene, state.x, state.y, state.z);
            remotePlayers.set(state.id, rp);
            refreshMpHUD();
        }
        rp.applyState(state);
    }
});

// Live position update from one remote player
network.on('state', (msg) => {
    if (msg.id === network.playerId) return;
    let rp = remotePlayers.get(msg.id);
    if (!rp) {
        // Late-join fallback: create at their current position
        rp = new RemotePlayer(msg.id, scene, msg.x, msg.y, msg.z);
        remotePlayers.set(msg.id, rp);
        refreshMpHUD();
    }
    rp.applyState(msg);
});

// Server confirmed we were hit by another player
network.on('hit', (msg) => {
    if (msg.targetId === network.playerId) player.takeDamage(msg.damage);
});

// Server confirmed a kill
network.on('kill', (msg) => {
    remotePlayers.get(msg.targetId)?.die();
});

network.on('disconnect', refreshMpHUD);

network.connect();

// ── Multiplayer HUD (top-right) ──
const mpHUD = document.createElement('div');
mpHUD.style.cssText = 'position:absolute;top:20px;right:20px;color:white;font-family:monospace;font-size:0.85rem;text-align:right;text-shadow:1px 1px 0 #000;z-index:50;pointer-events:none;display:none;line-height:1.8';
document.body.appendChild(mpHUD);

function refreshMpHUD() {
    mpHUD.innerHTML =
        `Players: ${remotePlayers.size + 1}<br>` +
        `Ping: ${network.latency}ms<br>` +
        (network.connected ? '<span style="color:#00ff88">● Online</span>' : '<span style="color:#aaa">● Offline</span>');
}

player.controls.addEventListener('lock',   () => { mpHUD.style.display = 'block'; refreshMpHUD(); });
player.controls.addEventListener('unlock', () => { mpHUD.style.display = 'none'; });

// Broadcast own state 20× per second
let broadcastTimer = 0;

// ─────────────────────────────────────────────
// Render Loop
// ─────────────────────────────────────────────
let prevTime = performance.now();
function animate() {
    requestAnimationFrame(animate);
    const time  = performance.now();
    const delta = Math.min((time - prevTime) / 1000, 0.1);

    environment.update(delta, camera.position);
    player.update(delta);
    chunkManager.update(camera.position);
    chunkManager.updateEntities(delta, getTerrainHeight, player);

    // Update remote player meshes
    remotePlayers.forEach(rp => rp.update(delta));

    // Broadcast own position to the server
    broadcastTimer += delta;
    if (broadcastTimer >= 1 / 20) {
        broadcastTimer = 0;
        network.sendState({
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z,
            rotY: camera.rotation.y,
            health: player.health,
            weapon: player.currentWeaponIndex,
            // Tell the server the canonical spawn so new joiners get it
            spawnX: spawnPoint.x,
            spawnY: spawnPoint.y,
            spawnZ: spawnPoint.z,
        });
        if (network.connected) refreshMpHUD();
    }

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
