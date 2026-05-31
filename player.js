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
        this.scopeOverlay = document.getElementById('scope-overlay'); // Grab the new UI
        
        uiElement.addEventListener('click', () => this.controls.lock());
        this.controls.addEventListener('lock', () => {
            uiElement.style.display = 'none';
            // Only show hipfire crosshair if not zoomed in
            if (this.currentZoomIndex === 0) this.crosshair.style.display = 'block'; 
        });
        this.controls.addEventListener('unlock', () => {
            this.crosshair.style.display = 'none'; 
            this.scopeOverlay.style.display = 'none'; // Hide scope when paused
        });

        this.velocity = new THREE.Vector3();
        this.direction = new THREE.Vector3();
        this.moveState = { forward: false, backward: false, left: false, right: false, run: false };
        this.canJump = false;

        // --- WEAPON SYSTEM ---
        this.raycaster = new THREE.Raycaster();
        this.weapons = [];
        this.currentWeaponIndex = 0;
        this.recoilOffset = 0; 
        
        // --- NEW: SCOPE SYSTEM ---
        this.baseFov = 75;
        // The zoom levels: [1x (Hipfire), 4x, 6x, 8x]
        this.zoomLevels = [this.baseFov, this.baseFov / 4, this.baseFov / 6, this.baseFov / 8];
        this.currentZoomIndex = 0; 

        this.buildWeapons();
        this.initEventListeners();
    }

    buildWeapons() {
        const gunMatDark = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
        const gunMatWood = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
        const gunMatSilver = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.5 });

        // 1. THE SNIPER (Primary)
        const sniperGroup = new THREE.Group();
        const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.5), gunMatDark); barrel.position.set(0, 0.1, -0.6);
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.8), gunMatWood); stock.position.set(0, 0, 0.4);
        const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.4, 8), gunMatDark); scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.25, 0);
        sniperGroup.add(barrel, stock, scope);
        
        // 2. THE DESERT EAGLE (Secondary)
        const deagleGroup = new THREE.Group();
        const slide = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 0.6), gunMatSilver); slide.position.set(0, 0.2, -0.2);
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.2), gunMatDark); grip.rotation.x = 0.3; grip.position.set(0, -0.05, 0);
        deagleGroup.add(slide, grip);

        sniperGroup.stats = { damage: 100, fireRate: 1.5, recoil: 0.4, name: 'Sniper' };
        deagleGroup.stats = { damage: 35, fireRate: 0.3, recoil: 0.15, name: 'Deagle' };

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
            
            if (e.button === 0) {
                // LEFT CLICK = Shoot
                this.shoot();
            } else if (e.button === 2) {
                // RIGHT CLICK = Toggle Scope!
                this.toggleScope();
            }
        });
    }

    switchWeapon(index) {
        if (this.currentWeaponIndex === index) return;
        
        // If we switch away from the Sniper, forcefully un-zoom!
        if (this.currentZoomIndex > 0) {
            this.currentZoomIndex = 0;
            this.applyZoom();
        }

        this.weapons.forEach((w, i) => w.visible = (i === index));
        this.currentWeaponIndex = index;
    }

    // --- NEW: THE ZOOM LOGIC ---
    toggleScope() {
        // Only the Sniper Rifle (Index 0) has a scope!
        if (this.currentWeaponIndex !== 0) return;

        // Cycle through the zoom array: 0 -> 1 -> 2 -> 3 -> 0...
        this.currentZoomIndex++;
        if (this.currentZoomIndex >= this.zoomLevels.length) {
            this.currentZoomIndex = 0; 
        }

        this.applyZoom();
    }

    applyZoom() {
        // 1. Change the Camera Lens (FOV)
        this.camera.fov = this.zoomLevels[this.currentZoomIndex];
        this.camera.updateProjectionMatrix();

        // --- NEW: DYNAMIC MOUSE SMOOTHING (SENSITIVITY) ---
        // If FOV is 75, speed is 1.0. If FOV is 18.75 (4x zoom), speed drops to 0.25!
        this.controls.pointerSpeed = this.camera.fov / this.baseFov;

        if (this.currentZoomIndex === 0) {
            // UNZOOMED (Hipfire)
            this.crosshair.style.display = 'block';
            this.scopeOverlay.style.display = 'none';
            this.weapons[0].visible = true; // Show the 3D gun model again
        } else {
            // ZOOMED IN
            this.crosshair.style.display = 'none';
            this.scopeOverlay.style.display = 'block';
            this.weapons[0].visible = false; // Hide the 3D gun so it doesn't block the screen
        }
    }

    shoot() {
        if (!this.canShoot) return;
        const currentWeapon = this.weapons[this.currentWeaponIndex];
        
        this.recoilOffset = currentWeapon.stats.recoil;
        this.canShoot = false;
        setTimeout(() => this.canShoot = true, currentWeapon.stats.fireRate * 1000);

        this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        const intersects = this.raycaster.intersectObjects(this.scene.children, true);

        for (let i = 0; i < intersects.length; i++) {
            const hitObject = intersects[i].object;
            if (hitObject.animalRef) {
                hitObject.animalRef.takeDamage(currentWeapon.stats.damage);
                break; 
            }
        }
    }

    update(delta) {
        if (!this.controls.isLocked) return;

        if (this.recoilOffset > 0) {
            this.recoilOffset -= delta * 2;
            if (this.recoilOffset < 0) this.recoilOffset = 0;
        }
        
        // Only apply recoil rotation if the gun is actually visible (not scoped in)
        const activeWeapon = this.weapons[this.currentWeaponIndex];
        if (activeWeapon.visible) {
            activeWeapon.rotation.x = this.recoilOffset;
        }
        
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