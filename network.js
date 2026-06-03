// WebSocket multiplayer client.
// Falls back silently to offline mode when no server is reachable.
export class NetworkManager {
    constructor(serverUrl = 'ws://localhost:3000', playerName = 'Player') {
        this.serverUrl  = serverUrl;
        this.socket     = null;
        this.playerId   = crypto.randomUUID();
        this.playerName = playerName;
        this.connected  = false;
        this.latency    = 0;

        this._handlers  = {};
        this._pingTimer = null;
        this._pingTs    = 0;
    }

    connect() {
        try {
            this.socket = new WebSocket(this.serverUrl);
            this.socket.onopen    = () => this._onOpen();
            this.socket.onclose   = () => this._onClose();
            this.socket.onerror   = () => {};          // silent — handled via onclose
            this.socket.onmessage = (e) => this._onMessage(e);
        } catch { /* offline */ }
    }

    on(type, fn) { this._handlers[type] = fn; }

    // Broadcast this player's position/state 20× per second.
    sendState({ x, y, z, rotY, health, weapon, spawnX, spawnY, spawnZ }) {
        this._send('state', { x, y, z, rotY, health, weapon, spawnX, spawnY, spawnZ, name: this.playerName });
    }

    sendShot(ox, oy, oz, dx, dy, dz, speed) {
        this._send('shot', { ox, oy, oz, dx, dy, dz, speed });
    }

    sendEntityDeath(entityId) {
        this._send('entity_death', { entityId });
    }

    sendHit(targetId, damage) {
        this._send('hit', { targetId, damage });
    }

    disconnect() {
        clearInterval(this._pingTimer);
        this.socket?.close();
    }

    _send(type, payload = {}) {
        if (!this.connected) return;
        this.socket.send(JSON.stringify({ type, id: this.playerId, ...payload }));
    }

    _onOpen() {
        this.connected = true;
        console.log('[MP] Connected, id =', this.playerId);
        this._send('join', { name: this.playerName });
        this._pingTimer = setInterval(() => {
            this._pingTs = performance.now();
            this._send('ping');
        }, 2000);
    }

    _onClose() {
        this.connected = false;
        clearInterval(this._pingTimer);
        this._handlers['disconnect']?.();
    }

    _onMessage(e) {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }

        if (msg.type === 'pong') {
            this.latency = Math.round(performance.now() - this._pingTs);
            return;
        }
        this._handlers[msg.type]?.(msg);
    }
}
