import * as THREE from 'three';

// Layered pose player for the shared humanoid rig.
//
// Gameplay never writes bones. It passes a state bag; this module:
//   1. resets the rig to bind
//   2. samples locomotion (idle / walk / run / crouch / crawl / air)
//   3. overlays action (aim, melee, kick, block, surrender, reload)
//   4. replaces with roll when dodging
//   5. writes joints
//
// Joint convention (character faces local +Z, +Y up):
//   hip.rotation.x > 0  → thigh swings BACK (toward -Z)
//   hip.rotation.x < 0  → thigh swings FORWARD (toward +Z)
//   knee.rotation.x > 0 → shin folds
//   arm.rotation.x < 0  → upper arm raises forward/up


const BONES = [
  'armL', 'armR', 'elbowL', 'elbowR',
  'legL', 'legR', 'kneeL', 'kneeR', 'ankleL', 'ankleR', 'toeL', 'toeR',
  'headPivot', 'torso',
];

const ARM = ['armL', 'armR', 'elbowL', 'elbowR', 'headPivot'];
const COM = 0.95; // roll pivot ~ hip height so an inverted body stays off the floor
const _footBox = new THREE.Box3();
const _rootPos = new THREE.Vector3();

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { t = clamp01(t); return t * t * (3 - 2 * t); }

function emptyPose() {
  const p = { drop: 0 };
  for (const b of BONES) p[b] = { x: 0, y: 0, z: 0 };
  return p;
}

function copyPose(src) {
  const p = { drop: src.drop || 0 };
  for (const b of BONES) {
    const s = src[b] || { x: 0, y: 0, z: 0 };
    p[b] = { x: s.x, y: s.y, z: s.z };
  }
  return p;
}

function overlay(base, over, w, mask) {
  if (w <= 0.001) return base;
  const p = copyPose(base);
  const m = mask || BONES;
  for (const k of m) {
    const A = base[k] || { x: 0, y: 0, z: 0 };
    const B = over[k] || { x: 0, y: 0, z: 0 };
    p[k] = { x: lerp(A.x, B.x, w), y: lerp(A.y, B.y, w), z: lerp(A.z, B.z, w) };
  }
  if (!mask) p.drop = lerp(base.drop || 0, over.drop || 0, w);
  return p;
}

function add(p, bone, dx, dy = 0, dz = 0) {
  const b = p[bone] || (p[bone] = { x: 0, y: 0, z: 0 });
  b.x += dx; b.y += dy; b.z += dz;
}

function ensureBind(parts) {
  if (parts._bind) return parts._bind;
  parts._bind = {
    hipY: parts.legL.position.y,
    hipXL: parts.legL.position.x,
    hipXR: parts.legR.position.x,
    torsoY: parts.torso.position.y,
  };
  return parts._bind;
}

function writePose(parts, pose) {
  const bind = ensureBind(parts);
  const drop = pose.drop || 0;
  parts.torso.position.set(0, bind.torsoY - drop, 0);
  parts.legL.position.set(bind.hipXL, bind.hipY - drop, 0);
  parts.legR.position.set(bind.hipXR, bind.hipY - drop, 0);
  for (const k of BONES) {
    const n = parts[k];
    if (!n) continue;
    const r = pose[k] || { x: 0, y: 0, z: 0 };
    n.rotation.set(r.x, r.y, r.z);
  }
}

function resetBody(parts) {
  if (!parts.body) return;
  parts.body.rotation.set(0, 0, 0);
  parts.body.position.set(0, 0, 0);
}

function plantFeet(parts) {
  const root = parts.body?.parent;
  if (!root) return;
  root.updateMatrixWorld(true);
  _footBox.makeEmpty();
  let any = false;
  for (const k of ['ankleL', 'ankleR', 'toeL', 'toeR']) {
    if (!parts[k]) continue;
    _footBox.expandByObject(parts[k]);
    any = true;
  }
  if (!any) return;
  root.getWorldPosition(_rootPos);
  let err = _footBox.min.y - _rootPos.y;
  if (err > 0.10) err = 0.10;
  if (err < -0.22) err = -0.22;
  if (Math.abs(err) < 0.004) return;
  if (parts.body) parts.body.position.y -= err;
}

// ---------------------------------------------------------------------------
// Locomotion
// ---------------------------------------------------------------------------
function idlePose(t) {
  const p = emptyPose();
  const breath = Math.sin(t * 2.1);
  const shift = Math.sin(t * 0.7);
  p.torso.x = 0.06 + breath * 0.012;
  p.torso.y = shift * 0.03;
  p.headPivot.x = -p.torso.x * 0.6;
  p.legL.z = -0.06 + shift * 0.02;
  p.legR.z = 0.08 - shift * 0.02;
  p.kneeL.x = 0.16;
  p.kneeR.x = 0.20;
  p.ankleL.x = -p.kneeL.x * 0.4;
  p.ankleR.x = -p.kneeR.x * 0.4;
  p.armL.x = -0.55; p.armL.z = -0.35;
  p.armR.x = -0.45; p.armR.z = 0.28;
  p.elbowL.x = -1.15;
  p.elbowR.x = -0.95;
  return p;
}

function gaitLeg(phase, stride, lift) {
  const ang = phase * Math.PI * 2;
  const s = Math.sin(ang);
  const c = Math.cos(ang);
  const swing = Math.max(0, c);          // forward-swing lift
  const plant = Math.max(0, -c);         // stance
  return {
    hip: -s * stride,
    knee: swing * lift + plant * 0.12 + Math.max(0, -s) * 0.18,
    ankle: s * stride * 0.42 - swing * 0.28 + plant * 0.08,
    toe: -swing * (0.7 + lift * 0.2) + Math.min(0, s) * 0.15,
  };
}

function locoPose(t, speed01, moving, crouch, melee) {
  const sp = clamp01(speed01);
  if (!moving) {
    if (crouch === 1) return crouchIdle();
    if (crouch === 2) return proneIdle();
    return null; // caller uses idle
  }

  const walkStride = 0.42, runStride = 0.78;
  const walkLift = 0.85, runLift = 1.25;
  const stride = lerp(walkStride, runStride, sp);
  const lift = lerp(walkLift, runLift, sp);
  const freq = lerp(5.6, 11.2, sp);
  const phase = (t * freq) / (Math.PI * 2);
  const pL = phase - Math.floor(phase);
  const pR = (pL + 0.5) % 1;
  const L = gaitLeg(pL, stride, lift);
  const R = gaitLeg(pR, stride, lift);

  const p = emptyPose();
  p.legL.x = L.hip; p.kneeL.x = L.knee; p.ankleL.x = L.ankle; p.toeL.x = L.toe;
  p.legR.x = R.hip; p.kneeR.x = R.knee; p.ankleR.x = R.ankle; p.toeR.x = R.toe;

  const twist = Math.sin(pL * Math.PI * 2) * lerp(0.04, 0.09, sp);
  p.torso.x = lerp(0.06, 0.22, sp);
  p.torso.y = twist;
  p.headPivot.x = -p.torso.x * 0.55;
  p.headPivot.y = -twist * 0.4;

  const armAmp = lerp(0.55, 1.05, sp);
  const elbow = lerp(0.7, 1.35, sp);
  p.armL.x = -L.hip * armAmp;
  p.armR.x = melee
    ? -R.hip * armAmp
    : -R.hip * armAmp * 0.55 - sp * 0.18; // gun-arm: damped, low-ready
  p.armL.z = 0.10 + sp * 0.04;
  p.armR.z = -0.08 - sp * 0.04;
  p.elbowL.x = -elbow;
  p.elbowR.x = -elbow * 0.85;

  if (crouch === 1) return crouchWalk(L, R);
  if (crouch === 2) return crawlPose(t, sp);
  return p;
}

function crouchIdle() {
  const p = emptyPose();
  p.drop = 0.14;
  p.legL.x = -0.52; p.legR.x = -0.48;
  p.kneeL.x = 0.95; p.kneeR.x = 0.98;
  p.ankleL.x = 0.28; p.ankleR.x = 0.26;
  p.toeL.x = 0.08; p.toeR.x = 0.06;
  p.torso.x = 0.22;
  p.armL.x = -0.45; p.armL.z = -0.28;
  p.armR.x = -0.40; p.armR.z = 0.24;
  p.elbowL.x = -1.1; p.elbowR.x = -0.95;
  p.headPivot.x = -0.06;
  return p;
}

function crouchWalk(L, R) {
  const p = crouchIdle();
  const k = 0.45;
  p.legL.x = -0.52 + L.hip * k;
  p.legR.x = -0.48 + R.hip * k;
  p.kneeL.x = 0.95 + L.knee * 0.25;
  p.kneeR.x = 0.98 + R.knee * 0.25;
  p.armL.x = -0.35 - L.hip * 0.4;
  p.armR.x = -0.30 - R.hip * 0.25;
  p.torso.y = (L.hip - R.hip) * 0.08;
  return p;
}

function proneIdle() {
  const p = emptyPose();
  p.armL.x = -0.2; p.armR.x = -0.2;
  p.elbowL.x = -0.4; p.elbowR.x = -0.4;
  p.headPivot.x = 0.15;
  return p;
}

function crawlPose(t, sp) {
  const p = proneIdle();
  const f = 7;
  const s = Math.sin(t * f) * 0.55;
  p.armL.x = -0.4 + s;
  p.armR.x = -0.4 - s;
  p.legL.x = s * 0.5;
  p.legR.x = -s * 0.5;
  p.kneeL.x = 0.4 + Math.max(0, s) * 0.5;
  p.kneeR.x = 0.4 + Math.max(0, -s) * 0.5;
  return p;
}

function airPose(velY, land) {
  const p = emptyPose();
  if (land > 0) {
    const k = smooth(land);
    p.drop = 0.16 * k;
    p.legL.x = 0.35 * k; p.legR.x = 0.4 * k;
    p.kneeL.x = 0.85 * k; p.kneeR.x = 0.9 * k;
    p.ankleL.x = -0.3 * k; p.ankleR.x = -0.3 * k;
    p.torso.x = 0.2 * k;
    p.armL.x = -0.3; p.armR.x = -0.25;
    p.elbowL.x = -0.8; p.elbowR.x = -0.7;
    return p;
  }
  const up = clamp01((velY + 2) / 8);       // 1 at takeoff, 0 in free fall
  p.legL.x = lerp(-0.2, 0.45, up);
  p.legR.x = lerp(-0.45, -0.15, up);
  p.kneeL.x = lerp(0.7, 0.35, up);
  p.kneeR.x = lerp(1.05, 0.5, up);
  p.armL.x = lerp(-0.35, -1.65, up);
  p.armR.x = lerp(-0.25, -1.25, up);
  p.armL.z = lerp(-0.55, -0.35, up);
  p.armR.z = lerp(0.55, 0.35, up);
  p.elbowL.x = -0.85;
  p.elbowR.x = -0.7;
  p.torso.x = lerp(0.16, -0.12, up);
  p.headPivot.x = -p.torso.x * 0.5;
  return p;
}

function rollPose(p01) {
  // p01: 1 at dodge start, 0 at end. Body spin is applied separately.
  const p = emptyPose();
  const mid = 1 - Math.abs(p01 - 0.5) * 2; // 0 at ends, 1 at middle
  p.drop = 0.12 + mid * 0.18;
  p.legL.x = 0.9; p.legR.x = 1.05;
  p.kneeL.x = 1.6; p.kneeR.x = 1.7;
  p.ankleL.x = -0.4; p.ankleR.x = -0.35;
  p.armL.x = -1.6; p.armL.z = -0.6;
  p.armR.x = -1.5; p.armR.z = 0.6;
  p.elbowL.x = -1.4; p.elbowR.x = -1.3;
  p.torso.x = 0.6;
  p.headPivot.x = 0.4;
  return p;
}

function applyRollBody(parts, p01) {
  if (!parts.body) return;
  const spin = (1 - p01) * Math.PI * 2;
  parts.body.rotation.x = spin;
  parts.body.position.y = COM * (1 - Math.cos(spin));
  parts.body.position.z = -COM * Math.sin(spin);
}

// ---------------------------------------------------------------------------
// Action overlays
// ---------------------------------------------------------------------------
function aimPose(pitch) {
  const p = emptyPose();
  const pit = pitch || 0;
  p.armR.x = -Math.PI / 2 + pit;
  p.armR.y = 0.05;
  p.armL.x = -Math.PI / 2 + pit * 0.85;
  p.armL.z = 0.38;
  p.elbowL.x = -0.45;
  p.elbowR.x = -0.12;
  p.headPivot.x = pit * 0.35;
  p.torso.x = 0.06 + pit * 0.15;
  return p;
}

function blockPose() {
  const p = emptyPose();
  p.armL.x = -1.55; p.armL.z = -0.45;
  p.armR.x = -1.5; p.armR.z = 0.5;
  p.elbowL.x = -1.35; p.elbowR.x = -1.3;
  p.torso.x = 0.12;
  p.headPivot.x = 0.12;
  p.legL.x = 0.15; p.legR.x = -0.1;
  p.kneeL.x = 0.35; p.kneeR.x = 0.4;
  return p;
}

function surrenderPose() {
  const p = emptyPose();
  p.armL.x = 0.15; p.armL.z = -2.65;
  p.armR.x = 0.15; p.armR.z = 2.65;
  p.elbowL.x = -0.35; p.elbowR.x = -0.35;
  p.headPivot.x = 0.2;
  p.torso.x = 0.08;
  p.kneeL.x = 0.15; p.kneeR.x = 0.18;
  return p;
}

function meleePose(anim, kicking) {
  const p = emptyPose();
  const a = clamp01(anim); // 1 at start, 0 at rest
  // 1.0–0.62 windup, 0.62–0.28 strike, 0.28–0 recover
  let wind = 0, strike = 0, rec = 0;
  if (a > 0.62) wind = (a - 0.62) / 0.38;
  else if (a > 0.28) strike = 1 - (a - 0.28) / 0.34;
  else rec = a / 0.28;

  if (kicking) {
    const k = Math.max(strike, wind * 0.35);
    p.legR.x = lerp(0.15, -1.75, k);
    p.kneeR.x = lerp(0.5, 0.18, k);
    p.ankleR.x = lerp(0, -0.15, k);
    p.legL.x = lerp(0.12, 0.45, k);
    p.kneeL.x = lerp(0.25, 0.7, k);
    p.torso.x = -0.22 * k;
    p.torso.y = 0.32 * k;
    p.armR.x = -1.1; p.armR.z = 0.85;
    p.armL.x = -0.85; p.armL.z = -1.0;
    p.elbowL.x = -1.0; p.elbowR.x = -1.2;
    return p;
  }

  const coil = Math.max(wind, rec * 0.3);
  const hit = Math.max(strike, wind * 0.15);
  p.armR.x = lerp(-0.5, -2.45, hit) + coil * -0.7;
  p.armR.y = coil * 0.45 - hit * 0.25;
  p.armR.z = coil * 0.55;
  p.elbowR.x = lerp(-0.8, -0.15, hit);
  p.armL.x = -0.65 - hit * 0.4;
  p.armL.z = -0.55;
  p.elbowL.x = -1.05;
  p.torso.y = coil * 0.38 - hit * 0.55;
  p.torso.x = -0.06 + hit * 0.22;
  p.legR.x = -hit * 0.35;
  p.legL.x = hit * 0.22;
  return p;
}

function reloadPose(reload01) {
  const p = emptyPose();
  const w = clamp01(reload01);
  p.armR.x = -0.85;
  p.armR.z = 0.35;
  p.elbowR.x = -1.4;
  p.armL.x = -1.1;
  p.armL.z = 0.45;
  p.elbowL.x = -1.5;
  p.headPivot.x = 0.25 * w;
  return p;
}

function fireRecoil(anim) {
  const p = emptyPose();
  const k = clamp01(anim);
  p.armR.x = 0.18 * k;
  p.torso.x = -0.04 * k;
  p.headPivot.x = 0.04 * k;
  return p;
}

// ---------------------------------------------------------------------------
// Public player
// ---------------------------------------------------------------------------
export const POSE_PRESETS = [
  'idle', 'walk', 'run', 'crouch', 'crouchWalk', 'aim',
  'block', 'melee', 'kick', 'jump', 'fall', 'land', 'roll', 'surrender',
];

export function presetState(name) {
  const base = {
    moving: false, speed01: 0, crouch: 0, aiming: false, pitch: 0,
    blocking: false, surrendered: false, attackAnim: 0, kicking: false,
    grounded: true, velY: 0, dodge: 0, land: 0, reload: 0, melee: false,
    strafe: 0, dead: false,
  };
  switch (name) {
    case 'walk': return { ...base, moving: true, speed01: 0.35 };
    case 'run': return { ...base, moving: true, speed01: 1 };
    case 'crouch': return { ...base, crouch: 1 };
    case 'crouchWalk': return { ...base, crouch: 1, moving: true, speed01: 0.3 };
    case 'aim': return { ...base, aiming: true };
    case 'block': return { ...base, blocking: true };
    case 'melee': return { ...base, attackAnim: 0.38, melee: true };
    case 'kick': return { ...base, attackAnim: 0.38, kicking: true, melee: true };
    case 'jump': return { ...base, grounded: false, velY: 8 };
    case 'fall': return { ...base, grounded: false, velY: -8 };
    case 'land': return { ...base, land: 1 };
    case 'roll': return { ...base, dodge: 0.55 };
    case 'surrender': return { ...base, surrendered: true };
    default: return base;
  }
}

export function poseHumanoid(parts, t, state) {
  if (!parts || !parts.torso) return;
  resetBody(parts);

  if (state.dead) {
    writePose(parts, emptyPose());
    return;
  }

  const grounded = state.grounded !== false;
  const crouch = state.crouch || 0;
  const sp = clamp01(state.speed01 || 0);
  const moving = !!state.moving;

  let pose;
  const dodge = clamp01(state.dodge || 0);
  if (dodge > 0) {
    pose = rollPose(dodge);
    writePose(parts, pose);
    applyRollBody(parts, dodge);
    return;
  }

  if (!grounded) {
    pose = airPose(state.velY || 0, 0);
  } else if ((state.land || 0) > 0) {
    pose = airPose(0, state.land);
  } else {
    const loco = locoPose(t, sp, moving, crouch, !!state.melee);
    pose = loco || idlePose(t);
  }

  const strafe = state.strafe || 0;
  add(pose, 'torso', 0, strafe * 0.18, -strafe * 0.14);

  if (state.surrendered) {
    pose = overlay(pose, surrenderPose(), 1, [...ARM, 'torso', 'headPivot', 'kneeL', 'kneeR']);
  } else if (state.blocking) {
    pose = overlay(pose, blockPose(), 1, [...ARM, 'torso', 'headPivot']);
  } else if ((state.attackAnim || 0) > 0.05 && (state.melee || state.kicking)) {
    const atk = meleePose(state.attackAnim, !!state.kicking);
    const mask = state.kicking
      ? BONES
      : [...ARM, 'torso', 'legL', 'legR', 'kneeL', 'kneeR'];
    pose = overlay(pose, atk, 1, mask);
  } else if (state.aiming) {
    pose = overlay(pose, aimPose(state.pitch || 0), 1, [...ARM, 'torso', 'headPivot']);
  } else if ((state.reload || 0) > 0) {
    pose = overlay(pose, reloadPose(1), Math.min(1, state.reload * 4), ARM);
  } else if ((state.attackAnim || 0) > 0.05 && !state.melee) {
    pose = overlay(pose, fireRecoil(state.attackAnim), 0.85, ['armR', 'torso', 'headPivot']);
  }

  if (parts.cape) {
    parts.cape.rotation.x = 0.15 + (moving ? 0.28 + Math.sin(t * 7) * 0.08 : Math.sin(t * 1.5) * 0.04);
  }

  writePose(parts, pose);
  if (grounded && crouch !== 2) plantFeet(parts);
}
