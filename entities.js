import * as THREE from 'three';

export class Animal {
    constructor(type, x, y, z, scene) {
        this.type = type;
        this.scene = scene;
        this.mesh = new THREE.Group();
        this.mesh.position.set(x, y, z);
        
        // AI State
        this.target = new THREE.Vector3(x, y, z);
        this.speed = type === 'deer' ? 8 : (type === 'camel' ? 5 : 6);
        this.state = 'idle'; 
        this.timer = Math.random() * 5;

        // Animation State
        this.legs = [];
        this.walkCycle = 0;

        this.buildModel();
        this.scene.add(this.mesh);
    }

    buildModel() {
        const deerMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, flatShading: true });
        const camelMat = new THREE.MeshStandardMaterial({ color: 0xd2b48c, flatShading: true });
        const bearMat = new THREE.MeshStandardMaterial({ color: 0xfffafa, flatShading: true });
        const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222, flatShading: true });

        const addPart = (geo, mat, px, py, pz) => {
            const part = new THREE.Mesh(geo, mat);
            part.position.set(px, py, pz);
            part.castShadow = true;
            part.receiveShadow = true;
            this.mesh.add(part);
        };

        // Helper to add legs with a specific pivot point so they swing from the shoulder!
        const addLeg = (width, height, depth, mat, px, py, pz) => {
            const geo = new THREE.BoxGeometry(width, height, depth);
            geo.translate(0, -height / 2, 0); // Move the pivot point to the very top of the leg
            const leg = new THREE.Mesh(geo, mat);
            leg.position.set(px, py, pz);
            leg.castShadow = true;
            leg.receiveShadow = true;
            this.mesh.add(leg);
            this.legs.push(leg); // Save reference for animation
        };

        if (this.type === 'deer') {
            // Legs (Front-Left, Front-Right, Back-Left, Back-Right)
            addLeg(0.4, 2.5, 0.4, darkMat, -0.5, 2.5, 1.0);
            addLeg(0.4, 2.5, 0.4, darkMat, 0.5, 2.5, 1.0);
            addLeg(0.4, 2.5, 0.4, darkMat, -0.5, 2.5, -1.0);
            addLeg(0.4, 2.5, 0.4, darkMat, 0.5, 2.5, -1.0);

            // Body, Neck, Head (Shifted up to fit legs)
            addPart(new THREE.BoxGeometry(1.5, 1.5, 3), deerMat, 0, 3, 0); 
            addPart(new THREE.BoxGeometry(0.8, 2, 0.8), deerMat, 0, 4.5, 1.2); 
            addPart(new THREE.BoxGeometry(1, 1, 1.5), deerMat, 0, 5.2, 1.8); 
            
            // Antlers
            addPart(new THREE.BoxGeometry(0.2, 1.5, 0.2), darkMat, -0.4, 6.0, 1.5);
            addPart(new THREE.BoxGeometry(0.2, 1.5, 0.2), darkMat, 0.4, 6.0, 1.5);
        } 
        else if (this.type === 'camel') {
            addLeg(0.6, 3.5, 0.6, camelMat, -0.7, 3.5, 1.5);
            addLeg(0.6, 3.5, 0.6, camelMat, 0.7, 3.5, 1.5);
            addLeg(0.6, 3.5, 0.6, camelMat, -0.7, 3.5, -1.5);
            addLeg(0.6, 3.5, 0.6, camelMat, 0.7, 3.5, -1.5);

            addPart(new THREE.BoxGeometry(2, 2, 4), camelMat, 0, 4.5, 0);
            addPart(new THREE.BoxGeometry(1.5, 1.5, 1.5), camelMat, 0, 6.0, -0.5); 
            addPart(new THREE.BoxGeometry(1, 2.5, 1), camelMat, 0, 6.0, 2); 
            addPart(new THREE.BoxGeometry(1.2, 1.2, 2), camelMat, 0, 7.0, 2.5); 
        } 
        else if (this.type === 'bear') {
            addLeg(0.8, 2, 0.8, bearMat, -0.8, 2, 1.5);
            addLeg(0.8, 2, 0.8, bearMat, 0.8, 2, 1.5);
            addLeg(0.8, 2, 0.8, bearMat, -0.8, 2, -1.5);
            addLeg(0.8, 2, 0.8, bearMat, 0.8, 2, -1.5);

            addPart(new THREE.BoxGeometry(2.5, 2, 4.5), bearMat, 0, 3, 0);
            addPart(new THREE.BoxGeometry(1.8, 1.5, 2), bearMat, 0, 3.5, 2.8);
            addPart(new THREE.BoxGeometry(0.5, 0.4, 0.2), darkMat, 0, 3.5, 3.9);
        }
    }

    update(delta, getTerrainHeight) {
        this.timer -= delta;

        // 1. AI Logic
        if (this.timer <= 0) {
            if (this.state === 'idle') {
                this.state = 'wandering';
                this.timer = 2 + Math.random() * 4; 
                const angle = Math.random() * Math.PI * 2;
                const distance = 10 + Math.random() * 20;
                this.target.set(
                    this.mesh.position.x + Math.cos(angle) * distance,
                    0,
                    this.mesh.position.z + Math.sin(angle) * distance
                );
            } else {
                this.state = 'idle';
                this.timer = 1 + Math.random() * 4; 
            }
        }

        // 2. Movement & Animation Logic
        let isMoving = false;
        
        if (this.state === 'wandering') {
            const dx = this.target.x - this.mesh.position.x;
            const dz = this.target.z - this.mesh.position.z;
            const dist = Math.sqrt(dx*dx + dz*dz);
            
            if (dist > 1) {
                isMoving = true;
                this.mesh.position.x += (dx / dist) * this.speed * delta;
                this.mesh.position.z += (dz / dist) * this.speed * delta;
                
                const targetRotation = Math.atan2(dx, dz);
                this.mesh.rotation.y += (targetRotation - this.mesh.rotation.y) * 5 * delta;
                
                // ANIMATION: Walk Cycle Sine Wave
                this.walkCycle += delta * this.speed * 1.5;
                const swing = Math.sin(this.walkCycle) * 0.6; // 0.6 is how high they kick their legs
                
                // Alternate the legs like a real animal
                this.legs[0].rotation.x = swing;   // Front Left
                this.legs[1].rotation.x = -swing;  // Front Right
                this.legs[2].rotation.x = -swing;  // Back Left
                this.legs[3].rotation.x = swing;   // Back Right
            }
        }

        // Stop animating if they reached their target or are eating
        if (!isMoving) {
            this.walkCycle = 0;
            this.legs.forEach(leg => {
                // Smoothly snap legs back to standing position (0 rotation)
                leg.rotation.x += (0 - leg.rotation.x) * 10 * delta;
            });
        }

        // 3. Terrain Snapping
        const groundY = getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
        this.mesh.position.y = groundY;
    }

    dispose() {
        this.scene.remove(this.mesh);
        this.mesh.children.forEach(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
    }
}