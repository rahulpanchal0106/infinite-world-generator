import * as THREE from 'three';

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