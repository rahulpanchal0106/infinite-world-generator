import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { getTerrainHeight } from './terrain.js';
import { loadGunModel } from './gun-model.js';

// ── Shared animation clips (data only, safe to share across players) ───────
// Pre-warm immediately on module load so clips are ready before the first
// player model finishes downloading.
const _clips      = {};
let   _clipsReady = false;
const _clipQueue  = [];

const ANIM_FILES = {
    idle:     'rifle aiming idle.fbx',
    walk:     'walking.fbx',
    walkBack: 'walking backwards.fbx',
    run:      'rifle run.fbx',
    strafeL:  'strafe left.fbx',
    strafeR:  'strafe right.fbx',
    fire:     'firing rifle.fbx',
    hit:      'hit reaction.fbx',
    die:      'Dying.fbx',
};

function getClips(cb) {
    if (_clipsReady) { cb(_clips); return; }
    _clipQueue.push(cb);
    if (_clipQueue.length > 1) return;

    const total  = Object.keys(ANIM_FILES).length;
    let   loaded = 0;
    const ldr    = new FBXLoader();

    const tick = () => {
        loaded++;
        if (loaded < total) return;
        _clipsReady = true;
        _clipQueue.splice(0).forEach(fn => fn(_clips));
    };

    Object.entries(ANIM_FILES).forEach(([name, file]) => {
        ldr.load(`/models/${encodeURIComponent(file)}`, (anim) => {
            const clip = anim.animations[0];
            if (clip) { clip.name = name; _clips[name] = clip; }
            tick();
        }, undefined, () => tick());
    });
}

// Start loading clips immediately — parallel with any future model downloads
getClips(() => {});

// ── RemotePlayer ──────────────────────────────────────────────────────────
export class RemotePlayer {
    constructor(id, scene, spawnX, spawnY, spawnZ, playerName = '') {
        this.id         = id;
        this.name       = playerName || `Player_${id.slice(0, 4)}`;
        this.scene      = scene;
        this.isDead     = false;
        this.isDisposed = false;

        this._targetPos      = new THREE.Vector3(spawnX, spawnY, spawnZ);
        this._targetRotY     = 0;  // fbx.rotation.y=π already flips model; mesh tracks camera directly
        this._lastRemoteRotY = null;
        this._prevPos        = new THREE.Vector3(spawnX, spawnY, spawnZ);

        this._mixer         = null;
        this._currentAnim   = null;
        this._currentAction = null;
        this._fbx           = null;

        this.mesh = new THREE.Group();
        this.mesh.position.set(spawnX, spawnY, spawnZ);
        scene.add(this.mesh);

        this._buildLabel();
        this._loadModel();
    }

    // ── Load model fresh (browser HTTP-caches the 4.9 MB file) ────────────
    _loadModel() {
        const ldr = new FBXLoader();
        ldr.load('/models/Left%20Strafing%20Jump.fbx',
            (fbx) => {
                if (this.isDisposed) return;

                fbx.scale.setScalar(0.01);   // Mixamo cm → metres
                // Facing flip lives ONLY here (single knob). mesh.rotation.y tracks
                // the broadcast yaw directly, so raw model (+Z forward) needs no extra
                // rotation. If the character ends up backwards, change this to Math.PI.
                fbx.rotation.y = 0;

                fbx.traverse(c => {
                    if (!c.isMesh) return;
                    c.castShadow    = true;
                    c.receiveShadow = true;
                    c.remotePlayerRef = this;
                    if (c.material) {
                        [].concat(c.material).forEach(m => {
                            m.transparent = false;
                            m.depthWrite  = true;
                        });
                    }
                });

                // Align feet to y=0 using Mixamo foot bones
                // (handles any default-pose offset from the jump animation)
                fbx.updateMatrixWorld(true);
                const lFoot = fbx.getObjectByName('mixamorigLeftFoot');
                const rFoot = fbx.getObjectByName('mixamorigRightFoot');
                if (lFoot && rFoot) {
                    const lp = new THREE.Vector3();
                    const rp = new THREE.Vector3();
                    lFoot.getWorldPosition(lp);
                    rFoot.getWorldPosition(rp);
                    fbx.position.y -= (lp.y + rp.y) / 2; // lower feet to y=0
                } else {
                    // Fallback: use bounding box minimum
                    const box = new THREE.Box3().setFromObject(fbx);
                    fbx.position.y -= box.min.y;
                }

                this.mesh.add(fbx);
                this._fbx = fbx;

                this._buildGun(fbx);

                // Load / reuse shared clips then wire up mixer
                getClips((clips) => {
                    if (this.isDisposed) return;
                    this._mixer = new THREE.AnimationMixer(fbx);
                    this._setAnim('idle', 0);
                });
            },
            undefined,
            (err) => console.error('[RemotePlayer] FBX load error:', err)
        );
    }

    // ── Attach sniper GLB to right-hand bone ───────────────────────────────
    _buildGun(fbx) {
        const rightHand = fbx.getObjectByName('mixamorigRightHand');
        if (!rightHand) return;

        // fbx root is scaled 0.01 (cm→m), so 140 here ≈ 1.4 m in the world,
        // matching the first-person sniper size. Anchor on the trigger/grip so
        // the hand grips the gun there instead of mid-barrel.
        const grip = new THREE.Vector3(0, -1.8, -0.4);
        loadGunModel('./models/sniper.glb', 140, (model) => {
            if (this.isDisposed) return;
            model.traverse(c => { if (c.isMesh) c.remotePlayerRef = this; });
            rightHand.add(model);
            this._gun        = model;
            this._gunAligned = false; // orientation baked once the idle pose is live
        }, grip);
    }

    // Bone local axes are unknown, so compute the gun's local rotation that
    // makes the barrel (+Z) point along the character's forward and the gun's
    // up (+Y) point at world-up — given the hand bone's current world pose.
    // Done once after the idle animation is applied; stays correct as the
    // player turns (the offset is relative to the bone) and follows the hand
    // during fire/reload.
    _alignGun() {
        const hand = this._fbx?.getObjectByName('mixamorigRightHand');
        if (!hand) return;

        this.mesh.updateMatrixWorld(true);
        const boneQ = new THREE.Quaternion();
        hand.getWorldQuaternion(boneQ);

        const yaw  = this.mesh.rotation.y;
        const fwd  = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)); // barrel → here
        const up   = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
        const up2   = new THREE.Vector3().crossVectors(fwd, right).normalize();
        const desired = new THREE.Quaternion()
            .setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up2, fwd));

        this._gun.quaternion.copy(boneQ.invert().multiply(desired));
    }

    // ── Animation control ──────────────────────────────────────────────────
    _setAnim(name, fadeDur = 0.2) {
        if (!this._mixer || !_clips[name]) return;
        if (this._currentAnim === name)    return;

        const next = this._mixer.clipAction(_clips[name]);
        next.reset().setEffectiveWeight(1);

        if (this._currentAction && fadeDur > 0) {
            this._currentAction.crossFadeTo(next, fadeDur, true);
        } else {
            this._currentAction?.stop();
        }

        next.play();
        this._currentAnim   = name;
        this._currentAction = next;
    }

    // ── Helpers ────────────────────────────────────────────────────────────
    _buildLabel() {
        this.mesh.children.filter(c => c.isSprite).forEach(s => this.mesh.remove(s));
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 48;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, 256, 48);
        ctx.fillStyle = '#ffcc44';
        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(this.name, 128, 32);
        const sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, fog: false })
        );
        sprite.scale.set(3, 0.75, 1);
        sprite.position.set(0, 2.4, 0);
        sprite.layers.set(1);
        this.mesh.add(sprite);
    }

    muzzleFlash() {
        this._setAnim('fire', 0.1);
        const flash = new THREE.Mesh(
            new THREE.SphereGeometry(0.15, 5, 5),
            new THREE.MeshBasicMaterial({ color: 0xffee55 })
        );
        flash.position.set(0.45, 1.3, -0.65);
        this.mesh.add(flash);
        setTimeout(() => {
            this.mesh.remove(flash); flash.geometry.dispose(); flash.material.dispose();
            if (!this.isDead) this._setAnim('idle', 0.2);
        }, 300);
    }

    // ── Network state ──────────────────────────────────────────────────────
    applyState(state) {
        if (state.name && state.name !== this.name) { this.name = state.name; this._buildLabel(); }
        if (state.isDead && !this.isDead)            { this.die(); return; }

        this._targetPos.set(state.x, state.y, state.z);

        if (state.rotY !== undefined) {
            if (this._lastRemoteRotY !== null) {
                let d = state.rotY - this._lastRemoteRotY;
                if (d >  Math.PI) d -= Math.PI * 2;
                if (d < -Math.PI) d += Math.PI * 2;
                this._targetRotY += d;
            } else {
                // First packet: mesh rotation = camera rotation directly
                // (fbx.rotation.y = π already handles the Mixamo +Z → -Z flip)
                this._targetRotY = state.rotY;
            }
            this._lastRemoteRotY = state.rotY;
        }
    }

    // ── Per-frame ─────────────────────────────────────────────────────────
    update(delta) {
        if (this.isDisposed) return;

        // While dead, freeze the corpse where it fell (don't chase the dead
        // player's ghost broadcasts) but KEEP the mixer running so the death
        // animation plays out.
        if (!this.isDead) {
            const t = Math.min(1, delta * 15);
            this._prevPos.copy(this.mesh.position);
            this.mesh.position.lerp(this._targetPos, t);
            // Snap Y to local terrain so the player always stands on the ground
            // (avoids floating/sinking caused by server Y drift)
            this.mesh.position.y = getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
            this.mesh.rotation.y += (this._targetRotY - this.mesh.rotation.y) * t;
        }

        if (!this._mixer) return;
        this._mixer.update(delta);
        if (!this._fbx || this.isDead) return;

        // Bake the gun's grip orientation once the idle pose is live
        if (this._gun && !this._gunAligned) { this._alignGun(); this._gunAligned = true; }

        // Pick animation from movement direction relative to facing
        const dx    = this.mesh.position.x - this._prevPos.x;
        const dz    = this.mesh.position.z - this._prevPos.z;
        const speed = Math.sqrt(dx * dx + dz * dz) / Math.max(delta, 0.001);

        if (speed > 0.3) {
            const ry    = this.mesh.rotation.y;
            const fX    =  Math.sin(ry);   // model's forward (+Z) direction
            const fZ    =  Math.cos(ry);
            const dot   =  dx * fX   + dz * fZ;
            const cross =  dx * (-fZ) - dz * (-fX);

            if (Math.abs(cross) > Math.abs(dot) * 0.7) {
                this._setAnim(cross > 0 ? 'strafeR' : 'strafeL');
            } else if (dot < 0) {
                this._setAnim('walkBack');
            } else {
                this._setAnim(speed > 8 ? 'run' : 'walk');
            }
        } else if (this._currentAnim !== 'fire' && this._currentAnim !== 'hit') {
            this._setAnim('idle');
        }
    }

    flash() {
        this._setAnim('hit', 0.1);
        this.mesh.traverse(c => {
            if (!c.isMesh || !c.material?.color) return;
            const orig = c.material.color.getHex();
            c.material.color.setHex(0xff2222);
            setTimeout(() => { if (c.material) c.material.color.setHex(orig); }, 200);
        });
        setTimeout(() => { if (!this.isDead) this._setAnim('idle', 0.3); }, 800);
    }

    die() {
        if (this.isDead) return;
        this.isDead = true;

        if (this._mixer && _clips.die) {
            // Play the Dying clip once and clamp on the final (lying) frame.
            this._currentAction?.stop();
            const action = this._mixer.clipAction(_clips.die);
            action.reset();
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
            action.play();
            this._currentAction = action;
            this._currentAnim   = 'die';
            // Hold the corpse for the clip's length + a short beat, then remove.
            const ms = (_clips.die.duration || 3) * 1000 + 1500;
            setTimeout(() => this.dispose(), ms);
        } else {
            // Fallback if the clip didn't load: tip over and remove.
            this._mixer?.stopAllAction();
            this.mesh.rotation.z = Math.PI / 2;
            setTimeout(() => this.dispose(), 3000);
        }
    }

    dispose() {
        if (this.isDisposed) return;
        this.isDisposed = true;
        this._mixer?.stopAllAction();
        this._mixer = null;
        this.scene.remove(this.mesh);
        this.mesh.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
    }
}
