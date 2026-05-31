import * as THREE from 'three';

// Richer, Fiery colors for the Minecraft-style horizon glow
function getSkyColorAtTime(time, targetColor) {
    const dawn = new THREE.Color(0xff5500); 
    const noon = new THREE.Color(0x87CEEB); 
    const twilight = new THREE.Color(0xff2200); 
    const night = new THREE.Color(0x0a0f18); 

    if (time < 5) targetColor.copy(night);
    else if (time < 6) targetColor.lerpColors(night, dawn, (time - 5)); 
    else if (time < 8) targetColor.lerpColors(dawn, noon, (time - 6) / 2); 
    else if (time < 16) targetColor.copy(noon);
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
        const cloudCount = 50; 
        const puffGeo = new THREE.IcosahedronGeometry(1, 3); 
        const puffMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, flatShading: false });

        for (let i = 0; i < cloudCount; i++) {
            const cloudGroup = new THREE.Group();
            const cloudType = Math.random();
            let puffCount, scaleMultiplier, spread;

            if (cloudType < 0.15) {
                puffCount = 12 + Math.floor(Math.random() * 8);
                scaleMultiplier = 2.5; 
                spread = 300;
            } else if (cloudType < 0.65) {
                puffCount = 5 + Math.floor(Math.random() * 5);
                scaleMultiplier = 1.0;
                spread = 120;
            } else {
                puffCount = 3 + Math.floor(Math.random() * 2);
                scaleMultiplier = 0.5;
                spread = 60;
            }

            for(let j = 0; j < puffCount; j++) {
                const puff = new THREE.Mesh(puffGeo, puffMat);
                const size = (35 + Math.random() * 45) * scaleMultiplier;
                puff.scale.set(size, size * 0.6, size); 
                puff.position.set(
                    (Math.random() - 0.5) * spread,
                    Math.random() * (40 * scaleMultiplier), 
                    (Math.random() - 0.5) * spread
                );
                puff.castShadow = true;
                puff.receiveShadow = true;
                cloudGroup.add(puff);
            }

            const altitude = 250 + Math.pow(Math.random(), 2) * 650; 
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

        // Update Sky & Fog Color
        const currentSkyColor = new THREE.Color();
        getSkyColorAtTime(this.time, currentSkyColor);
        this.skyMesh.material.color.copy(currentSkyColor);
        if (this.scene.fog) this.scene.fog.color.copy(currentSkyColor);

        // Lock Sky and Stars to player
        if (playerPosition) {
            this.skyMesh.position.copy(playerPosition);
            this.starsMesh.position.copy(playerPosition);
        }

        const px = playerPosition ? playerPosition.x : 0;
        const pz = playerPosition ? playerPosition.z : 0;
        
        // Orbit Math
        const lightAngle = (this.time / 24) * Math.PI * 2 - Math.PI / 2; 
        const orbitDistance = 2500; 
        this.sunMesh.position.set(px + Math.cos(lightAngle) * orbitDistance, Math.sin(lightAngle) * orbitDistance, pz);
        const moonAngle = lightAngle + Math.PI;
        this.moonMesh.position.set(px + Math.cos(moonAngle) * orbitDistance, Math.sin(moonAngle) * orbitDistance, pz);

        // Lighting Transitions
        let dirIntensity = 0;
        let ambIntensity = 0.05;
        let lightColor = new THREE.Color();

        if (this.time >= 6 && this.time < 18) {
            this.lights.mainLight.position.copy(this.sunMesh.position);
            if (this.time < 7) {
                const t = this.time - 6; 
                dirIntensity = THREE.MathUtils.lerp(0, 1.5, t);
                ambIntensity = THREE.MathUtils.lerp(0.05, 0.4, t);
                lightColor.lerpColors(new THREE.Color(0xff5500), new THREE.Color(0xffdfbb), t);
                this.starsMaterial.opacity = THREE.MathUtils.lerp(1, 0, t);
            } else if (this.time > 17) {
                const t = this.time - 17; 
                dirIntensity = THREE.MathUtils.lerp(1.5, 0, t);
                ambIntensity = THREE.MathUtils.lerp(0.4, 0.05, t);
                lightColor.lerpColors(new THREE.Color(0xffdfbb), new THREE.Color(0xff5500), t);
                this.starsMaterial.opacity = THREE.MathUtils.lerp(0, 1, t);
            } else {
                dirIntensity = 1.5;
                ambIntensity = 0.4;
                lightColor.set(0xffdfbb);
                this.starsMaterial.opacity = 0;
            }
        } else {
            this.lights.mainLight.position.copy(this.moonMesh.position);
            if (this.time >= 18 && this.time < 19) {
                const t = this.time - 18; 
                dirIntensity = THREE.MathUtils.lerp(0, 0.15, t);
                lightColor.set(0x8a9bff);
                this.starsMaterial.opacity = 1;
            } else if (this.time >= 5 && this.time < 6) {
                const t = this.time - 5; 
                dirIntensity = THREE.MathUtils.lerp(0.15, 0, t);
                lightColor.set(0x8a9bff);
                this.starsMaterial.opacity = 1;
            } else {
                dirIntensity = 0.15;
                lightColor.set(0x8a9bff);
                this.starsMaterial.opacity = 1;
            }
        }

        this.lights.mainLight.intensity = dirIntensity;
        this.lights.ambient.intensity = ambIntensity;
        this.lights.mainLight.color.copy(lightColor);
        this.lights.mainLight.castShadow = dirIntensity > 0.2;

        // --- NEW: OMNI-DIRECTIONAL CLOUD TREADMILL ---
        const cloudBoundary = 3000; // Half of our 6000 unit box

        this.clouds.forEach((cloud, index) => {
            // 1. Move cloud with the wind
            cloud.position.x += this.cloudSpeed * deltaTime * (1 + index * 0.1); 

            // 2. X-Axis Wrap (Handles wind AND player walking East/West)
            if (cloud.position.x > px + cloudBoundary) {
                cloud.position.x -= (cloudBoundary * 2);
            } else if (cloud.position.x < px - cloudBoundary) {
                cloud.position.x += (cloudBoundary * 2);
            }

            // 3. Z-Axis Wrap (Handles player walking North/South)
            if (cloud.position.z > pz + cloudBoundary) {
                cloud.position.z -= (cloudBoundary * 2);
            } else if (cloud.position.z < pz - cloudBoundary) {
                cloud.position.z += (cloudBoundary * 2);
            }
        });
    }
}

export default DynamicEnvironment;