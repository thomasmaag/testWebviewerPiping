import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const container = document.getElementById('viewer');
const status = document.getElementById('status');
const controlsPanel = document.getElementById('controls-panel');
const controlsToggle = document.getElementById('controls-toggle');
const resetViewButton = document.getElementById('reset-view');
const measureToggleButton = document.getElementById('measure-toggle');
const measureResultPanel = document.getElementById('measure-result');
const measureResultCloseButton = document.getElementById('measure-result-close');
const measureDistanceValue = document.getElementById('measure-distance');
const measureDeltaXValue = document.getElementById('measure-delta-x');
const measureDeltaYValue = document.getElementById('measure-delta-y');
const measureDeltaZValue = document.getElementById('measure-delta-z');
let modelRoot = null;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf4f6f8);

const measurementGroup = new THREE.Group();
measurementGroup.name = 'Measurements';
scene.add(measurementGroup);

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

const MeasureState = {
    Inactive: 'inactive',
    WaitingForFirstPoint: 'waiting-for-first-point',
    WaitingForSecondPoint: 'waiting-for-second-point'
};

const measureTargetMeshes = [];
const measureRaycaster = new THREE.Raycaster();
const measurePointer = new THREE.Vector2();
const measureNormalMatrix = new THREE.Matrix3();
const measureDefaultNormal = new THREE.Vector3(0, 1, 0);
const measureCylinderUp = new THREE.Vector3(0, 1, 0);
const measureClickMoveThresholdPixels = 6;

const measureMarkerGeometry = new THREE.SphereGeometry(1, 20, 14);
const measureMarkerMaterial = new THREE.MeshStandardMaterial({
    color: 0x1f9d55,
    emissive: 0x0a3d1f,
    emissiveIntensity: 0.2,
    roughness: 0.35,
    metalness: 0
});
const measureLineGeometry = new THREE.CylinderGeometry(1, 1, 1, 16);
const measureLineMaterial = new THREE.MeshStandardMaterial({
    color: 0x1f9d55,
    emissive: 0x0a3d1f,
    emissiveIntensity: 0.18,
    roughness: 0.4,
    metalness: 0
});

const measureMarkerA = new THREE.Mesh(measureMarkerGeometry, measureMarkerMaterial);
const measureMarkerB = new THREE.Mesh(measureMarkerGeometry, measureMarkerMaterial);
const measureLine = new THREE.Mesh(measureLineGeometry, measureLineMaterial);
measureMarkerA.name = 'Measure_Point_A';
measureMarkerB.name = 'Measure_Point_B';
measureLine.name = 'Measure_Line';
measurementGroup.add(measureMarkerA);
measurementGroup.add(measureMarkerB);
measurementGroup.add(measureLine);

const measureLabelCanvas = document.createElement('canvas');
measureLabelCanvas.width = 512;
measureLabelCanvas.height = 128;
const measureLabelContext = measureLabelCanvas.getContext('2d');
const measureLabelTexture = new THREE.CanvasTexture(measureLabelCanvas);
measureLabelTexture.colorSpace = THREE.SRGBColorSpace;
const measureLabelMaterial = new THREE.SpriteMaterial({
    map: measureLabelTexture,
    transparent: true,
    depthTest: false
});
const measureLabel = new THREE.Sprite(measureLabelMaterial);
measureLabel.name = 'Measure_Distance_Label';
measurementGroup.add(measureLabel);

let measureState = MeasureState.Inactive;
let measurePointA = null;
let measurePointB = null;
let measurePointerDown = null;
let measureMarkerRadius = 0.05;
let measureLineRadius = 0.01;
let measureSurfaceOffset = 0.002;
let measureLabelOffset = 0.04;
let measureLabelScale = 0.4;

hideMeasurementVisuals();

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

function formatMetres(value) {
    if (!Number.isFinite(value)) {
        return '-';
    }

    const rounded = Math.round(value * 1000) / 1000;
    const safeValue = Object.is(rounded, -0) ? 0 : rounded;
    return safeValue.toFixed(3).replace(/\.?0+$/, '') + ' m';
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

function setMeasureButtonActive(isActive) {
    measureToggleButton.classList.toggle('active', isActive);
    measureToggleButton.textContent = isActive ? 'Cancel Measure' : 'Measure';
    measureToggleButton.setAttribute('aria-pressed', String(isActive));
    document.body.classList.toggle('measure-active', isActive);
}

function collectMeasureTargetMeshes(root) {
    measureTargetMeshes.length = 0;

    if (!root) {
        return;
    }

    root.updateWorldMatrix(true, true);
    root.traverse((child) => {
        if (child.isMesh && child.geometry) {
            measureTargetMeshes.push(child);
        }
    });
}

function configureMeasurementScale(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const safeMaxDim = Number.isFinite(maxDim) && maxDim > 0 ? maxDim : 1;

    measureMarkerRadius = safeMaxDim * 0.012;
    measureLineRadius = Math.max(measureMarkerRadius * 0.22, safeMaxDim * 0.0015);
    measureSurfaceOffset = Math.max(measureMarkerRadius * 0.35, safeMaxDim * 0.001);
    measureLabelOffset = Math.max(measureMarkerRadius * 3, safeMaxDim * 0.025);
    measureLabelScale = Math.max(safeMaxDim * 0.12, measureMarkerRadius * 8);

    measureMarkerA.scale.setScalar(measureMarkerRadius);
    measureMarkerB.scale.setScalar(measureMarkerRadius);
    measureLabel.scale.set(measureLabelScale, measureLabelScale * 0.25, 1);
}

function isMeasuring() {
    return measureState !== MeasureState.Inactive;
}

function showMeasureResult(pointA, pointB) {
    const delta = pointB.clone().sub(pointA);

    measureDistanceValue.textContent = formatMetres(delta.length());
    measureDeltaXValue.textContent = formatMetres(Math.abs(delta.x));
    measureDeltaYValue.textContent = formatMetres(Math.abs(delta.y));
    measureDeltaZValue.textContent = formatMetres(Math.abs(delta.z));
    measureResultPanel.classList.remove('hidden');
}

function hideMeasureResult() {
    measureResultPanel.classList.add('hidden');
}

function clearMeasurementPoints() {
    measurePointA = null;
    measurePointB = null;
    measurePointerDown = null;
}

function hideMeasurementVisuals() {
    measureMarkerA.visible = false;
    measureMarkerB.visible = false;
    measureLine.visible = false;
    measureLabel.visible = false;
}

function hideMeasurementPreview() {
    if (measureState === MeasureState.WaitingForFirstPoint) {
        measureMarkerA.visible = false;
        measureLine.visible = false;
        measureLabel.visible = false;
    }

    if (measureState === MeasureState.WaitingForSecondPoint) {
        measureMarkerB.visible = false;
        measureLine.visible = false;
        measureLabel.visible = false;
    }
}

function startMeasureMode() {
    if (!modelRoot || measureTargetMeshes.length === 0) {
        setStatus('Measure is available after model.glb finishes loading.', true);
        return;
    }

    clearMeasurementPoints();
    hideMeasurementVisuals();
    hideMeasureResult();
    measureState = MeasureState.WaitingForFirstPoint;
    setMeasureButtonActive(true);
    setStatus('Measure: click the first point on the model.', false);
}

function cancelMeasureMode() {
    clearMeasurementPoints();
    hideMeasurementVisuals();
    measureState = MeasureState.Inactive;
    setMeasureButtonActive(false);
    hideStatus();
}

function finishMeasureMode() {
    measureState = MeasureState.Inactive;
    setMeasureButtonActive(false);
    hideStatus();
}

function getPointerHit(event) {
    if (measureTargetMeshes.length === 0) {
        return null;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    const width = rect.width || 1;
    const height = rect.height || 1;

    measurePointer.x = ((event.clientX - rect.left) / width) * 2 - 1;
    measurePointer.y = -((event.clientY - rect.top) / height) * 2 + 1;

    measureRaycaster.setFromCamera(measurePointer, camera);
    const hits = measureRaycaster.intersectObjects(measureTargetMeshes, false);

    for (const hit of hits) {
        if (hit.object && hit.object.visible) {
            return hit;
        }
    }

    return null;
}

function getHitNormal(hit) {
    if (!hit || !hit.face || !hit.object) {
        return measureDefaultNormal.clone();
    }

    const normal = hit.face.normal.clone();
    measureNormalMatrix.getNormalMatrix(hit.object.matrixWorld);
    normal.applyMatrix3(measureNormalMatrix).normalize();

    if (normal.lengthSq() < 0.0001) {
        return measureDefaultNormal.clone();
    }

    return normal;
}

function setMarkerFromHit(marker, hit) {
    const normal = getHitNormal(hit);
    marker.position.copy(hit.point).add(normal.multiplyScalar(measureSurfaceOffset));
    marker.scale.setScalar(measureMarkerRadius);
    marker.visible = true;
}

function updateMeasureLine(start, end) {
    const direction = end.clone().sub(start);
    const length = direction.length();

    if (!Number.isFinite(length) || length <= 0.000001) {
        measureLine.visible = false;
        return;
    }

    const midpoint = start.clone().add(end).multiplyScalar(0.5);
    measureLine.position.copy(midpoint);
    measureLine.quaternion.setFromUnitVectors(measureCylinderUp, direction.normalize());
    measureLine.scale.set(measureLineRadius, length, measureLineRadius);
    measureLine.visible = true;
}

function setMeasureLabelText(text) {
    measureLabelContext.clearRect(0, 0, measureLabelCanvas.width, measureLabelCanvas.height);
    measureLabelContext.fillStyle = 'rgba(23, 32, 42, 0.82)';
    measureLabelContext.fillRect(0, 0, measureLabelCanvas.width, measureLabelCanvas.height);
    measureLabelContext.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    measureLabelContext.lineWidth = 4;
    measureLabelContext.strokeRect(2, 2, measureLabelCanvas.width - 4, measureLabelCanvas.height - 4);
    measureLabelContext.fillStyle = '#ffffff';
    measureLabelContext.font = '700 48px Arial, Helvetica, sans-serif';
    measureLabelContext.textAlign = 'center';
    measureLabelContext.textBaseline = 'middle';
    measureLabelContext.fillText(text, measureLabelCanvas.width / 2, measureLabelCanvas.height / 2);
    measureLabelTexture.needsUpdate = true;
}

function updateMeasureLabel(start, end, normal) {
    const midpoint = start.clone().add(end).multiplyScalar(0.5);
    const offsetDirection = normal && normal.lengthSq() > 0.0001
        ? normal.clone().normalize()
        : camera.position.clone().sub(midpoint).normalize();

    measureLabel.position.copy(midpoint).add(offsetDirection.multiplyScalar(measureLabelOffset));
    measureLabel.scale.set(measureLabelScale, measureLabelScale * 0.25, 1);
    setMeasureLabelText(formatMetres(start.distanceTo(end)));
    measureLabel.visible = true;
}

function updateMeasurePreview(hit) {
    if (!hit) {
        hideMeasurementPreview();
        return;
    }

    if (measureState === MeasureState.WaitingForFirstPoint) {
        setMarkerFromHit(measureMarkerA, hit);
        measureMarkerB.visible = false;
        measureLine.visible = false;
        measureLabel.visible = false;
        return;
    }

    if (measureState === MeasureState.WaitingForSecondPoint && measurePointA) {
        const normal = getHitNormal(hit);
        setMarkerFromHit(measureMarkerB, hit);
        updateMeasureLine(measurePointA, hit.point);
        updateMeasureLabel(measurePointA, hit.point, normal);
    }
}

function setFirstMeasurePoint(hit) {
    measurePointA = hit.point.clone();
    measurePointB = null;
    setMarkerFromHit(measureMarkerA, hit);
    measureMarkerB.visible = false;
    measureLine.visible = false;
    measureLabel.visible = false;
    measureState = MeasureState.WaitingForSecondPoint;
    setStatus('Measure: click the second point on the model.', false);
}

function setSecondMeasurePoint(hit) {
    if (!measurePointA) {
        return;
    }

    const normal = getHitNormal(hit);
    measurePointB = hit.point.clone();
    setMarkerFromHit(measureMarkerB, hit);
    updateMeasureLine(measurePointA, measurePointB);
    updateMeasureLabel(measurePointA, measurePointB, normal);
    showMeasureResult(measurePointA, measurePointB);
    finishMeasureMode();
}

function handleMeasureClick(hit) {
    if (measureState === MeasureState.WaitingForFirstPoint) {
        setFirstMeasurePoint(hit);
        return;
    }

    if (measureState === MeasureState.WaitingForSecondPoint) {
        setSecondMeasurePoint(hit);
    }
}

function handleMeasurePointerDown(event) {
    if (!isMeasuring() || event.button !== 0) {
        return;
    }

    measurePointerDown = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY
    };
}

function handleMeasurePointerMove(event) {
    if (!isMeasuring()) {
        return;
    }

    updateMeasurePreview(getPointerHit(event));
}

function handleMeasurePointerUp(event) {
    if (!isMeasuring() || event.button !== 0 || !measurePointerDown) {
        return;
    }

    if (event.pointerId !== measurePointerDown.pointerId) {
        return;
    }

    const moveX = event.clientX - measurePointerDown.x;
    const moveY = event.clientY - measurePointerDown.y;
    const movedPixels = Math.hypot(moveX, moveY);
    measurePointerDown = null;

    if (movedPixels > measureClickMoveThresholdPixels) {
        return;
    }

    const hit = getPointerHit(event);

    if (!hit) {
        setStatus('Measure: click a visible model surface.', false);
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    handleMeasureClick(hit);
}

function handleMeasurePointerLeave() {
    if (isMeasuring()) {
        hideMeasurementPreview();
    }
}

measureToggleButton.addEventListener('click', () => {
    if (isMeasuring()) {
        cancelMeasureMode();
    } else {
        startMeasureMode();
    }
});

measureResultCloseButton.addEventListener('click', () => {
    hideMeasureResult();
});

renderer.domElement.addEventListener('pointerdown', handleMeasurePointerDown);
renderer.domElement.addEventListener('pointermove', handleMeasurePointerMove);
renderer.domElement.addEventListener('pointerup', handleMeasurePointerUp);
renderer.domElement.addEventListener('pointerleave', handleMeasurePointerLeave);

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isMeasuring()) {
        event.preventDefault();
        cancelMeasureMode();
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
        collectMeasureTargetMeshes(gltf.scene);
        configureMeasurementScale(gltf.scene);
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
