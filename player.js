import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { PlayerBase } from './entities.js';
import { loadGunModel } from './gun-model.js';

export class Player {
    constructor(camera, domElement, uiElement, getTerrainHeightFunc, checkCollisionFunc, scene) {
        this.camera = camera;
        this.scene = scene;
        this.getTerrainHeight = getTerrainHeightFunc;
        this.checkCollision = checkCollisionFunc; 
        
        this.controls = new PointerLockControls(camera, domElement);
        this.crosshair = document.getElementById('crosshair'); 
        this.scopeOverlay = document.getElementById('scope-overlay'); 
        this.hud = document.getElementById('hud');
        this.deathScreen = document.getElementById('death-screen');
        this.hotbar = document.getElementById('hotbar'); 
        
        uiElement.addEventListener('click', () => this.controls.lock());
        this.controls.addEventListener('lock', () => {
            uiElement.style.display = 'none';
            if (this.isSpectator) { this.spectatorBanner.style.display = 'block'; return; }
            if (this.currentZoomIndex === 0) this.crosshair.style.display = 'block';
            if (!this.isDead) { this.hud.style.display = 'block'; this.hotbar.style.display = 'block'; }
        });
        this.controls.addEventListener('unlock', () => {
            this.crosshair.style.display = 'none'; this.scopeOverlay.style.display = 'none'; 
            this.hud.style.display = 'none'; this.hotbar.style.display = 'none'; 
        });

        this.velocity = new THREE.Vector3(); 
        this.direction = new THREE.Vector3();
        this.knockbackVelocity = new THREE.Vector3(); // NEW: KNOCKBACK VARIABLE!
        this.moveState = { forward: false, backward: false, left: false, right: false, run: false };
        this.canJump = false;

        this.health = 100; this.score = 0; this.isDead = false;
        this.isSpectator = false;                 // eliminated → walk-only ghost
        this.headshotMultiplier = 4;              // sniper body 20 → head 80
        this.regenDelayMs = 60000;                // taken damage heals back after 1 min
        this.healthUI = document.getElementById('healthDisplay'); this.scoreUI = document.getElementById('scoreDisplay');

        // Spectator banner (hidden until eliminated)
        this.spectatorBanner = document.createElement('div');
        this.spectatorBanner.style.cssText = [
            'position:absolute', 'top:18px', 'left:50%', 'transform:translateX(-50%)',
            'background:rgba(0,0,0,0.7)', 'color:#bbb', 'font-family:monospace',
            'font-size:1rem', 'padding:8px 20px', 'border-radius:6px',
            'border:1px solid #444', 'z-index:160', 'pointer-events:none', 'display:none'
        ].join(';');
        this.spectatorBanner.textContent = '👻 SPECTATING — you were eliminated';
        document.body.appendChild(this.spectatorBanner);

        this.raycaster = new THREE.Raycaster();
        this.raycaster.layers.set(0); // layer 0 only — ignores weapons (layer 1)
        this.weapons = []; this.projectiles = [];
        this.currentWeaponIndex = 0; this.recoilOffset = 0; 
        this.placedBlocks = []; 
        
        this.baseFov = 75; this.zoomLevels = [this.baseFov, this.baseFov / 4, this.baseFov / 6, this.baseFov / 8];
        this.currentZoomIndex = 0; 

        this.buildWeapons();
        this.initEventListeners();
    }

    buildWeapons() {
        const gunMatDark = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
        const gunMatWood = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
        const gunMatSilver = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.5 });

        const sniperGroup = new THREE.Group();
        // Sniper rifle model loaded from GLB (replaces the old box geometry).
        // Native model: barrel +Z, up +Y. Camera looks down -Z, so rotate 180°
        // about Y to aim the muzzle forward (away from the player).
        loadGunModel('./models/sniper.glb', 1.4, (model) => {
            model.traverse(child => { if (child.isMesh) child.layers.set(1); });
            model.rotation.y = Math.PI;
            sniperGroup.add(model);
        });
        
        const deagleGroup = new THREE.Group();
        const slide = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 0.6), gunMatSilver); slide.position.set(0, 0.2, -0.2);
        const grip  = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.2), gunMatDark);    grip.rotation.x = 0.3; grip.position.set(0, -0.05, 0);
        deagleGroup.add(slide, grip);

        const hammerGroup = new THREE.Group();
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0), gunMatWood); handle.position.set(0, -0.2, 0); handle.rotation.x = -Math.PI / 4;
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.5), gunMatSilver); head.position.set(0, 0.15, -0.35); head.rotation.x = -Math.PI / 4;
        hammerGroup.add(handle, head);

        sniperGroup.stats = { damage: 20, fireRate: 1.5, recoil: 0.4, speed: 600, drop: 9.8, type: 'gun' };
        deagleGroup.stats  = { damage: 35,  fireRate: 0.3, recoil: 0.15, speed: 200, drop: 15.0, type: 'gun' };
        hammerGroup.stats  = { fireRate: 0.3, recoil: 0.2, type: 'tool' };

        this.weapons.push(sniperGroup, deagleGroup, hammerGroup);
        this.weapons.forEach((w, index) => {
            w.position.set(0.4, -0.3, -0.6);
            w.visible = index === 0;
            w.traverse(child => { if (child.isMesh) child.layers.set(1); });
            this.camera.add(w);
        });
        this.scene.add(this.camera);
        this.camera.layers.enable(1); // camera sees layer 0 (world) + layer 1 (weapons); raycaster sees layer 0 only
        this.canShoot = true;
    }

    initEventListeners() {
        document.addEventListener('keydown', (e) => {
            if (!this.controls.isLocked) return;
            if (e.code === 'KeyW') this.moveState.forward = true;
            if (e.code === 'KeyS') this.moveState.backward = true;
            if (e.code === 'KeyA') this.moveState.left = true;
            if (e.code === 'KeyD') this.moveState.right = true;
            if (e.code === 'ShiftLeft') this.moveState.run = true;
            if (e.code === 'Space' && this.canJump) this.velocity.y += 15; 
            
            if (e.code === 'Digit1') this.switchWeapon(0); 
            if (e.code === 'Digit2') this.switchWeapon(1); 
            if (e.code === 'Digit3') this.switchWeapon(2); 
        });
        document.addEventListener('keyup', (e) => {
            if (e.code === 'KeyW') this.moveState.forward = false;
            if (e.code === 'KeyS') this.moveState.backward = false;
            if (e.code === 'KeyA') this.moveState.left = false;
            if (e.code === 'KeyD') this.moveState.right = false;
            if (e.code === 'ShiftLeft') this.moveState.run = false;
        });

        document.addEventListener('mousedown', (e) => {
            if (!this.controls.isLocked) return;
            if (e.button === 0) this.shoot();
            else if (e.button === 2) this.toggleScope();
        });
    }

    switchWeapon(index) {
        if (this.isSpectator) return;
        if (this.currentWeaponIndex === index) return;
        if (this.currentZoomIndex > 0) { this.currentZoomIndex = 0; this.applyZoom(); }
        this.weapons.forEach((w, i) => w.visible = (i === index));
        this.currentWeaponIndex = index;
    }

    toggleScope() {
        if (this.isSpectator) return;
        if (this.currentWeaponIndex !== 0) return;
        this.currentZoomIndex++;
        if (this.currentZoomIndex >= this.zoomLevels.length) this.currentZoomIndex = 0; 
        this.applyZoom();
    }

    applyZoom() {
        this.camera.fov = this.zoomLevels[this.currentZoomIndex];
        this.camera.updateProjectionMatrix();
        this.controls.pointerSpeed = this.camera.fov / this.baseFov;

        if (this.currentZoomIndex === 0) {
            this.crosshair.style.display = 'block'; this.scopeOverlay.style.display = 'none'; this.weapons[0].visible = true; 
        } else {
            this.crosshair.style.display = 'none'; this.scopeOverlay.style.display = 'block'; this.weapons[0].visible = false; 
        }
    }

    addScore(points) {
        if (this.isDead) return;
        this.score += points; this.scoreUI.innerText = `Score: ${this.score}`;
    }

    // THE FIX: takeDamage now accepts the Monster's Location to calculate the push direction
    takeDamage(amount, attackerPos = null) {
        if (this.isDead) return;
        this.health -= amount; this.healthUI.innerText = `Health: ${this.health}`;

        // Regenerate this exact amount after the regen delay (1 min), capped at
        // 100 — but only if we're still alive when the timer fires.
        setTimeout(() => {
            if (this.isDead || this.isSpectator) return;
            this.health = Math.min(100, this.health + amount);
            this.healthUI.innerText = `Health: ${this.health}`;
        }, this.regenDelayMs);

        const flash = document.createElement('div');
        flash.style.position = 'absolute'; flash.style.top = '0'; flash.style.left = '0'; flash.style.width = '100%'; flash.style.height = '100%';
        flash.style.background = 'rgba(255, 0, 0, 0.4)'; flash.style.pointerEvents = 'none'; flash.style.zIndex = '150';
        document.body.appendChild(flash);
        setTimeout(() => document.body.removeChild(flash), 150);

        // --- NEW: THE KNOCKBACK LAUNCH ---
        if (attackerPos) {
            // Find direction AWAY from the monster
            const dx = this.camera.position.x - attackerPos.x;
            const dz = this.camera.position.z - attackerPos.z;
            const dist = Math.sqrt(dx*dx + dz*dz);
            
            if (dist > 0) {
                // Shove the player 80 units backwards and 25 units up!
                this.knockbackVelocity.x = (dx / dist) * 80;
                this.knockbackVelocity.z = (dz / dist) * 80;
                this.velocity.y = 25; 
                this.canJump = false; // Disable normal jumping while airborne
            }
        }

        if (this.health <= 0) {
            this.health = 0; this.healthUI.innerText = `Health: 0`;
            this.enterSpectator();
        }
    }

    // Eliminated: become an invisible, gun-less ghost that can still walk.
    // We keep the pointer locked so movement keeps working — no death screen.
    enterSpectator() {
        if (this.isSpectator) return;
        this.isSpectator = true;
        this.isDead = true;          // networking: server counts us dead; drives kill feed
        this.canShoot = false;

        // Drop any scope/zoom and hide every weapon + combat UI
        this.currentZoomIndex = 0;
        this.camera.fov = this.baseFov;
        this.camera.updateProjectionMatrix();
        this.controls.pointerSpeed = 1;
        this.weapons.forEach(w => w.visible = false);
        this.crosshair.style.display = 'none';
        this.scopeOverlay.style.display = 'none';
        this.hud.style.display = 'none';
        this.hotbar.style.display = 'none';
        this.spectatorBanner.style.display = 'block';
    }

    // Round reset / respawn — restore a living, armed player.
    exitSpectator() {
        this.isSpectator = false;
        this.isDead = false;
        this.health = 100;
        this.healthUI.innerText = 'Health: 100';
        this.canShoot = true;
        this.currentWeaponIndex = 0;
        this.currentZoomIndex = 0;
        this.weapons.forEach((w, i) => w.visible = (i === 0));
        this.spectatorBanner.style.display = 'none';
        if (this.controls.isLocked) {
            this.crosshair.style.display = 'block';
            this.hud.style.display = 'block';
            this.hotbar.style.display = 'block';
        }
    }

    shoot() {
        if (!this.canShoot || this.isDead || this.isSpectator) return;
        const currentWeapon = this.weapons[this.currentWeaponIndex];

        this.recoilOffset = currentWeapon.stats.recoil;
        this.canShoot = false;
        setTimeout(() => this.canShoot = true, currentWeapon.stats.fireRate * 1000);

        if (currentWeapon.stats.type === 'tool') {
            this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
            const intersects = this.raycaster.intersectObjects(this.scene.children, true);
            if (intersects.length > 0 && intersects[0].distance < 40) {
                const hit = intersects[0];
                const baseRef = hit.object.baseRef;
                if (baseRef) {
                    baseRef.upgrade();
                } else {
                    const hitPos = hit.point;
                    hitPos.y = this.getTerrainHeight(hitPos.x, hitPos.z);
                    const newBase = new PlayerBase(hitPos.x, hitPos.y, hitPos.z, this.scene);
                    this.placedBlocks.push(newBase);
                }
            }
        } else {
            const aimDir = new THREE.Vector3();
            this.camera.getWorldDirection(aimDir);

            // ── Instant hitscan (damage registered the moment you fire) ──
            // Standard FPS approach — no terrain blocking, lag-free, reliable.
            this.raycaster.set(this.camera.position, aimDir);
            const hits = this.raycaster.intersectObjects(this.scene.children, true);

            for (const hit of hits) {
                let cur = hit.object;
                let entityHit = false;
                while (cur) {
                    if (cur.remotePlayerRef) {
                        const rp = cur.remotePlayerRef;
                        // Headshot: hit point sits in the upper ~head zone above
                        // the player's feet (mesh.position.y is snapped to ground).
                        const isHead = hit.point.y >= rp.mesh.position.y + 1.5;
                        const damage = isHead
                            ? currentWeapon.stats.damage * this.headshotMultiplier
                            : currentWeapon.stats.damage;
                        rp.flash();
                        if (this.onRemotePlayerHit) this.onRemotePlayerHit(rp, damage, isHead);
                        entityHit = true; break;
                    }
                    if (cur.animalRef)  { cur.animalRef.takeDamage(currentWeapon.stats.damage, this);  entityHit = true; break; }
                    if (cur.monsterRef) { cur.monsterRef.takeDamage(currentWeapon.stats.damage, this); entityHit = true; break; }
                    cur = cur.parent;
                }
                if (entityHit) break;
                if (hit.object.isMesh) break; // hit solid world geometry — stop here
            }

            // Broadcast shot so other clients can show the tracer + muzzle flash
            if (this.onShot) {
                const pos = this.camera.position;
                this.onShot(pos.x, pos.y, pos.z, aimDir.x, aimDir.y, aimDir.z,
                            currentWeapon.stats.speed, currentWeapon.stats.drop);
            }

            // ── Visual tracer bullet (cosmetic only, no damage) ──
            this._spawnTracer(this.camera.position, aimDir,
                              currentWeapon.stats.speed, currentWeapon.stats.drop);
        }
    }

    // Shared tracer spawner — used for local shots and remote shots
    _spawnTracer(origin, dir, speed, drop) {
        const bullet = new THREE.Mesh(
            new THREE.SphereGeometry(0.15, 4, 4),
            new THREE.MeshBasicMaterial({ color: 0xffdd00 })
        );
        bullet.position.copy(origin).addScaledVector(dir, 2.0);
        bullet.velocity    = dir.clone().multiplyScalar(speed);
        bullet.gravityDrop = drop;
        bullet.life        = 1.5;
        this.scene.add(bullet);
        this.projectiles.push(bullet);
    }

    update(delta) {
        // Spectators (isDead) keep walking — only fully stop when unlocked.
        if (!this.controls.isLocked) return;

        // Tracer bullets — visual only, damage was dealt instantly on fire
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            p.life -= delta;
            if (p.life <= 0) {
                this.scene.remove(p);
                p.geometry.dispose();
                p.material.dispose();
                this.projectiles.splice(i, 1);
                continue;
            }
            p.velocity.y -= p.gravityDrop * delta;
            p.position.addScaledVector(p.velocity, delta);
        }

        if (this.recoilOffset > 0) { this.recoilOffset -= delta * 2; if (this.recoilOffset < 0) this.recoilOffset = 0; }
        const activeWeapon = this.weapons[this.currentWeaponIndex];
        if (activeWeapon.visible) activeWeapon.rotation.x = this.recoilOffset;
        
        // --- Normal Movement & Gravity ---
        this.velocity.x -= this.velocity.x * 10.0 * delta; 
        this.velocity.z -= this.velocity.z * 10.0 * delta; 
        this.velocity.y -= 9.8 * 6.0 * delta; 

        // --- NEW: Knockback Sliding Friction ---
        this.knockbackVelocity.x -= this.knockbackVelocity.x * 5.0 * delta; 
        this.knockbackVelocity.z -= this.knockbackVelocity.z * 5.0 * delta; 
        
        this.direction.z = Number(this.moveState.forward) - Number(this.moveState.backward); 
        this.direction.x = Number(this.moveState.right) - Number(this.moveState.left); 
        this.direction.normalize();

        const speed = this.moveState.run ? 150.0 : 50.0;
        if (this.moveState.forward || this.moveState.backward) this.velocity.z -= this.direction.z * speed * delta;
        if (this.moveState.left || this.moveState.right) this.velocity.x -= this.direction.x * speed * delta;

        const oldX = this.camera.position.x; const oldZ = this.camera.position.z;
        this.controls.moveRight(-this.velocity.x * delta); this.controls.moveForward(-this.velocity.z * delta);
        
        // --- NEW: Apply World-Space Knockback Force ---
        this.camera.position.x += this.knockbackVelocity.x * delta;
        this.camera.position.z += this.knockbackVelocity.z * delta;

        const newX = this.camera.position.x; const newZ = this.camera.position.z; const playerRadius = 1.0;

        let hitWall = this.checkCollision(newX, newZ, playerRadius);
        
        if (hitWall) {
            if (!this.checkCollision(oldX, newZ, playerRadius)) this.camera.position.x = oldX; 
            else if (!this.checkCollision(newX, oldZ, playerRadius)) this.camera.position.z = oldZ; 
            else { this.camera.position.x = oldX; this.camera.position.z = oldZ; }
        }

        this.camera.position.y += this.velocity.y * delta;
        
        let floorHeight = this.getTerrainHeight(this.camera.position.x, this.camera.position.z);
        this.raycaster.set(this.camera.position, new THREE.Vector3(0, -1, 0));
        
        const baseMeshes = this.placedBlocks.map(b => b.mesh);
        if (baseMeshes.length > 0) {
            const downIntersects = this.raycaster.intersectObjects(baseMeshes, true);
            if (downIntersects.length > 0) {
                const hitPointY = downIntersects[0].point.y; 
                if (hitPointY > floorHeight) floorHeight = hitPointY;
            }
        }
        
        if (this.camera.position.y < floorHeight + 1.7) {
            this.velocity.y = 0; this.camera.position.y = floorHeight + 1.7; this.canJump = true; 
        } else { this.canJump = false; }
    }
}