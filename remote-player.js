import * as THREE from 'three';

export class RemotePlayer {
    constructor(id, scene, spawnX, spawnY, spawnZ, playerName = '') {
        this.id         = id;
        this.name       = playerName || `Player_${id.slice(0, 4)}`;
        this.scene      = scene;
        this.isDead     = false;
        this.isDisposed = false;

        this._targetPos  = new THREE.Vector3(spawnX, spawnY, spawnZ);
        this._targetRotY     = 0;
        this._lastRemoteRotY = null;   // for delta-accumulation approach
        this._prevPos        = new THREE.Vector3(spawnX, spawnY, spawnZ);
        this._walkCycle      = 0;

        this.mesh = new THREE.Group();
        this.mesh.position.set(spawnX, spawnY, spawnZ);
        this._build();
        this._buildLabel();
        scene.add(this.mesh);
    }

    _build() {
        const skin   = new THREE.MeshStandardMaterial({ color: 0xf0b482, roughness: 0.75 });
        const shirt  = new THREE.MeshStandardMaterial({ color: 0xd45f20, roughness: 0.85 });
        const pants  = new THREE.MeshStandardMaterial({ color: 0x2d3e6e, roughness: 0.9  });
        const shoes  = new THREE.MeshStandardMaterial({ color: 0x1a0d00, roughness: 1.0  });
        const hair   = new THREE.MeshStandardMaterial({ color: 0x2e1a06, roughness: 1.0  });
        const gun    = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7  });
        const wood   = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9  });
        const silver = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.6  });

        const add = (parent, geo, mat, x, y, z) => {
            const m = new THREE.Mesh(geo, mat);
            m.position.set(x, y, z);
            m.castShadow = true;
            m.remotePlayerRef = this;
            parent.add(m);
            return m;
        };

        // Head
        add(this.mesh, new THREE.SphereGeometry(0.31, 14, 12), skin, 0, 3.42, 0);
        const h = new THREE.Mesh(new THREE.SphereGeometry(0.33, 14, 8, 0, Math.PI*2, 0, Math.PI*0.53), hair);
        h.position.set(0, 3.47, 0); this.mesh.add(h);
        add(this.mesh, new THREE.SphereGeometry(0.052, 7, 7), new THREE.MeshStandardMaterial({color:0x111111}), -0.11, 3.44, -0.27);
        add(this.mesh, new THREE.SphereGeometry(0.052, 7, 7), new THREE.MeshStandardMaterial({color:0x111111}),  0.11, 3.44, -0.27);

        // Neck
        add(this.mesh, new THREE.CylinderGeometry(0.09, 0.11, 0.24, 9), skin, 0, 3.06, 0);

        // Torso
        add(this.mesh, new THREE.CylinderGeometry(0.29, 0.23, 1.08, 10), shirt, 0, 2.24, 0);

        // Hips
        add(this.mesh, new THREE.CylinderGeometry(0.23, 0.21, 0.22, 10), pants, 0, 1.58, 0);

        // Legs — each on a hip pivot for walk animation
        const makeHip = (side) => {
            const pivot = new THREE.Group();
            pivot.position.set(side * 0.16, 1.6, 0);
            this.mesh.add(pivot);
            add(pivot, new THREE.CapsuleGeometry(0.10, 0.70, 4, 9), pants, 0, -0.48, 0);
            add(pivot, new THREE.CapsuleGeometry(0.088, 0.64, 4, 9), pants, 0, -1.12, 0);
            add(pivot, new THREE.BoxGeometry(0.19, 0.09, 0.33), shoes, 0, -1.55, 0.04);
            return pivot;
        };
        this._hipL = makeHip(-1);
        this._hipR = makeHip( 1);

        // Left arm — shoulder pivot for swing during walk
        this._leftShoulder = new THREE.Group();
        this._leftShoulder.position.set(-0.45, 2.77, 0);
        this._leftShoulder.rotation.x = 0;
        this.mesh.add(this._leftShoulder);
        add(this._leftShoulder, new THREE.CapsuleGeometry(0.077, 0.60, 4, 8), shirt, 0, -0.30, 0);
        add(this._leftShoulder, new THREE.CapsuleGeometry(0.066, 0.56, 4, 8), skin,  0, -0.85, 0);

        // Right arm — shoulder pivot for aiming pose + recoil
        this._shoulder      = new THREE.Group();
        this._shoulder.position.set(0.45, 2.77, 0);
        this._shoulder.rotation.x = Math.PI / 2 - 0.1;
        this._shoulderRestX = Math.PI / 2 - 0.1;
        this.mesh.add(this._shoulder);
        add(this._shoulder, new THREE.CapsuleGeometry(0.077, 0.60, 4, 8), shirt, 0, -0.30, 0);
        add(this._shoulder, new THREE.CapsuleGeometry(0.066, 0.56, 4, 8), skin,  0, -0.85, 0);

        // Weapon models (children of shoulder pivot)
        this._weapons       = [];
        this._currentWeapon = 0;

        const mkWeapon = (parts) => {
            const g = new THREE.Group();
            parts.forEach(([geo, mat, x, y, z, rx=0]) => {
                const m = new THREE.Mesh(geo, mat);
                m.position.set(x, y, z);
                if (rx) m.rotation.x = rx;
                m.castShadow = true;
                g.add(m);
            });
            return g;
        };

        const sniper = mkWeapon([
            [new THREE.CylinderGeometry(0.04, 0.04, 1.4, 8),  gun,   0,  -0.82,  0    ],
            [new THREE.BoxGeometry(0.13, 0.55, 0.18),          wood,  0,   0.28,  0.02 ],
            [new THREE.CylinderGeometry(0.055,0.055,0.30, 8),  gun,   0,  -0.45, -0.12 ],
            [new THREE.BoxGeometry(0.03, 0.18, 0.03),          gun,  -0.09,-0.45,-0.06  ],
            [new THREE.BoxGeometry(0.03, 0.18, 0.03),          gun,   0.09,-0.45,-0.06  ],
        ]);

        const deagle = mkWeapon([
            [new THREE.BoxGeometry(0.10, 0.55, 0.14), silver,  0,  -0.27,  0    ],
            [new THREE.BoxGeometry(0.09, 0.28, 0.12), gun,     0,   0.14, -0.05 ],
            [new THREE.CylinderGeometry(0.032,0.032,0.22,7), gun, 0, -0.58, 0   ],
        ]);

        const hammer = mkWeapon([
            [new THREE.CylinderGeometry(0.04,0.04,0.85,8), wood,   0, -0.1,  0],
            [new THREE.BoxGeometry(0.22, 0.2, 0.40),        silver, 0, -0.56, 0],
        ]);

        [sniper, deagle, hammer].forEach((w, i) => {
            w.position.set(0, -1.18, 0);
            w.visible = (i === 0);
            this._shoulder.add(w);
            this._weapons.push(w);
        });
    }

    muzzleFlash() {
        this._shoulder.rotation.x = this._shoulderRestX + 0.35;
        const w = this._weapons[this._currentWeapon];
        if (w) {
            const flash = new THREE.Mesh(
                new THREE.SphereGeometry(0.17, 6, 6),
                new THREE.MeshBasicMaterial({ color: 0xffee55 })
            );
            flash.position.set(0, -1.52, 0);
            w.add(flash);
            setTimeout(() => { w.remove(flash); flash.geometry.dispose(); flash.material.dispose(); }, 85);
        }
        setTimeout(() => { this._shoulder.rotation.x = this._shoulderRestX; }, 100);
    }

    _buildLabel() {
        this.mesh.children.filter(c => c.isSprite).forEach(s => this.mesh.remove(s));
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 48;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, 256, 48);
        ctx.fillStyle = '#ffcc44';
        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(this.name, 128, 32);
        const sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, fog: false })
        );
        sprite.scale.set(3, 0.75, 1);
        sprite.position.set(0, 4.6, 0);
        sprite.layers.set(1);
        this.mesh.add(sprite);
    }

    applyState(state) {
        if (state.name && state.name !== this.name) {
            this.name = state.name;
            this._buildLabel();
        }
        if (state.isDead && !this.isDead) { this.die(); return; }
        if (state.weapon !== undefined && state.weapon !== this._currentWeapon) {
            this._weapons[this._currentWeapon].visible = false;
            this._currentWeapon = state.weapon;
            this._weapons[this._currentWeapon].visible = true;
        }
        this._targetPos.set(state.x, state.y, state.z);
        if (state.rotY !== undefined) {
            if (this._lastRemoteRotY !== null) {
                // Accumulate rotation delta — avoids all wrapping ambiguity.
                // The delta handles the ±π broadcast wrap automatically.
                let delta = state.rotY - this._lastRemoteRotY;
                if (delta >  Math.PI) delta -= Math.PI * 2;
                if (delta < -Math.PI) delta += Math.PI * 2;
                this._targetRotY += delta;
            } else {
                this._targetRotY = state.rotY;
            }
            this._lastRemoteRotY = state.rotY;
        }
    }

    update(delta) {
        if (this.isDisposed) return;

        const t = Math.min(1, delta * 15);
        this._prevPos.copy(this.mesh.position);
        this.mesh.position.lerp(this._targetPos, t);

        // Simple lerp — both values accumulate freely, no wrapping needed
        this.mesh.rotation.y += (this._targetRotY - this.mesh.rotation.y) * t;

        if (this.isDead) return;

        const moved    = this.mesh.position.distanceTo(this._prevPos);
        const isMoving = moved > 0.008;

        if (isMoving) {
            this._walkCycle += delta * 7;
            const swing = Math.sin(this._walkCycle) * 0.55;
            this._hipL.rotation.x         =  swing;
            this._hipR.rotation.x         = -swing;
            this._leftShoulder.rotation.x = -swing * 0.4;
        } else {
            this._hipL.rotation.x         *= 0.82;
            this._hipR.rotation.x         *= 0.82;
            this._leftShoulder.rotation.x *= 0.82;
        }
    }

    flash() {
        this.mesh.traverse(c => {
            if (!c.isMesh || !c.material?.color) return;
            const orig = c.material.color.getHex();
            c.material.color.setHex(0xff2222);
            setTimeout(() => { if (c.material) c.material.color.setHex(orig); }, 120);
        });
    }

    die() {
        if (this.isDead) return;
        this.isDead = true;
        this.mesh.rotation.z = Math.PI / 2;
        setTimeout(() => this.dispose(), 3000);
    }

    dispose() {
        if (this.isDisposed) return;
        this.isDisposed = true;
        this.scene.remove(this.mesh);
        this.mesh.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
    }
}
