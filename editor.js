// Character editor — from Anarcontra (SpaceChakra). MIT licensed.
// A live turntable preview of buildHumanoid(spec). Every field of the
// CharacterSpec is exposed as a control; presets load the example specs.
// Specs can be exported/imported as JSON so looks authored here can be pasted
// straight into your game.
import * as THREE from 'three';
import {
  buildHumanoid, animateHumanoid, buildDog, animateDog,
  DEFAULT_SPEC, EXAMPLE_SPECS, randomSpec,
} from './characters.js';
import { POSE_PRESETS, presetState } from './anim.js';

// ---------------------------------------------------------------- scene ----
const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d15);
scene.fog = new THREE.Fog(0x0a0d15, 10, 26);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

// lighting: soft fill + a key light for shape reading
scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x1a1410, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.position.set(4, 8, 6);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.top = 4; key.shadow.camera.bottom = -1;
key.shadow.camera.left = -4; key.shadow.camera.right = 4;
scene.add(key);
const rim = new THREE.DirectionalLight(0x4f7dff, 0.6);
rim.position.set(-5, 3, -4);
scene.add(rim);

// ground disc + grid
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(6, 48),
  new THREE.MeshStandardMaterial({ color: 0x11151f, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(12, 24, 0x2a3350, 0x1a2030);
grid.position.y = 0.001;
scene.add(grid);

// turntable rig: the model hangs under a yaw pivot we spin
const pivot = new THREE.Group();
scene.add(pivot);
let current = null;      // { group, parts }
let currentIsDog = false;

function setModel(spec, isDog) {
  if (current) pivot.remove(current.group);
  currentIsDog = !!isDog;
  current = isDog ? buildDog(spec) : buildHumanoid(spec);
  current.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  pivot.add(current.group);
}

// -------------------------------------------------------------- camera ctl -
let dist = 4.2, yaw = 0.5, autoSpin = true, dragging = false, lastX = 0;
const target = new THREE.Vector3(0, 1.0, 0);
function updateCamera() {
  camera.position.set(
    target.x + Math.sin(yaw) * dist,
    target.y + 0.5,
    target.z + Math.cos(yaw) * dist
  );
  camera.lookAt(target);
}
renderer.domElement.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; autoSpin = false; });
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  yaw -= (e.clientX - lastX) * 0.01;
  lastX = e.clientX;
});
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  dist = Math.max(2.2, Math.min(9, dist + e.deltaY * 0.003));
}, { passive: false });

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// --------------------------------------------------------------- spec state -
let spec = { ...DEFAULT_SPEC, ...EXAMPLE_SPECS.operative };
let previewPose = 'walk';
window.__setPose = (name) => {
  previewPose = name;
  const sel = document.getElementById('poseSel');
  if (sel) sel.value = name;
};

// ------------------------------------------------------------- UI controls -
// Declarative description of the panel. Each entry maps a spec key to a widget.
const COLOR = 'color', TOGGLE_COLOR = 'toggleColor', SELECT = 'select', BOOL = 'bool', TEXT = 'text';
const SECTIONS = [
  ['Identity', [
    { k: 'name', type: TEXT, label: 'Name' },
    { k: 'build', type: SELECT, label: 'Build', opts: ['normal', 'hero', 'heavy', 'light'] },
  ]],
  ['Head', [
    { k: 'skin', type: COLOR, label: 'Skin' },
    { k: 'hair', type: TOGGLE_COLOR, label: 'Hair', off: null, on: 0x201a16 },
    { k: 'hairStyle', type: SELECT, label: 'Hair style', opts: ['short', 'combed', 'buzz'] },
    { k: 'mask', type: SELECT, label: 'Face gear', opts: ['none', 'respirator', 'goggles', 'bandana'] },
    { k: 'maskColor', type: COLOR, label: 'Mask colour' },
    { k: 'lens', type: COLOR, label: 'Lens / eyepiece' },
  ]],
  ['Upper body', [
    { k: 'shirt', type: COLOR, label: 'Shirt / jacket' },
    { k: 'hood', type: TOGGLE_COLOR, label: 'Hood', off: null, on: 0x8f1c27 },
    { k: 'vest', type: TOGGLE_COLOR, label: 'Tactical vest', off: null, on: 0x59613f },
    { k: 'coat', type: TOGGLE_COLOR, label: 'Trench coat', off: null, on: 0x3b4048 },
    { k: 'pads', type: TOGGLE_COLOR, label: 'Armour pads', off: null, on: 0x2454c8 },
    { k: 'gloves', type: COLOR, label: 'Gloves' },
  ]],
  ['Lower body', [
    { k: 'pants', type: COLOR, label: 'Pants' },
    { k: 'kneepads', type: TOGGLE_COLOR, label: 'Knee pads', off: null, on: 0x2b2f26 },
    { k: 'belt', type: TOGGLE_COLOR, label: 'Utility belt', off: null, on: 0x4a4d33 },
    { k: 'holster', type: BOOL, label: 'Thigh holster' },
    { k: 'boots', type: COLOR, label: 'Boots' },
  ]],
  ['Gear', [
    { k: 'gunColor', type: COLOR, label: 'Gun' },
  ]],
];

const hex = (n) => '#' + (n & 0xffffff).toString(16).padStart(6, '0');
const num = (s) => parseInt(s.slice(1), 16);

const controlsEl = document.getElementById('controls');

function buildPanel() {
  controlsEl.innerHTML = '';
  const wrow = document.createElement('div');
  wrow.className = 'row';
  wrow.innerHTML = '<label>Pose</label>';
  const sel = document.createElement('select');
  for (const name of POSE_PRESETS) {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    sel.appendChild(opt);
  }
  sel.id = 'poseSel';
  sel.value = previewPose;
  sel.onchange = () => { previewPose = sel.value; };
  const wctl = document.createElement('div'); wctl.className = 'ctl'; wctl.appendChild(sel);
  wrow.appendChild(wctl);
  controlsEl.appendChild(wrow);

  for (const [title, fields] of SECTIONS) {
    const h = document.createElement('div');
    h.className = 'group-title'; h.textContent = title;
    controlsEl.appendChild(h);
    for (const f of fields) controlsEl.appendChild(makeRow(f));
  }
}

function makeRow(f) {
  const row = document.createElement('div');
  row.className = 'row';
  const label = document.createElement('label');
  label.textContent = f.label;
  row.appendChild(label);
  const ctl = document.createElement('div');
  ctl.className = 'ctl';
  row.appendChild(ctl);

  if (f.type === TEXT) {
    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = spec[f.k] ?? '';
    inp.style.cssText = 'width:120px;background:#080b12;color:#dce4f5;border:1px solid #2a3350;border-radius:5px;padding:3px 6px;font-size:12px;';
    inp.oninput = () => { spec[f.k] = inp.value; syncJSON(); };
    ctl.appendChild(inp);
  } else if (f.type === SELECT) {
    const sel = document.createElement('select');
    for (const o of f.opts) {
      const opt = document.createElement('option');
      opt.value = o; opt.textContent = o; sel.appendChild(opt);
    }
    sel.value = spec[f.k] ?? f.opts[0];
    sel.onchange = () => { spec[f.k] = sel.value; rebuild(); };
    ctl.appendChild(sel);
  } else if (f.type === BOOL) {
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = !!spec[f.k];
    cb.onchange = () => { spec[f.k] = cb.checked; rebuild(); };
    ctl.appendChild(cb);
  } else if (f.type === COLOR) {
    const c = document.createElement('input');
    c.type = 'color'; c.value = hex(spec[f.k] ?? 0x808080);
    c.oninput = () => { spec[f.k] = num(c.value); rebuild(); };
    ctl.appendChild(c);
  } else if (f.type === TOGGLE_COLOR) {
    const enabled = spec[f.k] != null;
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = enabled;
    const c = document.createElement('input');
    c.type = 'color'; c.value = hex(enabled ? spec[f.k] : (f.on ?? 0x808080));
    c.disabled = !enabled;
    cb.onchange = () => {
      c.disabled = !cb.checked;
      spec[f.k] = cb.checked ? num(c.value) : null;
      rebuild();
    };
    c.oninput = () => { spec[f.k] = num(c.value); rebuild(); };
    ctl.appendChild(cb); ctl.appendChild(c);
  }
  return row;
}

// ---------------------------------------------------------------- presets --
const PRESETS = [
  { label: 'Operative', cls: 'red', get: () => ({ ...EXAMPLE_SPECS.operative }) },
  { label: 'Detective', get: () => ({ ...EXAMPLE_SPECS.detective }) },
  { label: 'Runner', get: () => ({ ...EXAMPLE_SPECS.runner }) },
  { label: 'Bruiser', get: () => ({ ...EXAMPLE_SPECS.bruiser }) },
  { label: '🎲 Random', get: () => randomSpec() },
  { label: 'Dog', dog: true, get: () => ({ coat: 0x2a241f }) },
];

const presetsEl = document.getElementById('presets');
for (const p of PRESETS) {
  const b = document.createElement('button');
  b.className = 'preset' + (p.cls ? ' ' + p.cls : '');
  b.textContent = p.label;
  b.onclick = () => {
    if (p.dog) { setModel(p.get(), true); syncJSON(); return; }
    spec = { ...DEFAULT_SPEC, ...p.get() };
    buildPanel();
    rebuild();
  };
  presetsEl.appendChild(b);
}

// ------------------------------------------------------------- json import -
const jsonEl = document.getElementById('json');
function syncJSON() {
  const out = {};
  for (const k of Object.keys(DEFAULT_SPEC)) {
    const v = spec[k];
    out[k] = (typeof v === 'number' && k !== 'holster') ? hex(v) : v;
  }
  jsonEl.value = JSON.stringify(out, null, 2);
}
document.getElementById('copyBtn').onclick = () => {
  navigator.clipboard?.writeText(jsonEl.value);
  const b = document.getElementById('copyBtn'); const t = b.textContent;
  b.textContent = 'COPIED!'; setTimeout(() => (b.textContent = t), 900);
};
document.getElementById('applyBtn').onclick = () => {
  try {
    const parsed = JSON.parse(jsonEl.value);
    const next = {};
    for (const [k, v] of Object.entries(parsed)) {
      next[k] = (typeof v === 'string' && v.startsWith('#')) ? num(v) : v;
    }
    spec = { ...DEFAULT_SPEC, ...next };
    currentIsDog = false;
    buildPanel(); rebuild();
  } catch (err) { alert('Invalid JSON: ' + err.message); }
};

function rebuild() {
  if (currentIsDog) return;   // dog preview stays until a humanoid preset is chosen
  setModel(spec, false);
  syncJSON();
}

// --------------------------------------------------------------- main loop -
const clock = new THREE.Clock();
let t = 0;
function loop() {
  const dt = Math.min(0.05, clock.getDelta());
  t += dt;
  if (autoSpin && !dragging) yaw += dt * 0.4;
  if (current) {
    if (currentIsDog) {
      animateDog(current.parts, t, previewPose !== 'idle');
      current.group.position.y = 0;
    } else {
      animateHumanoid(current.parts, t, presetState(previewPose));
      if (previewPose === 'jump' || previewPose === 'fall') current.group.position.y = 0.65;
      else current.group.position.y = 0;
    }
  }
  updateCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

resize();
buildPanel();
setModel(spec, false);
syncJSON();
updateCamera();
loop();
