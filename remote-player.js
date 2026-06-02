import * as THREE from 'three';

// Renders another connected player in the world.
// Position is lerped toward server state each frame for smooth movement.
export class RemotePlayer {
    constructor(id, scene, spawnX, spawnY, spawnZ) {
        this.id         = id;
        this.scene      = scene;
        this.isDead     = false;
        this.isDisposed = false;

        this._targetPos  = new THREE.Vector3(spawnX, spawnY, spawnZ);
        this._targetRotY = 0;

        this.mesh = new THREE.Group();
        this.mesh.position.set(spawnX, spawnY, spawnZ);
        this._build();
        this._buildLabel(id);
        scene.add(this.mesh);
    }

    _build() {
        const body = new THREE.MeshStandardMaterial({ color: 0xe87b2a, flatShading: true }); // orange so easy to spot
        const head = new THREE.MeshStandardMaterial({ color: 0xffd0a0, flatShading: true });
        const legs = new THREE.MeshStandardMaterial({ color: 0x333355, flatShading: true });

        const add = (geo, mat, x, y, z) => {
            const m = new THREE.Mesh(geo, mat);
            m.position.set(x, y, z);
            m.castShadow = true;
            m.remotePlayerRef = this;
            this.mesh.add(m);
            return m;
        };

        add(new THREE.BoxGeometry(0.8, 0.8, 0.8),    head, 0,    3.4,  0);   // head
        add(new THREE.BoxGeometry(1.0, 1.4, 0.5),    body, 0,    2.3,  0);   // torso
        add(new THREE.BoxGeometry(0.35, 1.2, 0.35),  body, -0.7, 2.3,  0);   // L arm
        add(new THREE.BoxGeometry(0.35, 1.2, 0.35),  body,  0.7, 2.3,  0);   // R arm
        add(new THREE.BoxGeometry(0.4,  1.4, 0.4),   legs, -0.3, 1.0,  0);   // L leg
        add(new THREE.BoxGeometry(0.4,  1.4, 0.4),   legs,  0.3, 1.0,  0);   // R leg
    }

    _buildLabel(id) {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 48;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, 256, 48);
        ctx.fillStyle = '#ffcc44';
        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Player ' + id.slice(0, 6), 128, 32);

        const sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, fog: false })
        );
        sprite.scale.set(3, 0.75, 1);
        sprite.position.set(0, 5, 0);
        this.mesh.add(sprite);
    }

    // Called every time a state packet arrives for this player.
    applyState(state) {
        this._targetPos.set(state.x, state.y, state.z);
        this._targetRotY = state.rotY ?? this._targetRotY;
    }

    update(delta) {
        if (this.isDisposed) return;
        const t = Math.min(1, delta * 15);
        this.mesh.position.lerp(this._targetPos, t);
        this.mesh.rotation.y += (this._targetRotY - this.mesh.rotation.y) * t;
    }

    flash() {
        this.mesh.children.forEach(child => {
            if (!child.material?.color) return;
            const orig = child.material.color.getHex();
            child.material.color.setHex(0xff2222);
            setTimeout(() => { if (child.material) child.material.color.setHex(orig); }, 120);
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
        this.mesh.children.forEach(c => { c.geometry?.dispose(); c.material?.dispose(); });
    }
}
