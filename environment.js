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

        this._initLights();
        this._initSky();
        this._initCloudBillboards();
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
        this.skyMesh.layers.set(1);
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
        this.starsMesh.layers.set(1);
        this.scene.add(this.starsMesh);

        const sunGeo = new THREE.IcosahedronGeometry(150, 3);
        const sunMat = new THREE.MeshBasicMaterial({ color: 0xffffee, fog: false });
        this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
        this.sunMesh.layers.set(1);
        this.scene.add(this.sunMesh);

        const moonGeo = new THREE.IcosahedronGeometry(80, 2);
        const moonMat = new THREE.MeshBasicMaterial({ color: 0xc4d1ff, fog: false });
        this.moonMesh = new THREE.Mesh(moonGeo, moonMat);
        this.moonMesh.layers.set(1);
        this.scene.add(this.moonMesh);
    }

    _initCloudBillboards() {
        // --- Procedural volumetric cloud texture ---
        // Multi-octave 2D value noise baked to a 512² canvas. Each cloud puff gets
        // this texture — the overlapping, varied-opacity layers give real volume.
        const S = 512;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = S;
        const ctx = canvas.getContext('2d');

        // Tiny value-noise helper (tileable isn't needed — each puff gets random UV offset)
        const perm = new Uint8Array(512);
        for (let i = 0; i < 256; i++) perm[i] = i;
        for (let i = 255; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [perm[i], perm[j]] = [perm[j], perm[i]]; }
        for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
        const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
        const lerp = (a, b, t) => a + t * (b - a);
        const grad2 = (h, x, y) => { const u = h & 1 ? x : -x; const v = h & 2 ? y : -y; return u + v; };
        const noise2 = (x, y) => {
            const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
            const xf = x - Math.floor(x),   yf = y - Math.floor(y);
            const u = fade(xf), v = fade(yf);
            const aa = perm[perm[xi] + yi], ab = perm[perm[xi] + yi + 1];
            const ba = perm[perm[xi + 1] + yi], bb = perm[perm[xi + 1] + yi + 1];
            return lerp(lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u),
                        lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u), v);
        };

        // FBM (fractal brownian motion) — 5 octaves for detail
        const fbm = (x, y) => {
            let val = 0, amp = 0.5, freq = 1;
            for (let o = 0; o < 5; o++) {
                val += noise2(x * freq, y * freq) * amp;
                amp *= 0.5; freq *= 2.1;
            }
            return val;
        };

        // Render the noise to the canvas
        const imgData = ctx.createImageData(S, S);
        const cx = S / 2;
        for (let py = 0; py < S; py++) {
            for (let px = 0; px < S; px++) {
                // Distance from centre (soft circular falloff)
                const dx = (px - cx) / cx, dy = (py - cx) / cx;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const mask = Math.max(0, 1 - dist * dist) ** 1.8; // smooth circle

                // FBM cloud density
                const n = fbm(px * 0.008 + 3.7, py * 0.008 + 7.1);
                const density = Math.max(0, Math.min(1, (n + 0.35) * 1.4)) * mask;

                // Slight blue-white tint variation
                const bright = 0.92 + density * 0.08;
                const r = Math.round(255 * bright);
                const g = Math.round(252 * bright);
                const b = Math.round(255 * bright);
                const a = Math.round(density * 255);

                const i = (py * S + px) * 4;
                imgData.data[i]     = r;
                imgData.data[i + 1] = g;
                imgData.data[i + 2] = b;
                imgData.data[i + 3] = a;
            }
        }
        ctx.putImageData(imgData, 0, 0);
        const tex = new THREE.CanvasTexture(canvas);

        const mat = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            depthWrite: false,
            fog: false,
        });
        const geo = new THREE.PlaneGeometry(1, 1);

        // Cloud types: massive thunderheads, medium cumulus, small wisps
        const CLOUD_TYPES = [
            { weight: 0.12, minPuffs: 18, maxPuffs: 28, spread: 350, scaleMin: 100, scaleMax: 180, vertSpread: 80 },
            { weight: 0.50, minPuffs:  8, maxPuffs: 14, spread: 160, scaleMin:  55, scaleMax:  95, vertSpread: 45 },
            { weight: 0.80, minPuffs:  4, maxPuffs:  8, spread:  90, scaleMin:  30, scaleMax:  55, vertSpread: 20 },
            { weight: 1.00, minPuffs:  2, maxPuffs:  3, spread:  40, scaleMin:  18, scaleMax:  32, vertSpread: 10 },
        ];
        const CLOUD_COUNT = 65;

        this._cloudBases = [];
        this._cloudPuffs = [];

        for (let i = 0; i < CLOUD_COUNT; i++) {
            const r = Math.random();
            const type = CLOUD_TYPES.find(t => r < t.weight);
            const puffCount = type.minPuffs + Math.floor(Math.random() * (type.maxPuffs - type.minPuffs + 1));

            this._cloudBases.push({
                x:        Math.random() * 6000 - 3000,
                z:        Math.random() * 6000 - 3000,
                altitude: 280 + Math.pow(Math.random(), 2) * 500,
                start:    this._cloudPuffs.length,
                count:    puffCount,
                speedMul: 0.7 + Math.random() * 0.6,
            });

            for (let j = 0; j < puffCount; j++) {
                const a = Math.random() * Math.PI * 2;
                // Denser towards centre, sparser at edges (gaussian-ish distribution)
                const dist = (Math.random() + Math.random()) * 0.5 * type.spread;
                const baseScale = type.scaleMin + Math.random() * (type.scaleMax - type.scaleMin);
                // Bigger puffs near the centre, smaller ones at the edges
                const edgeFade = 1 - (dist / type.spread) * 0.4;
                this._cloudPuffs.push({
                    offX:  Math.cos(a) * dist,
                    offY:  (Math.random() - 0.3) * type.vertSpread, // flat base, puff upwards
                    offZ:  Math.sin(a) * dist,
                    scale: baseScale * edgeFade,
                    opacity: 0.5 + Math.random() * 0.5, // per-puff opacity for depth illusion
                });
            }
        }

        // Use per-instance colour to modulate opacity (alpha channel)
        this.cloudMesh = new THREE.InstancedMesh(geo, mat, this._cloudPuffs.length);
        this.cloudMesh.frustumCulled = false;
        this.cloudMesh.layers.set(1);
        this.cloudMesh.renderOrder = 1;

        // Set per-instance opacity via instance colour's alpha-like trick:
        // We store the opacity in the instance colour (white * opacity) and
        // the material multiplies map colour × instance colour.
        const colour = new THREE.Color();
        for (let i = 0; i < this._cloudPuffs.length; i++) {
            const o = this._cloudPuffs[i].opacity;
            colour.setRGB(o, o, o);
            this.cloudMesh.setColorAt(i, colour);
        }
        this.cloudMesh.instanceColor.needsUpdate = true;

        this.scene.add(this.cloudMesh);
        this._cloudDummy = new THREE.Object3D();
    }

    update(deltaTime, playerPosition, camera = null) {
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

        // --- INSTANCED BILLBOARD CLOUDS (Pillar 3) ---
        // Move cloud bases with wind, wrap around the player, then set each puff's
        // instance matrix to face the camera. ONE draw call for all ~300 puffs.
        const cloudBoundary = 3000;
        const dummy = this._cloudDummy;
        const camPos = camera ? camera.position : { x: px, y: 400, z: pz };

        this._cloudBases.forEach((base) => {
            base.x += this.cloudSpeed * base.speedMul * deltaTime;
            if (base.x > px + cloudBoundary) base.x -= cloudBoundary * 2;
            else if (base.x < px - cloudBoundary) base.x += cloudBoundary * 2;
            if (base.z > pz + cloudBoundary) base.z -= cloudBoundary * 2;
            else if (base.z < pz - cloudBoundary) base.z += cloudBoundary * 2;

            for (let j = 0; j < base.count; j++) {
                const puff = this._cloudPuffs[base.start + j];
                dummy.position.set(base.x + puff.offX, base.altitude + puff.offY, base.z + puff.offZ);
                dummy.lookAt(camPos.x, camPos.y, camPos.z);
                // Wider than tall → flat-bottomed cumulus shape
                dummy.scale.set(puff.scale, puff.scale * 0.55, 1);
                dummy.updateMatrix();
                this.cloudMesh.setMatrixAt(base.start + j, dummy.matrix);
            }
        });
        this.cloudMesh.instanceMatrix.needsUpdate = true;
    }
}

export default DynamicEnvironment;