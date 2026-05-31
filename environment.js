import * as THREE from 'three';

function getSkyColorAtTime(time, targetColor) {
    const dawn = new THREE.Color(0xffcf7a); 
    const noon = new THREE.Color(0x87CEEB); 
    const twilight = new THREE.Color(0x3e4a5d); 
    const night = new THREE.Color(0x131821); 

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

        this.lights = { ambient: null, directionalSun: null };
        this.skyMesh = null;
        this.clouds = [];

        this._initLights();
        this._initSky();
        this._initFluffyClouds();
    }

    _initLights() {
        this.lights.ambient = new THREE.AmbientLight(0xffffff, 0.4); 
        this.scene.add(this.lights.ambient);

        this.lights.directionalSun = new THREE.DirectionalLight(0xffdfbb, 1.5);
        this.lights.directionalSun.castShadow = true; 
        this.lights.directionalSun.shadow.mapSize.width = 2048;
        this.lights.directionalSun.shadow.mapSize.height = 2048;
        this.lights.directionalSun.shadow.camera.near = 0.1;
        this.lights.directionalSun.shadow.camera.far = 4000;
        
        const d = 1500; // Expanded to cover the new massive view distance
        this.lights.directionalSun.shadow.camera.left = -d;
        this.lights.directionalSun.shadow.camera.right = d;
        this.lights.directionalSun.shadow.camera.top = d;
        this.lights.directionalSun.shadow.camera.bottom = -d;
        this.lights.directionalSun.shadow.bias = -0.001; 

        this.scene.add(this.lights.directionalSun);
    }

    _initSky() {
        const geometry = new THREE.SphereGeometry(4000, 32, 32); // Massive sky sphere
        const material = new THREE.MeshBasicMaterial({ color: 0x87CEEB, side: THREE.BackSide });
        this.skyMesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.skyMesh);
    }

    _initFluffyClouds() {
        const cloudCount = 35;
        // High-res spheres for smooth clouds
        const puffGeo = new THREE.IcosahedronGeometry(1, 3); 
        // Solid, opaque white material
        const puffMat = new THREE.MeshStandardMaterial({ 
            color: 0xffffff, 
            roughness: 1.0,
            flatShading: false 
        });

        for (let i = 0; i < cloudCount; i++) {
            const cloudGroup = new THREE.Group();
            const puffCount = 5 + Math.floor(Math.random() * 5); // 5 to 9 puffs per cloud

            for(let j=0; j<puffCount; j++) {
                const puff = new THREE.Mesh(puffGeo, puffMat);
                const size = 40 + Math.random() * 50;
                // Squash them slightly on the Y axis
                puff.scale.set(size, size * 0.7, size); 
                
                // Keep the Y position mostly positive so the bottom of the cloud stays flat
                puff.position.set(
                    (Math.random() - 0.5) * 120,
                    Math.random() * 40, 
                    (Math.random() - 0.5) * 120
                );
                
                puff.castShadow = true;
                puff.receiveShadow = true;
                cloudGroup.add(puff);
            }

            // Scatter clouds across a massive 6000 unit area, high in the sky
            cloudGroup.position.set(
                Math.random() * 6000 - 3000, 
                400 + Math.random() * 150, 
                Math.random() * 6000 - 3000
            );
            
            this.clouds.push(cloudGroup);
            this.scene.add(cloudGroup);
        }
    }

    update(deltaTime) {
        this.time += (deltaTime / this.dayDurationSeconds) * 24;
        this.time %= 24; 

        const currentSkyColor = new THREE.Color();
        getSkyColorAtTime(this.time, currentSkyColor);
        this.skyMesh.material.color.copy(currentSkyColor);

        if (this.scene.fog) {
            this.scene.fog.color.copy(currentSkyColor);
        }

        const lightAngle = (this.time / 24) * Math.PI * 2 - Math.PI / 2; 
        const lightDistance = 2000;
        this.lights.directionalSun.position.set(
            Math.cos(lightAngle) * lightDistance,
            Math.sin(lightAngle) * lightDistance,
            0 
        );

        let directionalIntensity = 1.5;
        let ambientIntensity = 0.4;
        const directionalColor = new THREE.Color(0xffffff);

        if (this.time < 6 || this.time > 18) { 
            directionalIntensity = 0.15;
            ambientIntensity = 0.05;
            directionalColor.set(0x8a9bff); 
        } else { 
            directionalIntensity = 1.5;
            ambientIntensity = 0.4;
            directionalColor.set(0xffdfbb);
        }

        this.lights.directionalSun.intensity = directionalIntensity;
        this.lights.ambient.intensity = ambientIntensity;
        this.lights.directionalSun.color.copy(directionalColor);

        this.clouds.forEach((cloud, index) => {
            cloud.position.x += this.cloudSpeed * deltaTime * (1 + index * 0.1); 
            // Wrap clouds around the massive new map
            if (cloud.position.x > 3000) cloud.position.x = -3000; 
        });
    }
}

export default DynamicEnvironment;