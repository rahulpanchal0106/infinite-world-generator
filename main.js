import * as THREE from 'three';
import DynamicEnvironment from './environment.js';
import { ChunkManager, getTerrainHeight, findTownSpawn } from './terrain.js';
import { Player } from './player.js';
import { NetworkManager } from './network.js';
import { RemotePlayer } from './remote-player.js';
import { Minimap } from './minimap.js';
import { PlaneManager } from './plane.js';

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
ocean.layers.set(1); // invisible to raycaster — bullets pass through water
scene.add(ocean);

// Initialize Game Modules
const environment = new DynamicEnvironment(scene, { dayDurationSeconds: 1200, initialTime: 8, cloudSpeed: 40 });
let chunkManager = new ChunkManager(scene);
const planeManager = new PlaneManager(scene);

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

// Plane boarding wiring
player.getNearestPlane = (pos) => planeManager.getNearest(pos);
player.onEnterPlane    = (key) => planeManager.setOccupied(key, true);
player.onExitPlane     = (key, x, z, terrainY) => planeManager.landPlane(key, x, z, terrainY);

// Play button — read name, update NetworkManager, then lock pointer
document.getElementById('btn-play')?.addEventListener('click', (e) => {
    e.stopPropagation();
    network.playerName = getPlayerName();   // set name BEFORE connect so join msg has it
    if (!network.connected) network.connect();
    player.controls.lock();
});

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

// Scatter each player around the spawn point and escape any cabin collision
function safeSpawn(base) {
    // Give each player a unique angle so they spread around the town
    const angle = Math.random() * Math.PI * 2;
    const dist  = 15 + Math.random() * 15;   // 15-30 units away — no overlapping
    let sx = base.x + Math.cos(angle) * dist;
    let sz = base.z + Math.sin(angle) * dist;

    for (let r = 0; r < 80; r += 4) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
            const tx = sx + Math.cos(a) * r;
            const tz = sz + Math.sin(a) * r;
            const ty = getTerrainHeight(tx, tz);
            // Must be on dry land (above ocean level 25) and no collision
            if (ty > 26 && !chunkManager.checkCollision(tx, tz, 1.2)) {
                return { x: tx, y: ty + 1.7, z: tz };
            }
        }
    }
    return { x: sx, y: Math.max(getTerrainHeight(sx, sz), 26) + 1.7, z: sz };
}

// Initial Spawn
let spawnPoint = findTownSpawn();
chunkManager.update(new THREE.Vector3(spawnPoint.x, spawnPoint.y, spawnPoint.z));
const initialSafe = safeSpawn(spawnPoint);
camera.position.set(initialSafe.x, initialSafe.y, initialSafe.z);
chunkManager.update(camera.position);

// ── Game helpers ─────────────────────────────────────────────────────────────
function rebuildWorld(seed) {
    window.GameSettings.worldSeedOffset = seed;
    chunkManager.chunks.forEach(chunk => chunk.dispose());
    chunkManager.chunks.clear();
    spawnPoint = findTownSpawn();
    chunkManager.update(new THREE.Vector3(spawnPoint.x, spawnPoint.y, spawnPoint.z));
    const safe = safeSpawn(spawnPoint);
    camera.position.set(safe.x, safe.y, safe.z);
    chunkManager.update(camera.position);
}

function respawnPlayer() {
    player.exitSpectator();   // leave ghost mode: restore gun, hide banner
    player.health  = 100;
    player.isDead  = false;
    player.score   = 0;
    player.healthUI.innerText = 'Health: 100';
    player.scoreUI.innerText  = 'Score: 0';
    document.getElementById('death-screen').style.display = 'none';
    player.hud.style.display    = 'block';
    player.hotbar.style.display = 'block';
    // Reset killed-by text and kill feed z-index for next round
    const kb = document.getElementById('killed-by');
    if (kb) kb.textContent = '';
    killFeedEl.style.zIndex  = '50';
    _lastAttackerName  = null;
    _wasDeadLastFrame  = false;
}

function showToast(text, ms = 3500) {
    const el = document.createElement('div');
    el.style.cssText = [
        'position:absolute', 'top:40%', 'left:50%',
        'transform:translate(-50%,-50%)',
        'background:rgba(0,0,0,0.82)', 'color:#fff',
        'font-family:monospace', 'font-size:1.4rem',
        'padding:18px 36px', 'border-radius:10px',
        'border:1px solid #555', 'z-index:300',
        'pointer-events:none', 'text-align:center',
        'transition:opacity 0.4s'
    ].join(';');
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, ms);
}

// ─────────────────────────────────────────────
// MULTIPLAYER
// ─────────────────────────────────────────────

// Read name from the input box; fall back if empty
function getPlayerName() {
    const raw = (document.getElementById('nameInput')?.value ?? '').trim();
    return raw.length > 0 ? raw : 'Player';
}

// Auto-detect ws:// vs wss:// (ngrok uses https so needs wss)
// Use same host:port the page was served from — no separate port needed
const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsPort     = location.port ? `:${location.port}` : '';
const network    = new NetworkManager(`${wsProtocol}//${location.hostname}${wsPort}`, getPlayerName());
const remotePlayers = new Map(); // id → RemotePlayer

// Another player joined — spawn them at the SAME town spawn point
network.on('join', (msg) => {
    if (msg.id === network.playerId || remotePlayers.has(msg.id)) return;
    const rp = new RemotePlayer(msg.id, scene, spawnPoint.x, spawnPoint.y, spawnPoint.z, msg.name);
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
        if (rp && rp.isDisposed) {
            remotePlayers.delete(state.id);
            rp = null;
        }
        if (!rp) {
            if (state.isDead) continue;   // eliminated players stay invisible (spectators)
            rp = new RemotePlayer(state.id, scene, state.x, state.y, state.z, state.name);
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
    if (rp && rp.isDisposed) {
        remotePlayers.delete(msg.id);
        rp = null;
    }
    if (!rp) {
        if (msg.isDead) return;   // eliminated players stay invisible (spectators)
        rp = new RemotePlayer(msg.id, scene, msg.x, msg.y, msg.z, msg.name);
        remotePlayers.set(msg.id, rp);
        refreshMpHUD();
    }
    rp.applyState(msg);
});

// ── Kill Feed UI ──────────────────────────────────────────────────────────
const killFeedEl = document.createElement('div');
killFeedEl.style.cssText = [
    'position:absolute', 'top:90px', 'left:20px',
    'font-family:monospace', 'font-size:0.82rem',
    'z-index:50', 'pointer-events:none', 'width:260px'
].join(';');
document.body.appendChild(killFeedEl);

function addKillEntry(killer, victim, isLocalKill, isLocalDeath) {
    const el = document.createElement('div');
    const kColor  = isLocalKill  ? '#ffdd44' : '#ff6666';
    const vColor  = isLocalDeath ? '#ff4444' : '#aaa';
    el.style.cssText = [
        'background:rgba(0,0,0,0.65)', 'padding:4px 10px',
        'margin-bottom:4px', 'border-radius:4px',
        `border-left:3px solid ${kColor}`,
        'transition:opacity 0.5s', 'opacity:1'
    ].join(';');
    el.innerHTML =
        `<span style="color:${kColor};font-weight:bold">${killer}</span>` +
        ` <span style="color:#888">killed</span> ` +
        `<span style="color:${vColor};font-weight:bold">${victim}</span>`;
    killFeedEl.insertBefore(el, killFeedEl.firstChild);
    // Fade out after 6 s
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 500); }, 6000);
    // Max 5 entries
    while (killFeedEl.children.length > 5) killFeedEl.lastChild.remove();
}

// Show/hide with HUD
player.controls.addEventListener('lock',   () => { killFeedEl.style.display = 'block'; });
player.controls.addEventListener('unlock', () => { killFeedEl.style.display = 'none'; });
killFeedEl.style.display = 'none';

// Track who last attacked us so we can credit the kill
let _lastAttackerName = null;
let _wasDeadLastFrame = false;

// Server confirmed we were hit by another player
network.on('hit', (msg) => {
    if (msg.targetId === network.playerId) {
        _lastAttackerName = msg.attackerName || null;
        player.takeDamage(msg.damage);
    }
});

// Server confirmed a kill
network.on('kill', (msg) => {
    remotePlayers.get(msg.targetId)?.die();
});

// Kill feed event from any player dying
network.on('kill_feed', (msg) => {
    const isLocalKill  = msg.killerName === network.playerName;
    const isLocalDeath = msg.victimName === network.playerName;
    addKillEntry(msg.killerName, msg.victimName, isLocalKill, isLocalDeath);

    // Show "Killed by X" on the death screen so the dying player knows
    if (isLocalDeath) {
        const el = document.getElementById('killed-by');
        if (el) el.textContent = `☠️  Killed by ${msg.killerName}`;
        
        // Show the death screen overlay and auto-fade it out in 10 seconds total
        const deathScreen = document.getElementById('death-screen');
        if (deathScreen) {
            deathScreen.style.display = 'flex';
            deathScreen.style.opacity = '1';
            deathScreen.style.transition = 'opacity 1.0s ease-in-out';

            const finalScoreEl = document.getElementById('final-score');
            if (finalScoreEl) {
                finalScoreEl.textContent = `Final Score: ${player.score}`;
            }

            // Clear any active timeouts
            if (window._deathFadeTimeout1) clearTimeout(window._deathFadeTimeout1);
            if (window._deathFadeTimeout2) clearTimeout(window._deathFadeTimeout2);

            // Hold for 9 seconds, then fade out over 1 second (10 seconds total)
            window._deathFadeTimeout1 = setTimeout(() => {
                deathScreen.style.opacity = '0';
                window._deathFadeTimeout2 = setTimeout(() => {
                    deathScreen.style.display = 'none';
                }, 1000);
            }, 9000);
        }

        // Also make the kill feed visible over the death screen so they see it
        killFeedEl.style.display = 'block';
        killFeedEl.style.zIndex  = '250';   // above death screen (z-index 200)
    }
});

// Another player killed an animal/monster — kill it on our screen too
network.on('entity_death', (msg) => {
    chunkManager.chunks.forEach(chunk => {
        [...chunk.animals, ...chunk.monsters].forEach(entity => {
            if (entity.entityId === msg.entityId && !entity.isDead) {
                entity.isDead = true;
            }
        });
    });
});

// Server tells us which seed the current game is using — sync world on join
network.on('game_info', (msg) => {
    rebuildWorld(msg.seed);
});

// Countdown overlay before new game
network.on('game_countdown', (msg) => {
    showToast(msg.seconds > 0
        ? `💀 All dead — new game in ${msg.seconds}s`
        : '🔄 New game starting…', 1200);
});

// New game — rebuild world and respawn everyone
network.on('game_reset', (msg) => {
    rebuildWorld(msg.seed);
    respawnPlayer();
    // Dispose all remote player corpses — they'll rejoin via state packets
    remotePlayers.forEach(rp => rp.dispose());
    remotePlayers.clear();
    showToast('✅ New game started — good luck!', 2500);
    if (player.controls.isLocked) return;
    setTimeout(() => player.controls.lock(), 500);
});

network.on('disconnect', refreshMpHUD);

// When a bullet hits a remote player — send hit to server, server relays to target
player.onRemotePlayerHit = (rp, damage) => {
    network.sendHit(rp.id, damage, network.playerName);
};

// When local player fires — broadcast so others see the tracer + muzzle flash
player.onShot = (ox, oy, oz, dx, dy, dz, speed, drop) => {
    network.sendShot(ox, oy, oz, dx, dy, dz, speed);
};

// Remote player fired — show muzzle flash on their model + spawn tracer in this scene
network.on('shot', (msg) => {
    if (msg.id === network.playerId) return;
    const rp = remotePlayers.get(msg.id);
    if (rp && !rp.isDisposed) rp.muzzleFlash();

    // Spawn a visual tracer from the shooter's position toward their aim direction
    const origin = new THREE.Vector3(msg.ox, msg.oy, msg.oz);
    const dir    = new THREE.Vector3(msg.dx, msg.dy, msg.dz).normalize();
    player._spawnTracer(origin, dir, msg.speed ?? 400, 9.8);
});

// ── Minimap ──
const minimap = new Minimap();

// ── Multiplayer HUD (below minimap) ──
const mpHUD = document.createElement('div');
mpHUD.style.cssText = 'position:absolute;top:196px;right:20px;color:white;font-family:monospace;font-size:0.85rem;text-align:right;text-shadow:1px 1px 0 #000;z-index:50;pointer-events:none;display:none;line-height:1.8';
document.body.appendChild(mpHUD);

function refreshMpHUD() {
    mpHUD.innerHTML =
        `Players: ${remotePlayers.size + 1}<br>` +
        `Ping: ${network.latency}ms<br>` +
        (network.connected ? '<span style="color:#00ff88">● Online</span>' : '<span style="color:#aaa">● Offline</span>');
}

player.controls.addEventListener('lock',   () => { minimap.show(); mpHUD.style.display = 'block'; refreshMpHUD(); });
player.controls.addEventListener('unlock', () => { minimap.hide(); mpHUD.style.display = 'none'; });

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

    environment.update(delta, camera.position, camera);
    player.update(delta);
    chunkManager.update(camera.position);
    planeManager.update(camera.position);
    chunkManager.updateEntities(delta, getTerrainHeight, player);

    // Broadcast any entity deaths that happened this frame
    chunkManager.chunks.forEach(chunk => {
        [...chunk.animals, ...chunk.monsters].forEach(entity => {
            if (entity.isDead && !entity.deathBroadcast && entity.entityId) {
                entity.deathBroadcast = true;
                network.sendEntityDeath(entity.entityId);
            }
        });
    });

    // Update remote player meshes
    remotePlayers.forEach(rp => rp.update(delta));

    // Minimap
    minimap.update(camera, remotePlayers, chunkManager, planeManager);

    // Broadcast own position to the server
    broadcastTimer += delta;
    if (broadcastTimer >= 1 / 20) {
        broadcastTimer = 0;
        // Derive yaw from the camera's world-direction vector (full 360° range).
        // camera.rotation.y (Euler XYZ) folds at ±90° via asin — do NOT use it.
        const _dir = new THREE.Vector3();
        camera.getWorldDirection(_dir);
        const camYaw = Math.atan2(_dir.x, _dir.z);
        const st = {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z,
            rotY: camYaw,
            health: player.health,
            isDead: player.isDead,
            weapon: player.currentWeaponIndex,
            flying: player.isFlying,
            // Tell the server the canonical spawn so new joiners get it
            spawnX: spawnPoint.x,
            spawnY: spawnPoint.y,
            spawnZ: spawnPoint.z,
        };
        // While flying, broadcast the PLANE's pose (not the chase camera) so
        // other players see the aircraft moving + banking correctly.
        if (player.isFlying) {
            const ps = player.flight.getNetState();
            st.x = ps.x; st.y = ps.y; st.z = ps.z;
            st.qx = ps.qx; st.qy = ps.qy; st.qz = ps.qz; st.qw = ps.qw;
        }
        network.sendState(st);
        if (network.connected) refreshMpHUD();

        // Detect local-player death transition and broadcast kill feed
        if (player.isDead && !_wasDeadLastFrame) {
            const killer = _lastAttackerName || 'Unknown';
            const victim = network.playerName;
            network._send('kill_feed', { killerName: killer, victimName: victim });
        }
        _wasDeadLastFrame = player.isDead;
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
