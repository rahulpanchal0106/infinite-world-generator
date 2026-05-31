import * as THREE from 'three';

function getSkyColorAtTime(time, targetColor) {
    const dawn = new THREE.Color(0xffcf7a); 
    const noon = new THREE.Color(0x87CEEB); 
    const twilight = new THREE.Color(0x3e4a5d); 
    const night = new THREE.Color(0x0a0f18); // Darker night for stars to pop

    if (time < 6) targetColor.lerpColors(night, dawn, time / 6);
    else if (time < 12) targetColor.lerpColors(dawn, noon, (time - 6) / 6);
    else if (time < 18) targetColor.lerpColors(noon, twilight, (time - 12) / 6);
    else targetColor.lerpColors(twilight, night, (time - 18) / 6);
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

        // Renamed from directionalSun to mainLight, as it acts as both sun and moon
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
        // 1. Base Sky Sphere
        const geometry = new THREE.SphereGeometry(4000, 32, 32); 
        const material = new THREE.MeshBasicMaterial({ color: 0x87CEEB, side: THREE.BackSide });
        this.skyMesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.skyMesh);

        // 2. Performant Stars (Particle System)
        const starsGeometry = new THREE.BufferGeometry();
        const starsCount = 2000;
        const posArray = new Float32Array(starsCount * 3);
        
        for(let i = 0; i < starsCount * 3; i += 3) {
            // Distribute stars randomly on the upper dome
            const radius = 3500 + Math.random() * 400; // Far out, just inside the skybox
            const theta = 2 * Math.PI * Math.random();
            const phi = Math.acos(Math.random()); // Only upper hemisphere
            
            posArray[i] = radius * Math.sin(phi) * Math.cos(theta); // x
            posArray[i+1] = radius * Math.cos(phi);                 // y
            posArray[i+2] = radius * Math.sin(phi) * Math.sin(theta); // z
        }
        starsGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        
        // fog: false keeps them crisp even if fog is dense
        this.starsMaterial = new THREE.PointsMaterial({ size: 6, color: 0xffffff, transparent: true, opacity: 0, fog: false });
        this.starsMesh = new THREE.Points(starsGeometry, this.starsMaterial);
        this.scene.add(this.starsMesh);

        // 3. Celestial Bodies (Sun and Moon)
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
        const cloudCount = 35;
        const puffGeo = new THREE.IcosahedronGeometry(1, 3); 
        const puffMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, flatShading: false });

        for (let i = 0; i < cloudCount; i++) {
            const cloudGroup = new THREE.Group();
            const puffCount = 5 + Math.floor(Math.random() * 5); 

            for(let j=0; j<puffCount; j++) {
                const puff = new THREE.Mesh(puffGeo, puffMat);
                const size = 40 + Math.random() * 50;
                puff.scale.set(size, size * 0.7, size); 
                puff.position.set((Math.random() - 0.5) * 120, Math.random() * 40, (Math.random() - 0.5) * 120);
                puff.castShadow = true;
                puff.receiveShadow = true;
                cloudGroup.add(puff);
            }

            cloudGroup.position.set(Math.random() * 6000 - 3000, 400 + Math.random() * 150, Math.random() * 6000 - 3000);
            this.clouds.push(cloudGroup);
            this.scene.add(cloudGroup);
        }
    }

    // NEW: We now accept playerPosition so the stars/sun/moon follow the player infinitely
    update(deltaTime, playerPosition) {
        this.time += (deltaTime / this.dayDurationSeconds) * 24;
        this.time %= 24; 

        // Update Sky & Fog Color
        const currentSkyColor = new THREE.Color();
        getSkyColorAtTime(this.time, currentSkyColor);
        this.skyMesh.material.color.copy(currentSkyColor);
        if (this.scene.fog) this.scene.fog.color.copy(currentSkyColor);

        // Lock Sky and Stars to player so you can never walk past them
        if (playerPosition) {
            this.skyMesh.position.copy(playerPosition);
            this.starsMesh.position.copy(playerPosition);
        }

        // Orbit Math
        const lightAngle = (this.time / 24) * Math.PI * 2 - Math.PI / 2; 
        const orbitDistance = 2500; 

        const px = playerPosition ? playerPosition.x : 0;
        const pz = playerPosition ? playerPosition.z : 0;

        // Position Sun
        this.sunMesh.position.set(px + Math.cos(lightAngle) * orbitDistance, Math.sin(lightAngle) * orbitDistance, pz);
        
        // Position Moon (exactly opposite the sun)
        const moonAngle = lightAngle + Math.PI;
        this.moonMesh.position.set(px + Math.cos(moonAngle) * orbitDistance, Math.sin(moonAngle) * orbitDistance, pz);

        // LIGHTING & SHADOW FIXES
        const isDay = this.time > 6 && this.time < 18;

        if (isDay) {
            this.lights.mainLight.position.copy(this.sunMesh.position);
            this.lights.mainLight.intensity = 1.5;
            this.lights.mainLight.color.set(0xffdfbb);
            this.lights.ambient.intensity = 0.4;
            // Fade stars out
            this.starsMaterial.opacity = Math.max(0, this.starsMaterial.opacity - deltaTime * 0.5);
        } else {
            // At night, the main light snaps to the Moon!
            this.lights.mainLight.position.copy(this.moonMesh.position);
            this.lights.mainLight.intensity = 0.15;
            this.lights.mainLight.color.set(0x8a9bff);
            this.lights.ambient.intensity = 0.05;
            // Fade stars in
            this.starsMaterial.opacity = Math.min(1, this.starsMaterial.opacity + deltaTime * 0.5);
        }

        // CRITICAL FIX: Disable shadows if the light source is too low to the horizon
        // This stops shadows from projecting upwards onto the clouds!
        if (this.lights.mainLight.position.y < 200) {
            this.lights.mainLight.castShadow = false;
        } else {
            this.lights.mainLight.castShadow = true;
        }

        // Drift Clouds
        this.clouds.forEach((cloud, index) => {
            cloud.position.x += this.cloudSpeed * deltaTime * (1 + index * 0.1); 
            if (cloud.position.x > px + 3000) cloud.position.x = px - 3000; 
        });
    }
}

export default DynamicEnvironment;