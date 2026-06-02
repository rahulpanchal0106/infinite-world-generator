// Simple WebSocket game server for infinite-world-generator multiplayer.
// Run with:  node server.js
// Requires:  npm install ws

const { WebSocketServer } = require('ws');

const PORT    = 3000;
const wss     = new WebSocketServer({ port: PORT });
const players = new Map(); // id → { ws, state }

console.log(`[Server] Listening on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
    let playerId = null;

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        switch (msg.type) {

            case 'join': {
                playerId = msg.id;
                players.set(playerId, { ws, state: { id: playerId, x: 0, y: 0, z: 0, rotY: 0 } });
                console.log(`[+] ${playerId.slice(0,8)} joined  (${players.size} online)`);

                // Tell this new player about everyone already in the game
                const snapshot = [...players.values()]
                    .filter(p => p.state.id !== playerId)
                    .map(p => p.state);
                send(ws, { type: 'snapshot', players: snapshot });

                // Tell everyone else a new player joined
                broadcast({ type: 'join', id: playerId }, playerId);
                break;
            }

            case 'state': {
                if (!playerId) return;
                const p = players.get(playerId);
                if (!p) return;
                // Update stored state
                Object.assign(p.state, {
                    id: playerId,
                    x: msg.x, y: msg.y, z: msg.z,
                    rotY: msg.rotY,
                    health: msg.health,
                    weapon: msg.weapon,
                });
                // Relay to all other players
                broadcast({ type: 'state', ...p.state }, playerId);
                break;
            }

            case 'shot': {
                // Relay to everyone — clients do their own hit detection
                broadcast({ type: 'shot', id: playerId, ...msg }, playerId);
                break;
            }

            case 'hit': {
                // Relay damage confirmation to the specific target
                const target = players.get(msg.targetId);
                if (target) send(target.ws, { type: 'hit', targetId: msg.targetId, damage: msg.damage });
                break;
            }

            case 'kill': {
                broadcast({ type: 'kill', targetId: msg.targetId });
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
        players.delete(playerId);
        broadcast({ type: 'leave', id: playerId });
        console.log(`[-] ${playerId.slice(0,8)} left    (${players.size} online)`);
    });
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
