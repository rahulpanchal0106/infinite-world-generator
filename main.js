import * as THREE from 'three';
import DynamicEnvironment from './environment.js';
import { buildTerrain, buildForest, getTerrainHeight } from './terrain.js';
import { Player } from './player.js';

// 1. Core Setup
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x87CEEB, 100, 1200);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 3000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// 2. Initialize Game Modules
const environment = new DynamicEnvironment(scene, { dayDurationSeconds: 60, cloudSpeed: 40 });
buildTerrain(scene);
buildForest(scene);

const uiElement = document.getElementById('ui');
const player = new Player(camera, document.body, uiElement, getTerrainHeight);

// Place player initially
camera.position.set(0, getTerrainHeight(0, 0) + 5, 0);

// 3. Render Loop
let prevTime = performance.now();

function animate() {
    requestAnimationFrame(animate);
    
    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    environment.update(delta);
    player.update(delta);

    renderer.render(scene, camera);
    prevTime = time;
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});