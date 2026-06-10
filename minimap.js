// Circular minimap — centred on the local player, rotated so "forward" is up.
//
// Rotation is driven by the camera's true forward vector (world -Z column of
// its matrix), NOT camera.rotation.y. The Euler value folds at ±90° (asin) and
// makes the map reverse. We use the forward vector's components directly as
// sin/cos of the yaw — periodic by nature, so it can never fold or jump.
export class Minimap {
    constructor() {
        this.SIZE        = 160;   // px diameter
        this.WORLD_RANGE = 400;   // world units from centre to edge
        this._visible    = false;
        this._build();
    }

    _build() {
        this._wrap = document.createElement('div');
        this._wrap.style.cssText = `
            position: absolute; top: 20px; right: 20px;
            width: ${this.SIZE}px; height: ${this.SIZE}px;
            border-radius: 50%;
            border: 2px solid rgba(255,255,255,0.35);
            box-shadow: 0 0 12px rgba(0,0,0,0.7);
            overflow: hidden; z-index: 50; pointer-events: none;
            display: none;
        `;
        this._canvas = document.createElement('canvas');
        this._canvas.width  = this.SIZE;
        this._canvas.height = this.SIZE;
        this._ctx = this._canvas.getContext('2d');
        this._wrap.appendChild(this._canvas);
        document.body.appendChild(this._wrap);
    }

    show() { this._wrap.style.display = 'block'; this._visible = true; }
    hide() { this._wrap.style.display = 'none';  this._visible = false; }

    update(camera, remotePlayers, chunkManager, planeManager) {
        if (!this._visible) return;

        const ctx   = this._ctx;
        const S     = this.SIZE;
        const cx    = S / 2, cy = S / 2;
        const px    = camera.position.x;
        const pz    = camera.position.z;
        const scale = cx / this.WORLD_RANGE;

        // ── Camera forward vector (world -Z column), flattened to XZ plane ──
        camera.updateMatrixWorld();
        const m  = camera.matrixWorld.elements;
        let  fx  = -m[8];     // forward.x
        let  fz  = -m[10];    // forward.z
        const len = Math.hypot(fx, fz) || 1;
        fx /= len;            // = sin(yaw)
        fz /= len;            // = cos(yaw)

        // Rotate a world offset (dx,dz) into the player-facing map frame.
        //   forward axis = (fx, fz)   → maps to screen UP   (−Y)
        //   right   axis = (−fz, fx)  → maps to screen RIGHT (+X)
        const toMap = (wx, wz) => {
            const dx = wx - px;
            const dz = wz - pz;
            const fwd   =  dx * fx + dz * fz;   // ahead/behind
            const right = -dx * fz + dz * fx;   // right/left
            return { x: cx + right * scale, y: cy - fwd * scale };
        };

        // ── Background ──────────────────────────────────────────────────
        ctx.clearRect(0, 0, S, S);
        ctx.fillStyle = 'rgba(10, 14, 20, 0.78)';
        ctx.fillRect(0, 0, S, S);

        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        [0.35, 0.7, 1.0].forEach(f => {
            ctx.beginPath(); ctx.arc(cx, cy, cx * f, 0, Math.PI * 2); ctx.stroke();
        });
        ctx.beginPath();
        ctx.moveTo(cx, 4); ctx.lineTo(cx, S - 4);
        ctx.moveTo(4, cy); ctx.lineTo(S - 4, cy);
        ctx.stroke();

        // ── Remote players ───────────────────────────────────────────────
        remotePlayers.forEach(rp => {
            if (rp.isDisposed) return;
            const mp = toMap(rp.mesh.position.x, rp.mesh.position.z);
            const ddx = mp.x - cx, ddy = mp.y - cy;
            if (ddx * ddx + ddy * ddy > cx * cx) return;   // outside circle

            ctx.beginPath();
            ctx.arc(mp.x, mp.y, 7, 0, Math.PI * 2);
            ctx.fillStyle = rp.isDead ? 'rgba(100,100,100,0.4)' : 'rgba(255,60,60,0.25)';
            ctx.fill();

            ctx.beginPath();
            ctx.arc(mp.x, mp.y, rp.isDead ? 3 : 5, 0, Math.PI * 2);
            ctx.fillStyle   = rp.isDead ? '#555' : '#ff4444';
            ctx.strokeStyle = '#fff';
            ctx.lineWidth   = 1.2;
            ctx.fill(); ctx.stroke();

            if (!rp.isDead) {
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.font = 'bold 9px monospace';
                ctx.textAlign = 'center';
                ctx.fillText(rp.name, mp.x, mp.y - 9);
            }
        });

        // ── Monsters ─────────────────────────────────────────────────────
        if (chunkManager) {
            for (const chunk of chunkManager.chunks.values()) {
                for (const monster of chunk.monsters) {
                    if (monster.isDead || monster.isDisposed) continue;
                    const mp = toMap(monster.mesh.position.x, monster.mesh.position.z);
                    const ddx = mp.x - cx, ddy = mp.y - cy;
                    if (ddx * ddx + ddy * ddy > cx * cx) continue; // outside circle

                    // Pulsing glow ring
                    ctx.beginPath();
                    ctx.arc(mp.x, mp.y, 9, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(255,100,0,0.18)';
                    ctx.fill();

                    // Downward-pointing triangle (danger marker)
                    ctx.beginPath();
                    ctx.moveTo(mp.x,      mp.y + 6);
                    ctx.lineTo(mp.x - 5,  mp.y - 4);
                    ctx.lineTo(mp.x + 5,  mp.y - 4);
                    ctx.closePath();
                    ctx.fillStyle   = '#ff6600';
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth   = 1.2;
                    ctx.fill();
                    ctx.stroke();
                }
            }
        }

        // ── Parked planes (cyan ✈) — clamped to the rim when out of range ──
        if (planeManager && planeManager.parked) {
            ctx.font = '13px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const rim = cx - 9;
            for (const entry of planeManager.parked.values()) {
                const mp = toMap(entry.position.x, entry.position.z);
                let ddx = mp.x - cx, ddy = mp.y - cy;
                const dist = Math.hypot(ddx, ddy) || 1;
                let x = mp.x, y = mp.y;
                if (dist > rim) { x = cx + (ddx / dist) * rim; y = cy + (ddy / dist) * rim; }
                ctx.fillStyle = '#33ddff';
                ctx.fillText('✈', x, y);
            }
            ctx.textBaseline = 'alphabetic';
        }

        // ── Local player — fixed at centre, arrow always points up ────────
        ctx.save();
        ctx.translate(cx, cy);
        ctx.beginPath();
        ctx.moveTo(0, -11);
        ctx.lineTo(-5, 6);
        ctx.lineTo(0, 2);
        ctx.lineTo(5, 6);
        ctx.closePath();
        ctx.fillStyle   = '#00ff88';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth   = 1.5;
        ctx.fill(); ctx.stroke();
        ctx.restore();

        // ── Compass N (north = world -Z), rotated into map frame ──────────
        // north dir (0,-1): fwd = -fz, right = -fx
        const nr = cx - 11;
        const nx = cx + (-fx) * nr;
        const ny = cy - (-fz) * nr;
        ctx.fillStyle = '#ff6666';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('N', nx, ny);
        ctx.textBaseline = 'alphabetic';

        // ── Range label ─────────────────────────────────────────────────
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '8px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${this.WORLD_RANGE}m`, 6, S - 6);
    }
}
