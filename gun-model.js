import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const _loader = new GLTFLoader();

// Loads a gun GLB, scales it so its longest dimension equals `targetLength`,
// and places `anchor` (a point in the model's native coordinates) at the
// pivot's origin. The returned THREE.Group can then be positioned/rotated by
// the caller.
//
//   sniper.glb native space: barrel runs along +Z (muzzle at +Z), up is +Y,
//   and the trigger/grip sits near (0, -1.8, -0.4).
//
//   targetLength is in the PARENT's units:
//     • camera space  → metres   (~1.4 for a sniper)
//     • Mixamo hand bone (fbx scaled 0.01) → ~140 to get 1.4 m in the world
export function loadGunModel(path, targetLength, onReady, anchor = null) {
    _loader.load(path, (gltf) => {
        const model = gltf.scene;

        const box  = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const a    = anchor ? anchor.clone() : box.getCenter(new THREE.Vector3());
        model.position.sub(a);                       // move anchor to origin

        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const pivot  = new THREE.Group();
        pivot.scale.setScalar(targetLength / maxDim);
        pivot.add(model);

        onReady(pivot);
    }, undefined, (err) => console.error('[gun-model] load error:', path, err));
}
