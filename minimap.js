// Circular minimap — always centred on the local player, rotates with their view.
export class Minimap {
    constructor() {
        this.SIZE        = 160;   // px diameter
        this.WORLD_RANGE = 400;   // world units visible from centre to edge
        this._visible    = false;

        this._build();
    }

    _build() {
        // Outer wrapper — gives the circular clip + border
        this._wrap = document.createElement('div');
        this._wrap.style.cssText = `
            position: absolute; top: 20px; right: 20px;
            width: ${this.SIZE}px; height: ${this.SIZE}px;
            border-radius: 50%;
            border: 2px solid rgba(255,255,255,0.35);
            box-shadow: 0 0 12px rgba(0,0,0,0.7);
            overflow: hidden;
            z-index: 50; pointer-events: none;
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

    // Call every frame from main animate().
    // camera       — THREE.Camera (local player)
    // remotePlayers — Map<id, RemotePlayer>
    update(camera, remotePlayers) {
        if (!this._visible) return;

        const ctx  = this._ctx;
        const S    = this.SIZE;
        const cx   = S / 2, cy = S / 2;
        const px   = camera.position.x;
        const pz   = camera.position.z;
        const rotY = camera.rotation.y;
        const scale = cx / this.WORLD_RANGE;

        // ── Background ──────────────────────────────────────────────────
        ctx.clearRect(0, 0, S, S);
        ctx.fillStyle = 'rgba(10, 14, 20, 0.78)';
        ctx.fillRect(0, 0, S, S);

        // Faint grid rings
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 1;
        [0.35, 0.7, 1.0].forEach(f => {
            ctx.beginPath();
            ctx.arc(cx, cy, cx * f, 0, Math.PI * 2);
            ctx.stroke();
        });

        // Cross-hairs
        ctx.beginPath();
        ctx.moveTo(cx, 4); ctx.lineTo(cx, S - 4);
        ctx.moveTo(4, cy); ctx.lineTo(S - 4, cy);
        ctx.stroke();

        // ── Helper: world → canvas coords (rotated to player facing) ────
        const toMap = (wx, wz) => {
            const dx =  wx - px;
            const dz =  wz - pz;
            const cos = Math.cos(-rotY);
            const sin = Math.sin(-rotY);
            return {
                x: cx + (dx * cos - dz * sin) * scale,
                y: cy + (dx * sin + dz * cos) * scale,
            };
        };

        // ── Remote players ───────────────────────────────────────────────
        remotePlayers.forEach(rp => {
            if (rp.isDisposed) return;
            const mp = toMap(rp.mesh.position.x, rp.mesh.position.z);
            // Skip if outside circle
            const ddx = mp.x - cx, ddy = mp.y - cy;
            if (ddx * ddx + ddy * ddy > cx * cx) return;

            // Outer glow
            ctx.beginPath();
            ctx.arc(mp.x, mp.y, 7, 0, Math.PI * 2);
            ctx.fillStyle = rp.isDead ? 'rgba(100,100,100,0.5)' : 'rgba(255,60,60,0.25)';
            ctx.fill();

            // Dot
            ctx.beginPath();
            ctx.arc(mp.x, mp.y, rp.isDead ? 3 : 5, 0, Math.PI * 2);
            ctx.fillStyle = rp.isDead ? '#555' : '#ff4444';
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.2;
            ctx.fill(); ctx.stroke();

            // Name tag
            if (!rp.isDead) {
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.font = 'bold 9px monospace';
                ctx.textAlign = 'center';
                ctx.fillText(rp.name, mp.x, mp.y - 9);
            }
        });

        // ── Local player — always centre, arrow points forward ───────────
        // Arrow triangle pointing up (forward = up on the minimap)
        ctx.save();
        ctx.translate(cx, cy);
        ctx.beginPath();
        ctx.moveTo(0, -11);          // tip
        ctx.lineTo(-5,  6);
        ctx.lineTo( 0,  2);
        ctx.lineTo( 5,  6);
        ctx.closePath();
        ctx.fillStyle   = '#00ff88';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth   = 1.5;
        ctx.fill(); ctx.stroke();
        ctx.restore();

        // ── Compass N ───────────────────────────────────────────────────
        // North direction rotated by camera yaw
        const northAngle = -rotY;      // where north is on the minimap
        const nr = cx - 10;
        const nx = cx + Math.sin(northAngle) * nr;
        const ny = cy - Math.cos(northAngle) * nr;
        ctx.fillStyle = '#ff6666';
        ctx.font = 'bold 10px monospace';
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
