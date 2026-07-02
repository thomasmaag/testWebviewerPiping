import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const container = document.getElementById('viewer');
const status = document.getElementById('status');
const controlsPanel = document.getElementById('controls-panel');
const controlsToggle = document.getElementById('controls-toggle');
const resetViewButton = document.getElementById('reset-view');
let modelRoot = null;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf4f6f8);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
};
controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN
};

scene.add(new THREE.HemisphereLight(0xffffff, 0x7a8794, 2.4));

const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
fillLight.position.set(-4, 2, -3);
scene.add(fillLight);

function resizeRenderer() {
    const width = container.clientWidth || window.innerWidth || 1;
    const height = container.clientHeight || window.innerHeight || 1;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
}

function fitCameraToObject(object) {
    const box = new THREE.Box3().setFromObject(object);

    if (box.isEmpty()) {
        camera.position.set(3, 2, 3);
        controls.target.set(0, 0, 0);
        controls.update();
        return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const safeMaxDim = Number.isFinite(maxDim) && maxDim > 0 ? maxDim : 1;
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const fitHeightDistance = safeMaxDim / (2 * Math.tan(verticalFov / 2));
    const fitWidthDistance = fitHeightDistance / camera.aspect;
    const distance = Math.max(fitHeightDistance, fitWidthDistance) * 1.35;
    const safeDistance = Number.isFinite(distance) && distance > 0 ? distance : 3;
    const viewDirection = new THREE.Vector3(1, 0.75, 1).normalize();

    camera.position.copy(center).add(viewDirection.multiplyScalar(safeDistance));
    camera.near = Math.max(safeDistance / 1000, 0.001);
    camera.far = Math.max(safeDistance * 100, 1000);
    camera.updateProjectionMatrix();

    controls.target.copy(center);
    controls.minDistance = Math.max(safeDistance / 100, 0.001);
    controls.maxDistance = safeDistance * 50;
    controls.update();
}

function setStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle('error', Boolean(isError));
    status.classList.remove('hidden');
}

function hideStatus() {
    status.classList.add('hidden');
}

function setControlsCollapsed(isCollapsed) {
    controlsPanel.classList.toggle('collapsed', isCollapsed);
    controlsToggle.textContent = isCollapsed ? 'Show' : 'Hide';
    controlsToggle.setAttribute('aria-expanded', String(!isCollapsed));
}

controlsToggle.addEventListener('click', () => {
    setControlsCollapsed(!controlsPanel.classList.contains('collapsed'));
});

resetViewButton.addEventListener('click', () => {
    if (modelRoot) {
        fitCameraToObject(modelRoot);
    }
});

resizeRenderer();
window.addEventListener('resize', resizeRenderer);

const loader = new GLTFLoader();
loader.load(
    './model.glb',
    (gltf) => {
        modelRoot = gltf.scene;
        scene.add(gltf.scene);
        fitCameraToObject(gltf.scene);
        hideStatus();
    },
    (progress) => {
        if (progress.total > 0) {
            const percent = Math.round((progress.loaded / progress.total) * 100);
            setStatus('Loading model.glb ' + percent + '%', false);
        }
    },
    (error) => {
        console.error('[3D Piping Web Viewer] Failed to load ./model.glb', error);
        setStatus('Could not load ./model.glb. Serve this folder over HTTP and keep model.glb next to index.html.', true);
    }
);

renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
});
