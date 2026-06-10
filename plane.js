import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getTerrainHeight } from './terrain.js';

// ── Tunables ────────────────────────────────────────────────────────────────
export const PLANE_GRID = 500;          // a parked plane every 500 units
const PLANE_LENGTH      = 16;           // normalised longest dimension (world units)
const PLANE_GRID_RADIUS = 1;            // spawn/render parked planes within ±1 cell
const ENTER_DISTANCE    = 18;           // how close you must be to board
const WATER_LEVEL       = 27;           // don't park planes in the ocean

// Flight feel
const CRUISE_SPEED = 110;
const BOOST_SPEED  = 240;
const ACCEL        = 120;
const PITCH_RATE   = 1.1;   // rad/s
const ROLL_RATE    = 1.8;   // rad/s
const YAW_RATE     = 0.6;   // rad/s induced by banking
const CHASE_DIST   = 34;
const CHASE_HEIGHT = 12;
const MIN_GROUND_CLEARANCE = 6;

// Model-space forward axis after our orientation fix (nose direction).
const PLANE_FORWARD = new THREE.Vector3(0, 0, -1);

// ── Shared, baked plane geometry (loaded once) ──────────────────────────────
// [{ geometry, material }] — built once and shared by every parked/flying plane
// (no per-plane geometry clone). Same approach as the trees/houses.
let planeParts = null;
const _loader = new GLTFLoader();
_loader.load('/models/cessna_208.glb', (gltf) => {
    const root = gltf.scene;
    // GLB is Y-up (glTF spec). The model's nose points along +X but our
    // PLANE_FORWARD is (0,0,-1), so rotate 90° on Y to align the nose to -Z.
    root.rotation.y = Math.PI / 2;

    // Normalise so the longest dimension == PLANE_LENGTH, base sitting at y=0.
    const pivot = new THREE.Group();
    pivot.add(root);
    pivot.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(pivot).getSize(new THREE.Vector3());
    root.scale.multiplyScalar(PLANE_LENGTH / (Math.max(size.x, size.y, size.z) || 1));
    pivot.updateMatrixWorld(true);
    root.position.y -= new THREE.Box3().setFromObject(pivot).min.y;
    pivot.updateMatrixWorld(true);

    const parts = [];
    pivot.traverse(c => {
        if (!c.isMesh) return;
        const geometry = c.geometry.clone();
        geometry.applyMatrix4(c.matrixWorld); // bake orientation/size into vertices
        parts.push({ geometry, material: c.material });
    });
    planeParts = parts;
}, undefined, (err) => console.error('Error loading cessna_208.glb:', err));

// Build a plane Group from the shared baked parts (geometry is shared, never cloned).
export function createPlaneMesh() {
    const g = new THREE.Group();
    if (!planeParts) { g.userData.pending = true; return g; }
    for (const { geometry, material } of planeParts) {
        const m = new THREE.Mesh(geometry, material);
        m.castShadow = false;
        m.receiveShadow = false;
        g.add(m);
    }
    return g;
}

function fillPending(group) {
    if (!group.userData.pending || !planeParts) return;
    for (const { geometry, material } of planeParts) {
        const m = new THREE.Mesh(geometry, material);
        m.castShadow = false; m.receiveShadow = false;
        group.add(m);
    }
    group.userData.pending = false;
}

// ── PlaneManager: parked planes on a 500-unit grid near the player ──────────
// Deterministic positions (grid + terrain height) → identical on every client,
// so parked planes are automatically "visible to other players" with no sync.
export class PlaneManager {
    constructor(scene) {
        this.scene  = scene;
        this.parked = new Map();      // "cx,cz" → { group, position }
        this.occupied = new Set();    // cells whose plane the local player is flying
    }

    update(playerPos) {
        if (!planeParts) return;   // wait for the GLB so we never offer an invisible plane
        const ccx = Math.round(playerPos.x / PLANE_GRID);
        const ccz = Math.round(playerPos.z / PLANE_GRID);
        const active = new Set();

        for (let dx = -PLANE_GRID_RADIUS; dx <= PLANE_GRID_RADIUS; dx++) {
            for (let dz = -PLANE_GRID_RADIUS; dz <= PLANE_GRID_RADIUS; dz++) {
                const cx = ccx + dx, cz = ccz + dz;
                const key = `${cx},${cz}`;
                const x = cx * PLANE_GRID, z = cz * PLANE_GRID;
                const y = getTerrainHeight(x, z);
                if (y < WATER_LEVEL) continue;            // skip ocean cells
                active.add(key);

                let entry = this.parked.get(key);
                if (!entry) {
                    const group = createPlaneMesh();
                    group.position.set(x, y, z);
                    group.rotation.y = 0;                 // all face the same way (deterministic)
                    this.scene.add(group);
                    entry = { group, position: new THREE.Vector3(x, y, z) };
                    this.parked.set(key, entry);
                }
                fillPending(entry.group);                 // attach meshes once the GLB loads
                entry.group.visible = !this.occupied.has(key);
            }
        }

        // Remove parked planes that drifted out of range
        for (const [key, entry] of this.parked) {
            if (!active.has(key)) {
                this.scene.remove(entry.group);
                this.parked.delete(key);
            }
        }
    }

    // Nearest boardable parked plane within ENTER_DISTANCE (ignores occupied ones).
    getNearest(pos) {
        let best = null, bestD = ENTER_DISTANCE * ENTER_DISTANCE;
        for (const [key, entry] of this.parked) {
            if (this.occupied.has(key)) continue;
            const dx = pos.x - entry.position.x;
            const dz = pos.z - entry.position.z;
            const d = dx * dx + dz * dz;
            if (d < bestD) { bestD = d; best = { key, position: entry.position }; }
        }
        return best;
    }

    setOccupied(key, occ) {
        if (occ) this.occupied.add(key); else this.occupied.delete(key);
        const e = this.parked.get(key);
        if (e) e.group.visible = !occ;
    }

    // Relocate a parked plane to where the player actually landed.
    landPlane(key, landX, landZ, terrainY) {
        this.occupied.delete(key);
        const e = this.parked.get(key);
        if (e) {
            e.position.set(landX, terrainY, landZ);
            e.group.position.copy(e.position);
            e.group.visible = true;
        }
    }
}

// Takeoff feel
const TAKEOFF_ACCEL    = 35;       // ground acceleration (units/s²)
const LIFTOFF_SPEED    = 40;       // minimum speed before the nose lifts
const CLIMB_RATE       = 18;       // vertical climb speed during takeoff (units/s)
const TAKEOFF_ALTITUDE = 35;       // altitude above ground before full flight unlocks

// ── Airplane: arcade flight controller for the local player ─────────────────
export class Airplane {
    constructor(scene, camera) {
        this.scene  = scene;
        this.camera = camera;
        this.active = false;
        this.mesh   = null;
        this.position   = new THREE.Vector3();
        this.quaternion = new THREE.Quaternion();
        this.speed = 0;

        // Takeoff state
        this._takeoff     = false;   // true during the ground-roll / initial climb
        this._groundY     = 0;       // terrain height at takeoff spot
        this._startYaw    = 0;       // heading during the ground roll
    }

    enter(startPos, yaw = 0) {
        this.mesh = createPlaneMesh();
        this.scene.add(this.mesh);
        this.position.copy(startPos);
        this.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0));
        this.speed = 0;                                     // start stationary
        this.active       = true;
        this._takeoff     = true;
        this._groundY     = startPos.y;
        this._startYaw    = yaw;
    }

    // input = { pitch:-1..1, roll:-1..1, boost:bool }
    update(delta, input) {
        if (!this.active) return;

        const Y = new THREE.Vector3(0, 1, 0);

        // ── TAKEOFF PHASE ──────────────────────────────────────────────────
        if (this._takeoff) {
            // Accelerate along the runway
            this.speed += TAKEOFF_ACCEL * delta;
            if (this.speed > CRUISE_SPEED) this.speed = CRUISE_SPEED;

            // Ground roll — move forward, locked to the ground heading
            const fwd = PLANE_FORWARD.clone().applyQuaternion(this.quaternion);
            this.position.addScaledVector(fwd, this.speed * delta);

            // Once fast enough, start climbing smoothly
            if (this.speed >= LIFTOFF_SPEED) {
                const climbFrac = Math.min(1, (this.speed - LIFTOFF_SPEED) / (CRUISE_SPEED - LIFTOFF_SPEED));
                this.position.y += CLIMB_RATE * climbFrac * delta;

                // Gentle nose-up pitch during climb (max ~15°)
                const pitchUp = -0.26 * climbFrac;
                this.quaternion.setFromEuler(new THREE.Euler(pitchUp, this._startYaw, 0));
            }

            // Keep above terrain
            const groundY = getTerrainHeight(this.position.x, this.position.z);
            if (this.position.y < groundY) this.position.y = groundY;

            // End takeoff once we're high enough and fast enough
            const altAboveGround = this.position.y - getTerrainHeight(this.position.x, this.position.z);
            if (altAboveGround >= TAKEOFF_ALTITUDE && this.speed >= CRUISE_SPEED * 0.8) {
                this._takeoff = false;
                // Snap quaternion to a clean level heading for full-flight
                this.quaternion.setFromEuler(new THREE.Euler(0, this._startYaw, 0));
            }

            // Update mesh
            this.mesh.position.copy(this.position);
            this.mesh.quaternion.copy(this.quaternion);

            // Chase camera (gentler during takeoff — more behind, less above)
            const forward = PLANE_FORWARD.clone().applyQuaternion(this.quaternion);
            this.camera.position.copy(this.position)
                .addScaledVector(forward, -CHASE_DIST * 1.2)
                .add(new THREE.Vector3(0, CHASE_HEIGHT * 0.7, 0));
            this.camera.up.set(0, 1, 0);
            this.camera.lookAt(this.position.clone().addScaledVector(forward, 20));
            return;
        }

        // ── FULL FLIGHT ────────────────────────────────────────────────────
        // Throttle
        const target = input.boost ? BOOST_SPEED : CRUISE_SPEED;
        this.speed += Math.sign(target - this.speed) * ACCEL * delta;

        // Local-space rotations: roll, pitch, and a bank-induced yaw (coordinated turn)
        const q = this.quaternion;
        const X = new THREE.Vector3(1, 0, 0);
        const Z = new THREE.Vector3(0, 0, 1);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(Z, -input.roll  * ROLL_RATE  * delta));
        q.multiply(new THREE.Quaternion().setFromAxisAngle(X,  input.pitch * PITCH_RATE * delta));
        q.multiply(new THREE.Quaternion().setFromAxisAngle(Y, -input.roll  * YAW_RATE   * delta));

        // Advance along the nose direction
        const forward = PLANE_FORWARD.clone().applyQuaternion(q);
        this.position.addScaledVector(forward, this.speed * delta);

        // Don't fly through the ground
        const groundY = getTerrainHeight(this.position.x, this.position.z) + MIN_GROUND_CLEARANCE;
        if (this.position.y < groundY) this.position.y = groundY;

        this.mesh.position.copy(this.position);
        this.mesh.quaternion.copy(q);

        // Chase camera: behind + above the plane, looking ahead
        const up = Y.clone().applyQuaternion(q);
        this.camera.position.copy(this.position)
            .addScaledVector(forward, -CHASE_DIST)
            .addScaledVector(up, CHASE_HEIGHT);
        this.camera.up.copy(up);
        this.camera.lookAt(this.position.clone().addScaledVector(forward, 12));
    }

    // Leave the plane — returns position info for player drop and parked-plane relocation.
    exit() {
        const x = this.position.x, z = this.position.z;
        const terrainY = getTerrainHeight(x, z);
        if (this.mesh) { this.scene.remove(this.mesh); this.mesh = null; }
        this.active    = false;
        this._takeoff  = false;
        this.camera.up.set(0, 1, 0);                // restore upright camera
        return { x, y: terrainY + 1.7, z, terrainY };
    }

    getNetState() {
        const q = this.quaternion;
        return {
            x: this.position.x, y: this.position.y, z: this.position.z,
            qx: q.x, qy: q.y, qz: q.z, qw: q.w,
        };
    }
}
