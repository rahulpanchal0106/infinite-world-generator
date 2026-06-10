import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

// --- MONSTER FBX ASSETS ---
// "Wheelbarrow Walk (1).fbx" is the base model — it supplies the mesh, skeleton,
// and the idle clip all in one file. The other four supply only their anim clips.
// All five are from the same Mixamo rig so bone names match perfectly.
// Source scene is never modified — each Monster gets a SkeletonUtils.clone.

let monsterBaseData = null;   // { scene, scaleFactor, yOffset }
const monsterFBXAnims = { idle: null, walk: null, attack: null, hit: null, death: null };

(function loadMonsterAssets() {
    const loader = new FBXLoader();

    // --- Base model (mesh + idle clip) ---
    loader.load('/models/Wheelbarrow Walk (1).fbx', (fbx) => {
        const box = new THREE.Box3().setFromObject(fbx);
        const h   = box.getSize(new THREE.Vector3()).y || 1;
        const scaleFactor = 5 / h;
        const yOffset     = -box.min.y * scaleFactor; // sit base at y=0

        fbx.traverse(c => {
            if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
        });

        monsterBaseData           = { scene: fbx, scaleFactor, yOffset };
        monsterFBXAnims.idle      = fbx.animations[0] ?? null;
        console.log('Monster base model ready (idle clip included)');
    }, undefined, err => console.error('Monster base FBX failed:', err));

    // --- Extra animation clips only (mesh is ignored) ---
    const loadClip = (key, file) => {
        loader.load(`/models/${file}`, fbx => {
            monsterFBXAnims[key] = fbx.animations[0] ?? null;
            console.log(`Monster anim ready: ${key}`);
        }, undefined, err => console.warn(`Monster anim failed (${key}):`, err));
    };

    loadClip('walk',   'Slow Run.fbx');
    loadClip('attack', 'Standing Melee Combo Attack Ver. 3.fbx');
    loadClip('hit',    'Standing React Small From Back.fbx');
    loadClip('death',  'Dying (2).fbx');
}());

export class Animal {
    constructor(type, x, y, z, scene) {
        this.type = type;
        this.scene = scene;
        this.mesh = new THREE.Group();
        this.mesh.position.set(x, y, z);
        this.mesh.isAnimal = true; 
        this.mesh.animalRef = this; 

        this.health = type === 'bear' ? 200 : (type === 'camel' ? 100 : 50);
        this.isDead = false;
        this.deathTimer = 3.0; 
        this.isDisposed = false;
        
        this.target = new THREE.Vector3(x, y, z);
        this.speed = type === 'deer' ? 8 : (type === 'camel' ? 5 : 6);
        this.state = 'idle'; 
        this.timer = Math.random() * 5;
        this.walkCycle = 0;
        this.legs = [];

        this.buildModel();
        this.scene.add(this.mesh);
    }

    buildModel() {
        const deerMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, flatShading: true });
        const camelMat = new THREE.MeshStandardMaterial({ color: 0xd2b48c, flatShading: true });
        const bearMat = new THREE.MeshStandardMaterial({ color: 0xfffafa, flatShading: true });
        const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222, flatShading: true });

        const addPart = (geo, mat, px, py, pz) => {
            const part = new THREE.Mesh(geo, mat); part.position.set(px, py, pz);
            part.castShadow = true; part.receiveShadow = true; part.animalRef = this; 
            this.mesh.add(part);
        };

        const addLeg = (width, height, depth, mat, px, py, pz) => {
            const geo = new THREE.BoxGeometry(width, height, depth); geo.translate(0, -height / 2, 0); 
            const leg = new THREE.Mesh(geo, mat); leg.position.set(px, py, pz);
            leg.castShadow = true; leg.receiveShadow = true; leg.animalRef = this; 
            this.mesh.add(leg); this.legs.push(leg); 
        };

        if (this.type === 'deer') {
            addLeg(0.4, 2.5, 0.4, darkMat, -0.5, 2.5, 1.0); addLeg(0.4, 2.5, 0.4, darkMat, 0.5, 2.5, 1.0); addLeg(0.4, 2.5, 0.4, darkMat, -0.5, 2.5, -1.0); addLeg(0.4, 2.5, 0.4, darkMat, 0.5, 2.5, -1.0);
            addPart(new THREE.BoxGeometry(1.5, 1.5, 3), deerMat, 0, 3, 0); addPart(new THREE.BoxGeometry(0.8, 2, 0.8), deerMat, 0, 4.5, 1.2); addPart(new THREE.BoxGeometry(1, 1, 1.5), deerMat, 0, 5.2, 1.8); 
            addPart(new THREE.BoxGeometry(0.2, 1.5, 0.2), darkMat, -0.4, 6.0, 1.5); addPart(new THREE.BoxGeometry(0.2, 1.5, 0.2), darkMat, 0.4, 6.0, 1.5);
        } 
        else if (this.type === 'camel') {
            addLeg(0.6, 3.5, 0.6, camelMat, -0.7, 3.5, 1.5); addLeg(0.6, 3.5, 0.6, camelMat, 0.7, 3.5, 1.5); addLeg(0.6, 3.5, 0.6, camelMat, -0.7, 3.5, -1.5); addLeg(0.6, 3.5, 0.6, camelMat, 0.7, 3.5, -1.5);
            addPart(new THREE.BoxGeometry(2, 2, 4), camelMat, 0, 4.5, 0); addPart(new THREE.BoxGeometry(1.5, 1.5, 1.5), camelMat, 0, 6.0, -0.5); addPart(new THREE.BoxGeometry(1, 2.5, 1), camelMat, 0, 6.0, 2); addPart(new THREE.BoxGeometry(1.2, 1.2, 2), camelMat, 0, 7.0, 2.5); 
        } 
        else if (this.type === 'bear') {
            addLeg(0.8, 2, 0.8, bearMat, -0.8, 2, 1.5); addLeg(0.8, 2, 0.8, bearMat, 0.8, 2, 1.5); addLeg(0.8, 2, 0.8, bearMat, -0.8, 2, -1.5); addLeg(0.8, 2, 0.8, bearMat, 0.8, 2, -1.5);
            addPart(new THREE.BoxGeometry(2.5, 2, 4.5), bearMat, 0, 3, 0); addPart(new THREE.BoxGeometry(1.8, 1.5, 2), bearMat, 0, 3.5, 2.8); addPart(new THREE.BoxGeometry(0.5, 0.4, 0.2), darkMat, 0, 3.5, 3.9);
        }
    }

    takeDamage(amount, player) {
        if (this.isDead) return;
        this.health -= amount;
        
        this.mesh.children.forEach(child => {
            if (child.material && child.material.color) {
                const originalHex = child.material.color.getHex();
                child.material.color.setHex(0xff0000);
                setTimeout(() => { if (!this.isDead && child.material) child.material.color.setHex(originalHex); }, 150);
            }
        });

        if (this.health <= 0) {
            this.isDead = true;
            if (player) {
                if (this.type === 'deer') player.addScore(10);
                if (this.type === 'camel') player.addScore(25);
                if (this.type === 'bear') player.addScore(100);
            }
        } else {
            this.state = 'wandering'; this.speed *= 2; this.timer = 3;
            const angle = Math.random() * Math.PI * 2;
            this.target.set(this.mesh.position.x + Math.cos(angle) * 50, 0, this.mesh.position.z + Math.sin(angle) * 50);
        }
    }

    update(delta, getTerrainHeight, player) {
        if (this.isDisposed) return;

        if (this.isDead) {
            const targetRotation = Math.PI / 2;
            this.mesh.rotation.z += (targetRotation - this.mesh.rotation.z) * 4 * delta;
            const groundY = getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
            this.mesh.position.y += ((groundY - 0.8) - this.mesh.position.y) * 4 * delta;
            this.deathTimer -= delta;
            if (this.deathTimer <= 0) this.dispose();
            return; 
        }

        this.timer -= delta;
        let isChasing = false;
        
        if (this.type === 'bear' && player && !player.isDead) {
            const dx = player.camera.position.x - this.mesh.position.x; const dz = player.camera.position.z - this.mesh.position.z;
            const distanceToPlayer = Math.sqrt(dx*dx + dz*dz);
            if (distanceToPlayer < 40) {
                isChasing = true; this.state = 'chasing'; this.speed = 14; 
                this.target.set(player.camera.position.x, 0, player.camera.position.z);
                if (distanceToPlayer < 3.5 && this.timer <= 0) { player.takeDamage(25); this.timer = 1.0; }
            }
        }

        if (!isChasing && this.timer <= 0) {
            this.speed = this.type === 'deer' ? 8 : (this.type === 'camel' ? 5 : 6); 
            if (this.state === 'idle') {
                this.state = 'wandering'; this.timer = 2 + Math.random() * 4; 
                const angle = Math.random() * Math.PI * 2;
                this.target.set(this.mesh.position.x + Math.cos(angle) * 20, 0, this.mesh.position.z + Math.sin(angle) * 20);
            } else { this.state = 'idle'; this.timer = 1 + Math.random() * 4; }
        }

        let isMoving = false;
        if (this.state === 'wandering' || this.state === 'chasing') {
            const dx = this.target.x - this.mesh.position.x; const dz = this.target.z - this.mesh.position.z;
            const dist = Math.sqrt(dx*dx + dz*dz);
            if (dist > 1) {
                isMoving = true;
                this.mesh.position.x += (dx / dist) * this.speed * delta;
                this.mesh.position.z += (dz / dist) * this.speed * delta;
                this.mesh.rotation.y += (Math.atan2(dx, dz) - this.mesh.rotation.y) * 5 * delta;
                this.walkCycle += delta * this.speed * 1.5; const swing = Math.sin(this.walkCycle) * 0.6; 
                this.legs[0].rotation.x = swing; this.legs[1].rotation.x = -swing; this.legs[2].rotation.x = -swing; this.legs[3].rotation.x = swing; 
            }
        }
        if (!isMoving) { this.walkCycle = 0; this.legs.forEach(leg => leg.rotation.x += (0 - leg.rotation.x) * 10 * delta); }
        this.mesh.position.y = getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
    }

    dispose() {
        if (this.isDisposed) return;
        this.isDisposed = true; this.scene.remove(this.mesh);
        this.mesh.children.forEach(child => { if (child.geometry) child.geometry.dispose(); if (child.material) child.material.dispose(); });
    }
}

// --- NEW: THE INSTANT-MERGE BASE ---
export class PlayerBase {
    constructor(x, y, z, scene) {
        this.scene = scene;
        this.mesh = new THREE.Group();
        this.mesh.position.set(x, y, z);
        this.mesh.isPlayerBase = true;
        this.mesh.baseRef = this;
        this.level = 1;
        this.buildModel();
        this.scene.add(this.mesh);
    }

    buildModel() {
        while(this.mesh.children.length > 0){ 
            const child = this.mesh.children[0];
            this.mesh.remove(child); 
            if(child.geometry) child.geometry.dispose();
            if(child.material) child.material.dispose();
        }

        const addPart = (geo, color, px, py, pz) => {
            const mat = new THREE.MeshStandardMaterial({ color: color, flatShading: true });
            const part = new THREE.Mesh(geo, mat);
            part.position.set(px, py, pz);
            part.castShadow = true; part.receiveShadow = true;
            part.baseRef = this; 
            this.mesh.add(part);
        };

        if (this.level === 1) {
            addPart(new THREE.BoxGeometry(6, 0.5, 6), 0x555555, 0, 0.25, 0); 
            addPart(new THREE.BoxGeometry(5, 5, 5), 0x8b5a2b, 0, 3, 0);      
            addPart(new THREE.BoxGeometry(6, 2, 6), 0x3d2314, 0, 6, 0);      
        } 
        else if (this.level === 2) {
            addPart(new THREE.BoxGeometry(10, 1, 10), 0x444444, 0, 0.5, 0);  
            addPart(new THREE.BoxGeometry(9, 8, 9), 0x888888, 0, 5, 0);      
            addPart(new THREE.BoxGeometry(10, 2, 10), 0x222222, 0, 10, 0);     
            addPart(new THREE.BoxGeometry(12, 3, 1), 0x8b5a2b, 0, 1.5, 5.5); 
            addPart(new THREE.BoxGeometry(12, 3, 1), 0x8b5a2b, 0, 1.5, -5.5);
        }
        else if (this.level === 3) {
            addPart(new THREE.BoxGeometry(16, 2, 16), 0x222222, 0, 1, 0);    
            addPart(new THREE.BoxGeometry(12, 12, 12), 0xaaaaaa, 0, 8, 0);   
            addPart(new THREE.BoxGeometry(14, 4, 14), 0x00ffaa, 0, 15, 0);   
            addPart(new THREE.BoxGeometry(3, 16, 3), 0x555555, 7, 8, 7); 
            addPart(new THREE.BoxGeometry(3, 16, 3), 0x555555, -7, 8, 7);
            addPart(new THREE.BoxGeometry(3, 16, 3), 0x555555, 7, 8, -7);
            addPart(new THREE.BoxGeometry(3, 16, 3), 0x555555, -7, 8, -7);
        }

        this.mesh.scale.set(0.1, 0.1, 0.1);
        const popInterval = setInterval(() => {
            this.mesh.scale.x += (1.0 - this.mesh.scale.x) * 0.4;
            this.mesh.scale.y += (1.0 - this.mesh.scale.y) * 0.4;
            this.mesh.scale.z += (1.0 - this.mesh.scale.z) * 0.4;
            if (this.mesh.scale.x > 0.99) clearInterval(popInterval);
        }, 16);
    }

    upgrade() {
        if (this.level >= 3) return false; 
        this.level++;
        this.buildModel();
        return true;
    }
}

export class Monster {
    constructor(x, y, z, scene) {
        this.scene = scene;
        this.mesh = new THREE.Group();
        this.mesh.position.set(x, y, z);
        this.mesh.isMonster = true;
        this.mesh.monsterRef = this;

        this.health = 250;
        this.isDead = false;
        this.isDisposed = false;
        this.speed = 14;          // chase speed
        this.wanderSpeed = 4;     // slow patrol speed
        this.attackTimer = 0;

        // Wandering AI (same pattern as Animal)
        this.state  = 'idle';
        this.timer  = Math.random() * 4;
        this.target = new THREE.Vector3(x, y, z);

        // Animation state (GLB path)
        this.mixer = null;
        this.animActions = {};
        this.currentAnim = null;
        this.isGLBModel = false;
        this._fbxAnimsBound = false; // true once FBX clips are wired to the mixer
        this._hitReacting = false;   // true while hit-reaction clip is playing
        this._hitTimer = null;

        // Procedural fallback limb refs
        this.leftArm = null; this.rightArm = null;
        this.leftLeg = null; this.rightLeg = null;
        this.walkCycle = 0;

        this.buildModel();
        this.scene.add(this.mesh);
    }

    buildModel() {
        if (monsterBaseData) {
            this.isGLBModel = true;

            // SkeletonUtils.clone gives each monster its own independent bone
            // hierarchy and AnimationMixer — no shared state between instances.
            const cloned = skeletonClone(monsterBaseData.scene);
            cloned.scale.setScalar(monsterBaseData.scaleFactor);
            cloned.position.y = monsterBaseData.yOffset;
            cloned.traverse(c => {
                if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; c.monsterRef = this; }
            });
            this.mesh.add(cloned);
            this._fbxClone = cloned;

            // Mixer is created now; FBX clips are bound via _upgradeAnims()
            // on the first update() tick after they finish loading.
            this.mixer = new THREE.AnimationMixer(cloned);
            this._upgradeAnims(); // bind whatever clips are already ready
            return;
        }

        // --- Fallback: procedural Void Behemoth (FBX not yet loaded) ---
        const bodyMat  = new THREE.MeshStandardMaterial({ color: 0x110a1f, flatShading: true, roughness: 0.8 });
        const eyeMat   = new THREE.MeshStandardMaterial({ color: 0x9900ff, emissive: 0x9900ff, emissiveIntensity: 2 });
        const spikeMat = new THREE.MeshStandardMaterial({ color: 0x000000, flatShading: true });

        const addPart = (geo, mat, px, py, pz) => {
            const part = new THREE.Mesh(geo, mat);
            part.position.set(px, py, pz);
            part.castShadow = true; part.receiveShadow = true; part.monsterRef = this;
            this.mesh.add(part); return part;
        };

        const torso = addPart(new THREE.BoxGeometry(3, 4, 4), bodyMat, 0, 3.5, 0);
        torso.rotation.x = Math.PI / 6;
        addPart(new THREE.BoxGeometry(1.5, 1.5, 2), bodyMat, 0, 4.5, 2.5);
        addPart(new THREE.BoxGeometry(0.3, 0.3, 0.1), eyeMat, -0.4, 4.6, 3.55);
        addPart(new THREE.BoxGeometry(0.3, 0.3, 0.1), eyeMat,  0.4, 4.6, 3.55);
        addPart(new THREE.ConeGeometry(0.6, 2, 4), spikeMat, 0, 5.8, -0.5);
        addPart(new THREE.ConeGeometry(0.5, 1.5, 4), spikeMat, 0, 5, -1.5);
        this.leftArm  = addPart(new THREE.BoxGeometry(1.2, 4, 1.2), bodyMat, -2.2, 2.5, 1.5);
        this.rightArm = addPart(new THREE.BoxGeometry(1.2, 4, 1.2), bodyMat,  2.2, 2.5, 1.5);
        this.leftLeg  = addPart(new THREE.BoxGeometry(1.2, 2, 1.2), bodyMat, -1, 1, -1);
        this.rightLeg = addPart(new THREE.BoxGeometry(1.2, 2, 1.2), bodyMat,  1, 1, -1);
    }

    // Crossfade to a named animation clip.
    _playAnim(name) {
        if (!this.mixer || this.currentAnim === name) return;
        const incoming = this.animActions[name];
        if (!incoming) return;
        const outgoing = this.animActions[this.currentAnim];
        if (outgoing) outgoing.fadeOut(0.25);
        incoming.reset().fadeIn(0.25).play();
        this.currentAnim = name;
    }

    takeDamage(amount, player) {
        if (this.isDead) return;
        this.health -= amount;

        if (this.isGLBModel) {
            // Play the hit-reaction clip (interrupts walk/idle, not death).
            if (this.animActions.hit && !this.isDead) {
                const outgoing = this.animActions[this.currentAnim];
                if (outgoing) outgoing.fadeOut(0.1);
                this.animActions.hit.reset().fadeIn(0.1).play();
                this._hitReacting = true;
                if (this._hitTimer) clearTimeout(this._hitTimer);
                const clipDuration = (monsterFBXAnims.hit?.duration ?? 0.6) * 1000;
                this._hitTimer = setTimeout(() => {
                    if (!this.isDisposed) {
                        this._hitReacting = false;
                        this.currentAnim = null;
                    }
                }, clipDuration - 100);
            }
        } else {
            this.mesh.children.forEach(child => {
                if (child.material && child.material.color) {
                    const orig = child.material.color.getHex();
                    child.material.color.setHex(0xffffff);
                    setTimeout(() => { if (!this.isDead && child.material) child.material.color.setHex(orig); }, 100);
                }
            });
        }

        if (this.health <= 0) {
            this.isDead = true;
            if (player) player.addScore(150);
            if (this.isGLBModel) {
                this._playAnim('death');
                setTimeout(() => this.dispose(), 3000);
            } else {
                this.mesh.rotation.x = -Math.PI / 2;
                this.mesh.position.y -= 1;
                setTimeout(() => this.dispose(), 3000);
            }
        }
    }

    // Swap out the procedural fallback for the FBX model once it finishes loading.
    _upgradeModel() {
        while (this.mesh.children.length > 0) {
            const child = this.mesh.children[0];
            this.mesh.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }
        this.leftArm = null; this.rightArm = null;
        this.leftLeg = null; this.rightLeg = null;
        this.walkCycle = 0;
        this._fbxAnimsBound = false;
        this.buildModel();
    }

    // Bind (or rebind) the FBX animation clips to the active mixer.
    // Called the first frame after all five FBX files have finished loading.
    _upgradeAnims() {
        if (!this.mixer) return;
        this.mixer.stopAllAction();

        const bind = (key) => {
            const clip = monsterFBXAnims[key];
            if (!clip) return null;
            return this.mixer.clipAction(clip);
        };

        this.animActions.idle   = bind('idle');
        this.animActions.walk   = bind('walk');
        this.animActions.attack = bind('attack');
        this.animActions.hit    = bind('hit');
        this.animActions.death  = bind('death');

        // Death plays once and holds the final frame
        if (this.animActions.death) {
            this.animActions.death.loop = THREE.LoopOnce;
            this.animActions.death.clampWhenFinished = true;
        }
        // Hit plays once then the state machine takes back over
        if (this.animActions.hit) {
            this.animActions.hit.loop = THREE.LoopOnce;
            this.animActions.hit.clampWhenFinished = false;
        }

        this._fbxAnimsBound = true;
        this.currentAnim = null; // force clean restart
        this._playAnim('idle');
    }

    update(delta, getTerrainHeight, player) {
        // Always advance the mixer — the death animation needs it even after isDead.
        if (this.mixer) this.mixer.update(delta);

        if (this.isDead) {
            // Keep the corpse on the ground while the death clip plays out.
            this.mesh.position.y = getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
            return;
        }

        // Lazy upgrade #1 — swap procedural model for FBX once the base mesh is ready.
        if (!this.isGLBModel && monsterBaseData) this._upgradeModel();
        // Lazy upgrade #2 — bind any newly-arrived FBX clips to the active mixer.
        if (this.mixer && !this._fbxAnimsBound && monsterFBXAnims.idle) this._upgradeAnims();

        let isMoving    = false;
        let isAttacking = false;
        let isChasing   = false;

        // ── Chase & attack player when close ─────────────────────────────
        if (player && !player.isDead) {
            const dx = player.camera.position.x - this.mesh.position.x;
            const dz = player.camera.position.z - this.mesh.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance < 60) {
                isChasing = true;
                this.state = 'chasing';
                if (distance > 4.5) {
                    isMoving = true;
                    this.mesh.position.x += (dx / distance) * this.speed * delta;
                    this.mesh.position.z += (dz / distance) * this.speed * delta;
                }
                this.mesh.rotation.y = Math.atan2(dx, dz);

                if (distance < 5.5) {
                    isAttacking = true;
                    this.attackTimer += delta;
                    if (this.attackTimer > 0.8) {
                        player.takeDamage(25, this.mesh.position);
                        this.attackTimer = 0;
                    }
                } else {
                    this.attackTimer = 0;
                }
            }
        }

        // ── Wander when no player in range (same pattern as Animal) ──────
        if (!isChasing) {
            this.timer -= delta;
            if (this.timer <= 0) {
                if (this.state === 'wandering' || this.state === 'chasing') {
                    this.state = 'idle';
                    this.timer = 1 + Math.random() * 3;
                } else {
                    this.state = 'wandering';
                    this.timer = 3 + Math.random() * 4;
                    const angle = Math.random() * Math.PI * 2;
                    this.target.set(
                        this.mesh.position.x + Math.cos(angle) * 25,
                        0,
                        this.mesh.position.z + Math.sin(angle) * 25
                    );
                }
            }

            if (this.state === 'wandering') {
                const dx   = this.target.x - this.mesh.position.x;
                const dz   = this.target.z - this.mesh.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist > 1) {
                    isMoving = true;
                    this.mesh.position.x += (dx / dist) * this.wanderSpeed * delta;
                    this.mesh.position.z += (dz / dist) * this.wanderSpeed * delta;
                    this.mesh.rotation.y += (Math.atan2(dx, dz) - this.mesh.rotation.y) * 5 * delta;
                }
            }
        }

        // ── Animation state machine ───────────────────────────────────────
        if (this.mixer) {
            if (!this._hitReacting) {
                if (isAttacking)   this._playAnim('attack');
                else if (isMoving) this._playAnim('walk');
                else               this._playAnim('idle');
            }
        } else if (this.leftArm) {
            if (isMoving) {
                this.walkCycle += delta * this.speed * 1.5;
                const swing = Math.sin(this.walkCycle) * 1.2;
                this.leftArm.position.z  =  1.5 + swing;
                this.rightArm.position.z =  1.5 - swing;
                this.leftLeg.position.z  = -1   - swing;
                this.rightLeg.position.z = -1   + swing;
            }
        }

        this.mesh.position.y = getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
    }

    dispose() {
        if (this.isDisposed) return;
        this.isDisposed = true;
        if (this._hitTimer) { clearTimeout(this._hitTimer); this._hitTimer = null; }
        if (this.mixer) this.mixer.stopAllAction();
        this.scene.remove(this.mesh);
        if (this.isGLBModel) {
            // SkeletonUtils.clone creates new SkinnedMesh geometries — safe to dispose.
            // Materials are shared from the source FBX scene — leave them.
            this.mesh.traverse(child => { if (child.geometry) child.geometry.dispose(); });
        } else {
            this.mesh.children.forEach(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
        }
    }
}