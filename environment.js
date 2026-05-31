import * as THREE from 'three';

// 1. UPDATED: Richer, Fiery colors for the Minecraft-style horizon glow!
function getSkyColorAtTime(time, targetColor) {
    const dawn = new THREE.Color(0xff5500); // Fiery Sunrise Orange
    const noon = new THREE.Color(0x87CEEB); // Sky Blue
    const twilight = new THREE.Color(0xff2200); // Deep Sunset Red
    const night = new THREE.Color(0x0a0f18); // Dark Navy

    if (time < 5) targetColor.copy(night);
    // 5 AM to 7 AM: Night -> Dawn -> Noon
    else if (time < 6) targetColor.lerpColors(night, dawn, (time - 5)); 
    else if (time < 8) targetColor.lerpColors(dawn, noon, (time - 6) / 2); 
    else if (time < 16) targetColor.copy(noon);
    // 4 PM to 7 PM: Noon -> Twilight -> Night
    else if (time < 18) targetColor.lerpColors(noon, twilight, (time - 16) / 2); 
    else if (time < 19) targetColor.lerpColors(twilight, night, (time - 18)); 
    else targetColor.copy(night);
}

class DynamicEnvironment {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.time = options.initialTime || 8; 
        this.dayDurationSeconds = options.dayDurationSeconds || 90; 
        this.cloudSpeed = options.cloudSpeed || 15;

        this.lights = { ambient: null, mainLight: null };
        this.skyMesh = null;
        this.clouds = [];

        this._initLights();
        this._initSky();
        this._initFluffyClouds();
    }

    _initLights() {
        this.lights.ambient = new THREE.AmbientLight(0xffffff, 0.4); 
        this.scene.add(this.lights.ambient);

        this.lights.mainLight = new THREE.DirectionalLight(0xffdfbb, 1.5);
        this.lights.mainLight.castShadow = true; 
        this.lights.mainLight.shadow.mapSize.width = 2048;
        this.lights.mainLight.shadow.mapSize.height = 2048;
        this.lights.mainLight.shadow.camera.near = 0.1;
        this.lights.mainLight.shadow.camera.far = 4000;
        
        const d = 1500; 
        this.lights.mainLight.shadow.camera.left = -d;
        this.lights.mainLight.shadow.camera.right = d;
        this.lights.mainLight.shadow.camera.top = d;
        this.lights.mainLight.shadow.camera.bottom = -d;
        this.lights.mainLight.shadow.bias = -0.001; 

        this.scene.add(this.lights.mainLight);
    }

    _initSky() {
        const geometry = new THREE.SphereGeometry(4000, 32, 32); 
        const material = new THREE.MeshBasicMaterial({ color: 0x87CEEB, side: THREE.BackSide });
        this.skyMesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.skyMesh);

        const starsGeometry = new THREE.BufferGeometry();
        const starsCount = 2000;
        const posArray = new Float32Array(starsCount * 3);
        
        for(let i = 0; i < starsCount * 3; i += 3) {
            const radius = 3500 + Math.random() * 400; 
            const theta = 2 * Math.PI * Math.random();
            const phi = Math.acos(Math.random()); 
            
            posArray[i] = radius * Math.sin(phi) * Math.cos(theta); 
            posArray[i+1] = radius * Math.cos(phi);                 
            posArray[i+2] = radius * Math.sin(phi) * Math.sin(theta); 
        }
        starsGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        
        this.starsMaterial = new THREE.PointsMaterial({ size: 6, color: 0xffffff, transparent: true, opacity: 0, fog: false });
        this.starsMesh = new THREE.Points(starsGeometry, this.starsMaterial);
        this.scene.add(this.starsMesh);

        const sunGeo = new THREE.IcosahedronGeometry(150, 3);
        const sunMat = new THREE.MeshBasicMaterial({ color: 0xffffee, fog: false });
        this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
        this.scene.add(this.sunMesh);

        const moonGeo = new THREE.IcosahedronGeometry(80, 2);
        const moonMat = new THREE.MeshBasicMaterial({ color: 0xc4d1ff, fog: false });
        this.moonMesh = new THREE.Mesh(moonGeo, moonMat);
        this.scene.add(this.moonMesh);
    }

    _initFluffyClouds() {
        const cloudCount = 50; // Increased count since some will be small
        const puffGeo = new THREE.IcosahedronGeometry(1, 3); 
        const puffMat = new THREE.MeshStandardMaterial({ 
            color: 0xffffff, 
            roughness: 1.0, 
            flatShading: false 
        });

        for (let i = 0; i < cloudCount; i++) {
            const cloudGroup = new THREE.Group();
            
            // 1. ROLL FOR CLOUD TYPE
            const cloudType = Math.random();
            let puffCount, scaleMultiplier, spread;

            if (cloudType < 0.15) {
                // 15% Chance: MASSIVE Cumulonimbus
                puffCount = 12 + Math.floor(Math.random() * 8);
                scaleMultiplier = 2.5; 
                spread = 300;
            } else if (cloudType < 0.65) {
                // 50% Chance: Standard Fluffy Cumulus
                puffCount = 5 + Math.floor(Math.random() * 5);
                scaleMultiplier = 1.0;
                spread = 120;
            } else {
                // 35% Chance: Small Wispy Clouds
                puffCount = 3 + Math.floor(Math.random() * 2);
                scaleMultiplier = 0.5;
                spread = 60;
            }

            // 2. BUILD THE CLOUD
            for(let j = 0; j < puffCount; j++) {
                const puff = new THREE.Mesh(puffGeo, puffMat);
                
                // Base size multiplied by our archetype scale
                const size = (35 + Math.random() * 45) * scaleMultiplier;
                puff.scale.set(size, size * 0.6, size); // Squash Y for flat bottoms
                
                puff.position.set(
                    (Math.random() - 0.5) * spread,
                    Math.random() * (40 * scaleMultiplier), // Taller clouds get higher puffs
                    (Math.random() - 0.5) * spread
                );
                
                puff.castShadow = true;
                puff.receiveShadow = true;
                cloudGroup.add(puff);
            }

            // 3. RANDOMIZE ALTITUDE (250 to 900 units high!)
            const altitude = 450 + Math.pow(Math.random(), 2) * 750; // Math.pow pushes more clouds lower, a few very high

            cloudGroup.position.set(
                Math.random() * 6000 - 3000, 
                altitude, 
                Math.random() * 6000 - 3000
            );
            
            this.clouds.push(cloudGroup);
            this.scene.add(cloudGroup);
        }
    }
    update(deltaTime, playerPosition) {
        this.time += (deltaTime / this.dayDurationSeconds) * 24;
        this.time %= 24; 

        // Update Sky & Fog
        const currentSkyColor = new THREE.Color();
        getSkyColorAtTime(this.time, currentSkyColor);
        this.skyMesh.material.color.copy(currentSkyColor);
        if (this.scene.fog) this.scene.fog.color.copy(currentSkyColor);

        if (playerPosition) {
            this.skyMesh.position.copy(playerPosition);
            this.starsMesh.position.copy(playerPosition);
        }

        const px = playerPosition ? playerPosition.x : 0;
        const pz = playerPosition ? playerPosition.z : 0;
        
        const lightAngle = (this.time / 24) * Math.PI * 2 - Math.PI / 2; 
        const orbitDistance = 2500; 
        this.sunMesh.position.set(px + Math.cos(lightAngle) * orbitDistance, Math.sin(lightAngle) * orbitDistance, pz);
        
        const moonAngle = lightAngle + Math.PI;
        this.moonMesh.position.set(px + Math.cos(moonAngle) * orbitDistance, Math.sin(moonAngle) * orbitDistance, pz);

        // --- 2. UPDATED: SMOOTH LIGHTING TRANSITIONS ---
        let dirIntensity = 0;
        let ambIntensity = 0.05;
        let lightColor = new THREE.Color();

        if (this.time >= 6 && this.time < 18) {
            // DAYTIME LOGIC
            this.lights.mainLight.position.copy(this.sunMesh.position);
            
            if (this.time < 7) {
                // Sunrise: Fade sun IN (6 AM to 7 AM)
                const t = this.time - 6; 
                dirIntensity = THREE.MathUtils.lerp(0, 1.5, t);
                ambIntensity = THREE.MathUtils.lerp(0.05, 0.4, t);
                lightColor.lerpColors(new THREE.Color(0xff5500), new THREE.Color(0xffdfbb), t);
                this.starsMaterial.opacity = THREE.MathUtils.lerp(1, 0, t);
            } else if (this.time > 17) {
                // Sunset: Fade sun OUT (5 PM to 6 PM)
                const t = this.time - 17; 
                dirIntensity = THREE.MathUtils.lerp(1.5, 0, t);
                ambIntensity = THREE.MathUtils.lerp(0.4, 0.05, t);
                lightColor.lerpColors(new THREE.Color(0xffdfbb), new THREE.Color(0xff5500), t);
                this.starsMaterial.opacity = THREE.MathUtils.lerp(0, 1, t);
            } else {
                // High Noon
                dirIntensity = 1.5;
                ambIntensity = 0.4;
                lightColor.set(0xffdfbb);
                this.starsMaterial.opacity = 0;
            }
        } else {
            // NIGHTTIME LOGIC
            this.lights.mainLight.position.copy(this.moonMesh.position);
            
            if (this.time >= 18 && this.time < 19) {
                // Dusk: Fade moon IN (6 PM to 7 PM)
                const t = this.time - 18; 
                dirIntensity = THREE.MathUtils.lerp(0, 0.15, t);
                lightColor.set(0x8a9bff);
                this.starsMaterial.opacity = 1;
            } else if (this.time >= 5 && this.time < 6) {
                // Dawn: Fade moon OUT (5 AM to 6 AM)
                const t = this.time - 5; 
                dirIntensity = THREE.MathUtils.lerp(0.15, 0, t);
                lightColor.set(0x8a9bff);
                this.starsMaterial.opacity = 1;
            } else {
                // Midnight
                dirIntensity = 0.15;
                lightColor.set(0x8a9bff);
                this.starsMaterial.opacity = 1;
            }
        }

        // Apply smooth lighting changes
        this.lights.mainLight.intensity = dirIntensity;
        this.lights.ambient.intensity = ambIntensity;
        this.lights.mainLight.color.copy(lightColor);

        // Only cast shadows when the light is bright enough (prevents weird cloud dots)
        this.lights.mainLight.castShadow = dirIntensity > 0.2;

        // Move Clouds
        this.clouds.forEach((cloud, index) => {
            cloud.position.x += this.cloudSpeed * deltaTime * (1 + index * 0.1); 
            if (cloud.position.x > px + 3000) cloud.position.x = px - 3000; 
        });
    }
}

export default DynamicEnvironment;