import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

export class Player {
    constructor(camera, domElement, uiElement, getTerrainHeightFunc, checkCollisionFunc, scene) {
        this.camera = camera;
        this.scene = scene;
        this.getTerrainHeight = getTerrainHeightFunc;
        this.checkCollision = checkCollisionFunc; 
        
        this.controls = new PointerLockControls(camera, domElement);
        this.crosshair = document.getElementById('crosshair'); 
        this.scopeOverlay = document.getElementById('scope-overlay'); 
        
        uiElement.addEventListener('click', () => this.controls.lock());
        this.controls.addEventListener('lock', () => {
            uiElement.style.display = 'none';
            if (this.currentZoomIndex === 0) this.crosshair.style.display = 'block'; 
        });
        this.controls.addEventListener('unlock', () => {
            this.crosshair.style.display = 'none'; 
            this.scopeOverlay.style.display = 'none'; 
        });

        this.velocity = new THREE.Vector3();
        this.direction = new THREE.Vector3();
        this.moveState = { forward: false, backward: false, left: false, right: false, run: false };
        this.canJump = false;

        // --- NEW: PLAYER STATS ---
        this.health = 100;
        this.score = 0;
        this.isDead = false;
        
        // Grab the UI elements
        this.healthUI = document.getElementById('healthDisplay');
        this.scoreUI = document.getElementById('scoreDisplay');
        this.hud = document.getElementById('hud');
        this.deathScreen = document.getElementById('death-screen');

        // Show HUD when we lock in
        this.controls.addEventListener('lock', () => {
            uiElement.style.display = 'none';
            if (this.currentZoomIndex === 0) this.crosshair.style.display = 'block'; 
            if (!this.isDead) this.hud.style.display = 'block'; // Show HUD
        });
        this.controls.addEventListener('unlock', () => {
            this.crosshair.style.display = 'none'; 
            this.scopeOverlay.style.display = 'none'; 
            this.hud.style.display = 'none'; // Hide HUD when paused
        });

        this.raycaster = new THREE.Raycaster();
        this.weapons = [];
        this.currentWeaponIndex = 0;
        this.recoilOffset = 0; 
        
        // --- NEW: PROJECTILE ARRAY ---
        this.projectiles = [];
        
        this.baseFov = 75;
        this.zoomLevels = [this.baseFov, this.baseFov / 4, this.baseFov / 6, this.baseFov / 8];
        this.currentZoomIndex = 0; 

        this.buildWeapons();
        this.initEventListeners();
    }

    buildWeapons() {
        const gunMatDark = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
        const gunMatWood = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
        const gunMatSilver = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.5 });

        // 1. THE SNIPER
        const sniperGroup = new THREE.Group();
        const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.5), gunMatDark); barrel.position.set(0, 0.1, -0.6);
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.8), gunMatWood); stock.position.set(0, 0, 0.4);
        const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.4, 8), gunMatDark); scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.25, 0);
        sniperGroup.add(barrel, stock, scope);
        
        // 2. THE DESERT EAGLE
        const deagleGroup = new THREE.Group();
        const slide = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 0.6), gunMatSilver); slide.position.set(0, 0.2, -0.2);
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.2), gunMatDark); grip.rotation.x = 0.3; grip.position.set(0, -0.05, 0);
        deagleGroup.add(slide, grip);

        // NEW: Added bulletSpeed and bulletDrop variables!
        sniperGroup.stats = { damage: 100, fireRate: 1.5, recoil: 0.4, speed: 600, drop: 9.8, name: 'Sniper' };
        deagleGroup.stats = { damage: 35, fireRate: 0.3, recoil: 0.15, speed: 200, drop: 15.0, name: 'Deagle' };

        this.weapons.push(sniperGroup, deagleGroup);

        this.weapons.forEach((w, index) => {
            w.position.set(0.4, -0.3, -0.6);
            w.visible = index === 0; 
            this.camera.add(w);
        });
        
        this.scene.add(this.camera); 
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
            if (e.code === 'Space' && this.canJump) this.velocity.y += 25; 
            
            if (e.code === 'Digit1') this.switchWeapon(0); 
            if (e.code === 'Digit2') this.switchWeapon(1); 
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
        if (this.currentWeaponIndex === index) return;
        if (this.currentZoomIndex > 0) {
            this.currentZoomIndex = 0;
            this.applyZoom();
        }
        this.weapons.forEach((w, i) => w.visible = (i === index));
        this.currentWeaponIndex = index;
    }

    toggleScope() {
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
            this.crosshair.style.display = 'block';
            this.scopeOverlay.style.display = 'none';
            this.weapons[0].visible = true; 
        } else {
            this.crosshair.style.display = 'none';
            this.scopeOverlay.style.display = 'block';
            this.weapons[0].visible = false; 
        }
    }

    // --- UPGRADED: SPAWNS A PHYSICAL BULLET ---
    shoot() {
        if (!this.canShoot) return;
        const currentWeapon = this.weapons[this.currentWeaponIndex];
        
        this.recoilOffset = currentWeapon.stats.recoil;
        this.canShoot = false;
        setTimeout(() => this.canShoot = true, currentWeapon.stats.fireRate * 1000);

        // Create the physical bullet
        const bulletGeo = new THREE.SphereGeometry(0.2, 4, 4);
        const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
        const bullet = new THREE.Mesh(bulletGeo, bulletMat);

        // Start it at the camera
        bullet.position.copy(this.camera.position);

        // Get the direction we are looking
        const aimDir = new THREE.Vector3();
        this.camera.getWorldDirection(aimDir);

        // Give it velocity based on the gun's stats
        bullet.velocity = aimDir.multiplyScalar(currentWeapon.stats.speed);
        bullet.damage = currentWeapon.stats.damage;
        bullet.gravityDrop = currentWeapon.stats.drop;
        bullet.life = 3.0; // Lives for 3 seconds max

        this.scene.add(bullet);
        this.projectiles.push(bullet);
    }

    // --- NEW: COMBAT FUNCTIONS ---
    addScore(points) {
        if (this.isDead) return;
        this.score += points;
        this.scoreUI.innerText = `Score: ${this.score}`;
    }

    takeDamage(amount) {
        if (this.isDead) return;
        this.health -= amount;
        this.healthUI.innerText = `Health: ${this.health}`;

        // Screen flash red effect
        const flash = document.createElement('div');
        flash.style.position = 'absolute';
        flash.style.top = '0'; flash.style.left = '0'; flash.style.width = '100%'; flash.style.height = '100%';
        flash.style.background = 'rgba(255, 0, 0, 0.4)'; flash.style.pointerEvents = 'none'; flash.style.zIndex = '150';
        document.body.appendChild(flash);
        setTimeout(() => document.body.removeChild(flash), 150);

        // Check for Death
        if (this.health <= 0) {
            this.isDead = true;
            this.health = 0;
            this.healthUI.innerText = `Health: 0`;
            this.controls.unlock();
            
            // Show Death Screen
            document.getElementById('ui').style.display = 'none';
            document.getElementById('settingsMenu').style.display = 'none';
            this.hud.style.display = 'none';
            this.deathScreen.style.display = 'flex';
            document.getElementById('final-score').innerText = `Final Score: ${this.score}`;
        }
    }

    update(delta) {
        if (!this.controls.isLocked) return;

        // --- NEW: PROJECTILE PHYSICS LOOP ---
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            
            p.life -= delta;
            if (p.life <= 0) {
                this.scene.remove(p);
                this.projectiles.splice(i, 1);
                continue;
            }

            // 1. Apply Gravity Drop
            p.velocity.y -= p.gravityDrop * delta;

            // 2. Continuous Collision Detection (CCD)
            const oldPos = p.position.clone();
            const moveStep = p.velocity.clone().multiplyScalar(delta);
            const dist = moveStep.length();
            const dir = moveStep.clone().normalize();

            this.raycaster.set(oldPos, dir);
            // Check against animals, terrain, houses, etc.
            const intersects = this.raycaster.intersectObjects(this.scene.children, true);

            if (intersects.length > 0 && intersects[0].distance <= dist) {
                // Hit something!
                const hitObject = intersects[0].object;
                if (hitObject.animalRef) {
                    hitObject.animalRef.takeDamage(p.damage, this);
                }
                
                // Destroy bullet on impact
                this.scene.remove(p);
                this.projectiles.splice(i, 1);
                continue;
            }

            // 3. Move bullet if no collision
            p.position.add(moveStep);
        }

        // --- WEAPON RECOIL ---
        if (this.recoilOffset > 0) {
            this.recoilOffset -= delta * 2;
            if (this.recoilOffset < 0) this.recoilOffset = 0;
        }
        const activeWeapon = this.weapons[this.currentWeaponIndex];
        if (activeWeapon.visible) activeWeapon.rotation.x = this.recoilOffset;
        
        // --- MOVEMENT PHYSICS ---
        this.velocity.x -= this.velocity.x * 10.0 * delta;
        this.velocity.z -= this.velocity.z * 10.0 * delta;
        this.velocity.y -= 9.8 * 6.0 * delta; 

        this.direction.z = Number(this.moveState.forward) - Number(this.moveState.backward);
        this.direction.x = Number(this.moveState.right) - Number(this.moveState.left);
        this.direction.normalize();

        const speed = this.moveState.run ? 150.0 : 50.0;
        if (this.moveState.forward || this.moveState.backward) this.velocity.z -= this.direction.z * speed * delta;
        if (this.moveState.left || this.moveState.right) this.velocity.x -= this.direction.x * speed * delta;

        const oldX = this.camera.position.x;
        const oldZ = this.camera.position.z;

        this.controls.moveRight(-this.velocity.x * delta);
        this.controls.moveForward(-this.velocity.z * delta);

        const newX = this.camera.position.x;
        const newZ = this.camera.position.z;
        const playerRadius = 1.0;

        if (this.checkCollision(newX, newZ, playerRadius)) {
            if (!this.checkCollision(oldX, newZ, playerRadius)) this.camera.position.x = oldX; 
            else if (!this.checkCollision(newX, oldZ, playerRadius)) this.camera.position.z = oldZ; 
            else { this.camera.position.x = oldX; this.camera.position.z = oldZ; }
        }

        this.camera.position.y += this.velocity.y * delta;
        const groundHeight = this.getTerrainHeight(this.camera.position.x, this.camera.position.z);
        
        if (this.camera.position.y < groundHeight + 3.0) {
            this.velocity.y = 0; 
            this.camera.position.y = groundHeight + 3.0; 
            this.canJump = true; 
        } else {
            this.canJump = false; 
        }
    }
}