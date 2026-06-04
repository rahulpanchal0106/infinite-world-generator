// Game server — serves static files AND handles WebSocket on the same port.
// One port = one ngrok tunnel covers everything.
// Run with:  node server.js
// Requires:  npm install ws

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = 3000;

const MIME = {
    '.html': 'text/html',
    '.js':   'application/javascript',
    '.css':  'text/css',
    '.json': 'application/json',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.ico':  'image/x-icon',
    '.glb':  'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.fbx':  'application/octet-stream',
};

// ── Static file server ──────────────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
    // strip query strings, default to index.html
    const urlPath  = decodeURIComponent(req.url.split('?')[0]);
    const filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);
    const ext = path.extname(filePath).toLowerCase();

    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
        res.end(data);
    });
});

// ── Game state ───────────────────────────────────────────────────────────────
const game = {
    seed:       Math.floor(Math.random() * 100000),
    alivePlayers: new Set(),   // ids of players currently alive
    resetting:  false,
    resetTimer: null,
};

function checkAllDead() {
    if (game.resetting) return;
    if (players.size === 0) return;
    // Are there any alive players?
    const anyAlive = [...game.alivePlayers].some(id => players.has(id));
    if (anyAlive) return;

    // Everyone is dead — countdown then new game
    game.resetting = true;
    console.log('[Game] All players dead — new game in 5s');
    broadcast({ type: 'game_countdown', seconds: 5 });

    let remaining = 5;
    game.resetTimer = setInterval(() => {
        remaining--;
        if (remaining > 0) {
            broadcast({ type: 'game_countdown', seconds: remaining });
        } else {
            clearInterval(game.resetTimer);
            game.seed      = Math.floor(Math.random() * 100000);
            game.resetting = false;
            game.alivePlayers.clear();
            // All connected players are considered alive again after reset
            players.forEach((_, id) => game.alivePlayers.add(id));
            console.log(`[Game] New game — seed ${game.seed}`);
            broadcast({ type: 'game_reset', seed: game.seed });
        }
    }, 1000);
}

// ── WebSocket server on the same HTTP server ────────────────────────────────
const wss     = new WebSocketServer({ server: httpServer });
const players = new Map(); // id → { ws, state }

wss.on('connection', (ws) => {
    let playerId = null;

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        switch (msg.type) {

            case 'join': {
                playerId = msg.id;
                const playerName = (msg.name ?? '').trim() || `Player_${msg.id.slice(0, 4)}`;
                players.set(playerId, { ws, state: { id: playerId, name: playerName, x: 0, y: 0, z: 0, rotY: 0, isDead: false } });
                game.alivePlayers.add(playerId); // new joiner counts as alive
                console.log(`[+] ${playerName} joined  (${players.size} online, seed ${game.seed})`);

                // Send new player: everyone already here + current game seed
                const snapshot = [...players.values()]
                    .filter(p => p.state.id !== playerId)
                    .map(p => p.state);
                send(ws, { type: 'snapshot', players: snapshot });
                send(ws, { type: 'game_info', seed: game.seed });

                // Tell everyone else
                broadcast({ type: 'join', id: playerId, name: playerName }, playerId);
                break;
            }

            case 'state': {
                if (!playerId) return;
                const p = players.get(playerId);
                if (!p) return;
                const wasDead = p.state.isDead;
                Object.assign(p.state, {
                    id:     playerId,
                    name:   (msg.name ?? '').trim() || p.state.name,
                    x:      msg.x, y: msg.y, z: msg.z,
                    rotY:   msg.rotY,
                    health: msg.health,
                    isDead: !!msg.isDead,
                    weapon: msg.weapon,
                });

                // Track alive/dead transitions
                if (msg.isDead) {
                    game.alivePlayers.delete(playerId);
                    if (!wasDead) {
                        console.log(`[~] ${p.state.name} died  (${game.alivePlayers.size} alive)`);
                        checkAllDead();
                    }
                } else {
                    game.alivePlayers.add(playerId);
                }

                broadcast({ type: 'state', ...p.state }, playerId);
                break;
            }

            case 'shot': {
                broadcast({ type: 'shot', id: playerId, ...msg }, playerId);
                break;
            }

            case 'hit': {
                const target = players.get(msg.targetId);
                // Relay damage + attacker name so the victim knows who killed them
                if (target) send(target.ws, { type: 'hit', targetId: msg.targetId, damage: msg.damage, attackerName: msg.attackerName || '' });
                break;
            }

            case 'kill': {
                broadcast({ type: 'kill', targetId: msg.targetId });
                break;
            }

            case 'kill_feed': {
                // Broadcast to ALL players (including sender) so everyone sees the feed
                broadcast({ type: 'kill_feed', killerName: msg.killerName, victimName: msg.victimName });
                // Also echo back to sender
                send(ws, { type: 'kill_feed', killerName: msg.killerName, victimName: msg.victimName });
                console.log(`[Kill] ${msg.killerName} killed ${msg.victimName}`);
                break;
            }

            case 'entity_death': {
                broadcast({ type: 'entity_death', entityId: msg.entityId }, playerId);
                break;
            }

            case 'ping': {
                send(ws, { type: 'pong' });
                break;
            }
        }
    });

    ws.on('close', () => {
        if (!playerId) return;
        game.alivePlayers.delete(playerId);
        players.delete(playerId);
        broadcast({ type: 'leave', id: playerId });
        console.log(`[-] ${playerId.slice(0, 8)} left  (${players.size} online)`);
        if (players.size > 0) checkAllDead();
        else if (game.resetTimer) { clearInterval(game.resetTimer); game.resetting = false; }
    });
});

httpServer.listen(PORT, () => {
    console.log(`[Server] Game running at  http://localhost:${PORT}`);
    console.log(`[Server] Share via ngrok: ngrok http ${PORT}`);
});

function send(ws, obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcast(obj, exceptId = null) {
    const data = JSON.stringify(obj);
    for (const [id, { ws }] of players) {
        if (id !== exceptId && ws.readyState === 1) ws.send(data);
    }
}
