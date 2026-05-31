import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

export class Player {
    // NEW: We pass checkCollisionFunc into the constructor
    constructor(camera, domElement, uiElement, getTerrainHeightFunc, checkCollisionFunc) {
        this.camera = camera;
        this.getTerrainHeight = getTerrainHeightFunc;
        this.checkCollision = checkCollisionFunc; 
        
        this.controls = new PointerLockControls(camera, domElement);
        
        uiElement.addEventListener('click', () => this.controls.lock());
        this.controls.addEventListener('lock', () => uiElement.style.display = 'none');
        this.controls.addEventListener('unlock', () => uiElement.style.display = 'block');

        this.velocity = new THREE.Vector3();
        this.direction = new THREE.Vector3();
        this.moveState = { forward: false, backward: false, left: false, right: false, run: false };
        this.canJump = false;

        this.initEventListeners();
    }

    initEventListeners() {
        document.addEventListener('keydown', (e) => {
            if (e.code === 'KeyW') this.moveState.forward = true;
            if (e.code === 'KeyS') this.moveState.backward = true;
            if (e.code === 'KeyA') this.moveState.left = true;
            if (e.code === 'KeyD') this.moveState.right = true;
            if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.moveState.run = true;
            if (e.code === 'Space' && this.canJump) this.velocity.y += 25; 
        });
        document.addEventListener('keyup', (e) => {
            if (e.code === 'KeyW') this.moveState.forward = false;
            if (e.code === 'KeyS') this.moveState.backward = false;
            if (e.code === 'KeyA') this.moveState.left = false;
            if (e.code === 'KeyD') this.moveState.right = false;
            if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.moveState.run = false;
        });
    }

    update(delta) {
        if (!this.controls.isLocked) return;

        this.velocity.x -= this.velocity.x * 10.0 * delta;
        this.velocity.z -= this.velocity.z * 10.0 * delta;
        this.velocity.y -= 9.8 * 6.0 * delta; 

        this.direction.z = Number(this.moveState.forward) - Number(this.moveState.backward);
        this.direction.x = Number(this.moveState.right) - Number(this.moveState.left);
        this.direction.normalize();

        const speed = this.moveState.run ? 150.0 : 50.0;
        if (this.moveState.forward || this.moveState.backward) this.velocity.z -= this.direction.z * speed * delta;
        if (this.moveState.left || this.moveState.right) this.velocity.x -= this.direction.x * speed * delta;

        // --- NEW: COLLISION DETECTION AND SLIDING ---
        // Save where we are before we move
        const oldX = this.camera.position.x;
        const oldZ = this.camera.position.z;

        // Apply Movement
        this.controls.moveRight(-this.velocity.x * delta);
        this.controls.moveForward(-this.velocity.z * delta);

        const newX = this.camera.position.x;
        const newZ = this.camera.position.z;
        const playerRadius = 1.0;

        // If we hit something...
        if (this.checkCollision(newX, newZ, playerRadius)) {
            // Check if we can slide along the Z axis (undo X)
            if (!this.checkCollision(oldX, newZ, playerRadius)) {
                this.camera.position.x = oldX; 
            }
            // Check if we can slide along the X axis (undo Z)
            else if (!this.checkCollision(newX, oldZ, playerRadius)) {
                this.camera.position.z = oldZ; 
            }
            // Cornered! Undo everything
            else {
                this.camera.position.x = oldX;
                this.camera.position.z = oldZ;
            }
        }

        // Apply Gravity / Terrain Height Snapping
        this.camera.position.y += this.velocity.y * delta;
        const playerHeight = 3.0; 
        const groundHeight = this.getTerrainHeight(this.camera.position.x, this.camera.position.z);
        
        if (this.camera.position.y < groundHeight + playerHeight) {
            this.velocity.y = 0; 
            this.camera.position.y = groundHeight + playerHeight; 
            this.canJump = true; 
        } else {
            this.canJump = false; 
        }
    }
}