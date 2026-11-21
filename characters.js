// Procedural low-poly character system — from Anarcontra (SpaceChakra).
// MIT licensed — see LICENSE.
//
// ONE BASE CHARACTER, DRESSED UP.
// Every human is built by buildHumanoid() from a single rig. What makes them
// look different is the DATA passed in: a CharacterSpec that describes skin,
// hair, mask, clothing colours and which pieces of kit are worn. This is
// deliberately data-driven so the character editor (index.html) can author
// specs live and export them as JSON.
//
// GROUND CONTRACT — READ BEFORE EDITING PROPORTIONS
// The owning entity places this Group with its origin on the floor
// (mesh.position.y === pos.y, and pos.y === 0 when grounded). Therefore the
// SOLES OF THE FEET must rest at local y = 0. To make that impossible to get
// wrong, the standing hip height (HIP_Y) is DERIVED from the leg-segment
// lengths — never hard-code a hip/torso/foot height that is independent of
// them. When every leg joint is at rotation 0 the soles are flat on the ground
// by construction, so a neutral (non-moving) character can never float or clip.
import * as THREE from 'three';
import { poseHumanoid } from './anim.js';

function mat(color, emissive = 0x000000, emissiveIntensity = 1) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.2, emissive, emissiveIntensity });
}

function box(w, h, d, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.castShadow = true;
  return m;
}

// Rounded, tapered body segment — same centered/local-origin convention as
// box() (extends h/2 up and down from this mesh's origin) so it drops into
// existing joint pivots with no position/rotation changes. `w`/`d` are the
// width/depth at the TOP of the segment (matching box's static size); `taper`
// shrinks the BOTTOM to that fraction of the top, giving flesh/muscle a
// gentle anatomical narrowing (e.g. bicep -> elbow, chest -> waist) instead
// of a uniform slab. Built from a circular cylinder stretched into an ellipse
// (aspect = w/d held constant along the whole segment) since real limbs don't
// flip their width/depth ratio along their length.
function limb(w, h, d, material, taper = 1, segments = 10) {
  const aspect = w / d;
  const geo = new THREE.CylinderGeometry(d / 2, (d * taper) / 2, h, segments, 1);
  geo.scale(aspect, 1, 1);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  return m;
}

// Rounded head: a sphere squashed to w x h x d, centered like box()/limb().
function sphereHead(w, h, d, material, segments = 16) {
  const geo = new THREE.SphereGeometry(0.5, segments, Math.max(8, Math.round(segments * 0.7)));
  geo.scale(w, h, d);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// CHARACTER SPEC
// ---------------------------------------------------------------------------
// Every field is optional; DEFAULT_SPEC fills the gaps. `null` means "not worn"
// for the kit pieces (hood, vest, coat, pads, kneepads).
export const DEFAULT_SPEC = {
  name: 'UNIT',
  build: 'normal',        // normal | hero | heavy | light
  skin: 0xc79066,
  hair: null,             // hex, or null for bald
  hairStyle: 'short',     // short | combed | buzz
  mask: 'none',           // none | respirator | goggles | bandana
  maskColor: 0x2b3038,
  lens: 0x53e0ff,         // goggle / eyepiece tint (emissive)
  shirt: 0x3a3f47,        // jacket body + sleeves
  hood: null,             // raised collar / hood behind the neck
  pants: 0x2e3326,
  vest: null,             // tactical chest rig (heroes / operatives)
  coat: null,             // long trench coat (Amadeus)
  pads: null,             // shoulder / elbow / knee armour accent
  gloves: 0x14181f,
  boots: 0x14181f,
  kneepads: null,
  belt: null,             // utility belt + pouches
  holster: false,         // thigh holster
  gunColor: 0x222831,
};

// Proportion presets. `bulk` scales limb/torso girth (X/Z); `leg` scales the
// leg segment lengths (and therefore, by the ground contract, the whole height).
const BUILDS = {
  normal: { bulk: 1.00, leg: 1.00 },
  hero:   { bulk: 1.06, leg: 1.01 },
  heavy:  { bulk: 1.42, leg: 1.04 },
  light:  { bulk: 0.82, leg: 0.95 },
};

// Builds a modular humanoid rig from a CharacterSpec. Every joint is its own
// Group so animation code can rotate limbs about their anatomical pivots.
// Returns { group, parts }.
export function buildHumanoid(spec = {}, scale = 1) {
  const s = { ...DEFAULT_SPEC, ...spec };
  const B = BUILDS[s.build] || BUILDS.normal;
  const b = B.bulk;                        // girth multiplier

  const g = new THREE.Group();
  const mSkin = mat(s.skin);
  const mShirt = mat(s.shirt);
  const mPants = mat(s.pants);
  const mGlove = mat(s.gloves);
  const mBoot = mat(s.boots);
  const mMask = mat(s.maskColor);
  const mLens = mat(0x0a0f18, s.lens, 0.9);
  const mPad = s.pads != null ? mat(s.pads) : mShirt;
  const mVest = s.vest != null ? mat(s.vest) : null;

  // --- proportions (metres). Leg chain defines HIP_Y so soles sit at y = 0. ---
  const ANKLE_H = 0.12;                     // sole -> ankle joint (boot thickness)
  const SHIN_L = 0.40 * B.leg;              // ankle -> knee
  const THIGH_L = 0.43 * B.leg;             // knee -> hip
  const HIP_Y = ANKLE_H + SHIN_L + THIGH_L; // keeps feet on the floor
  const HIP_X = 0.16 * b;                   // half distance between hip joints

  // `body` wraps torso + legs so a dodge-roll can spin the whole figure around
  // its centre of mass without fighting the owner's mesh yaw. Crouch/roll drop
  // the hip joints (parented here) so the feet can stay on the floor.
  const body = new THREE.Group();
  g.add(body);

  // Everything above the hip joints lives under `upper`.
  const upper = new THREE.Group();
  body.add(upper);

  // ----- spine stack: pelvis -> lower torso -> upper torso -> neck -> head -----
  const pelvis = limb(0.46 * b, 0.26, 0.32 * b, mPants, 0.92);
  pelvis.position.y = HIP_Y + 0.05;
  upper.add(pelvis);

  const lowerTorso = limb(0.44 * b, 0.26, 0.30 * b, mShirt, 0.96);   // abdomen / waist
  lowerTorso.position.y = HIP_Y + 0.25;
  upper.add(lowerTorso);

  const upperTorso = limb(0.58 * b, 0.34, 0.36 * b, mShirt, 0.82);   // chest (broad, tapers to waist)
  upperTorso.position.y = HIP_Y + 0.47;
  upper.add(upperTorso);

  // --- tactical chest rig (worn over the shirt) ---
  if (mVest) {
    const rig = box(0.6 * b, 0.36, 0.4 * b, mVest);            // slab around chest
    rig.position.y = 0;
    upperTorso.add(rig);
    const rigMag = box(0.22, 0.12, 0.06, mVest);              // chest admin pouch
    rigMag.position.set(0, 0.02, 0.21 * b);
    upperTorso.add(rigMag);
    for (const sx of [-1, 1]) {                               // shoulder straps
      const strap = box(0.07, 0.34, 0.07, mVest);
      strap.position.set(sx * 0.16 * b, 0.02, 0.16 * b);
      upperTorso.add(strap);
    }
  }

  // --- hood / raised collar behind the neck ---
  if (s.hood != null) {
    const mHood = mat(s.hood);
    const collar = box(0.42 * b, 0.2, 0.2, mHood);
    collar.position.set(0, 0.2, -0.14 * b);
    upperTorso.add(collar);
    const cowl = box(0.34 * b, 0.24, 0.14, mHood);
    cowl.position.set(0, 0.34, -0.18 * b);
    upperTorso.add(cowl);
  }

  // --- long trench coat: panels hung from the torso (front left open so the
  //     legs still read while walking). Attached to `upper` so it swings with
  //     the body, not the legs. ---
  if (s.coat != null) {
    const mCoat = mat(s.coat);
    const coatLen = 0.86 * B.leg;
    const back = box(0.6 * b, coatLen, 0.1, mCoat);
    back.position.set(0, HIP_Y + 0.34 - coatLen / 2, -0.2 * b);
    upper.add(back);
    for (const sx of [-1, 1]) {                               // side flaps
      const flap = box(0.14, coatLen, 0.42 * b, mCoat);
      flap.position.set(sx * 0.3 * b, HIP_Y + 0.34 - coatLen / 2, 0);
      flap.rotation.z = sx * 0.04;
      upper.add(flap);
    }
    const lapel = box(0.5 * b, 0.44, 0.12, mCoat);            // upper front collar
    lapel.position.set(0, HIP_Y + 0.5, 0.16 * b);
    upper.add(lapel);
  }

  // --- utility belt + pouches ---
  if (s.belt != null) {
    const mBelt = mat(s.belt);
    const belt = box(0.5 * b, 0.1, 0.34 * b, mBelt);
    belt.position.y = HIP_Y + 0.12;
    upper.add(belt);
    for (const sx of [-1, 0, 1]) {
      const pouch = box(0.14, 0.16, 0.1, mBelt);
      pouch.position.set(sx * 0.2 * b, HIP_Y + 0.08, 0.18 * b);
      upper.add(pouch);
    }
  }

  // Neck: a real column that rises out of the chest so the head is carried
  // ABOVE the shoulders, not plopped on them. Its base overlaps the chest (no
  // seam) and ~0.10 m of it shows between the collar line and the jaw.
  const neck = limb(0.17, 0.22, 0.17, mSkin, 0.9);
  neck.position.y = HIP_Y + 0.63;
  upper.add(neck);

  // head pivot (lets the head turn/nod independently of the body). Sits at the
  // top of the neck. The head is TALLER than it is wide — a head, not a cube.
  const headPivot = new THREE.Group();
  headPivot.position.y = HIP_Y + 0.74;
  upper.add(headPivot);
  const head = sphereHead(0.32, 0.34, 0.34, mSkin);
  head.position.y = 0.17;
  headPivot.add(head);

  // --- hair ---
  if (s.hair != null) {
    const mHair = mat(s.hair);
    const top = box(0.36, s.hairStyle === 'buzz' ? 0.06 : 0.12, 0.36, mHair);
    top.position.y = s.hairStyle === 'buzz' ? 0.16 : 0.13;
    head.add(top);
    if (s.hairStyle !== 'buzz') {
      const backHair = box(0.36, 0.24, 0.12, mHair);           // covers the back
      backHair.position.set(0, 0.04, -0.15);
      head.add(backHair);
    }
    if (s.hairStyle === 'combed') {                            // side-combed sheen
      const sweep = box(0.38, 0.14, 0.3, mHair);
      sweep.position.set(0.02, 0.11, 0.02);
      sweep.rotation.z = -0.12;
      head.add(sweep);
    }
  }

  // --- face gear ---
  if (s.mask === 'goggles' || s.mask === 'respirator' || s.mask === 'bandana') {
    if (s.mask === 'goggles') {
      const band = box(0.36, 0.1, 0.06, mMask);                // goggle frame
      band.position.set(0, 0.06, 0.17);
      head.add(band);
      for (const sx of [-1, 1]) {
        const lens = box(0.12, 0.09, 0.04, mLens);
        lens.position.set(sx * 0.09, 0.06, 0.2);
        head.add(lens);
      }
    }
    if (s.mask === 'goggles' || s.mask === 'respirator') {
      const resp = box(0.26, 0.14, 0.1, mMask);                // respirator cup
      resp.position.set(0, -0.06, 0.16);
      head.add(resp);
      for (const sx of [-1, 1]) {                              // filter canisters
        const filt = box(0.08, 0.08, 0.08, mMask);
        filt.position.set(sx * 0.15, -0.07, 0.14);
        head.add(filt);
      }
    }
    if (s.mask === 'bandana') {
      const cloth = box(0.34, 0.16, 0.08, mMask);              // cloth over mouth
      cloth.position.set(0, -0.05, 0.13);
      head.add(cloth);
    }
  }

  // ----- arms: shoulder -> upper arm -> elbow -> forearm -> wrist -> hand ------
  const SHOULDER_Y = HIP_Y + 0.52, SHOULDER_X = 0.32 * b;
  const arms = {}, elbows = {};
  let rightWrist = null;
  for (const [name, eName, sx] of [['armL', 'elbowL', -1], ['armR', 'elbowR', 1]]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * SHOULDER_X, SHOULDER_Y, 0);
    upper.add(shoulder);

    // shoulder pad / deltoid cap — rotates with the arm like a pauldron. Sits
    // just below the shoulder joint so it rounds off the deltoid instead of
    // rising above the shoulder line (which reads as football pads).
    const pad = box(0.22 * b, 0.16, 0.3 * b, mPad);
    pad.position.y = -0.07;
    shoulder.add(pad);

    const upperArm = limb(0.16 * b, 0.34, 0.17 * b, mShirt, 0.85);
    upperArm.position.y = -0.2;
    shoulder.add(upperArm);

    const elbow = new THREE.Group();
    elbow.position.y = -0.36;
    shoulder.add(elbow);
    const foreArm = limb(0.14 * b, 0.32, 0.15 * b, mShirt, 0.8);
    foreArm.position.y = -0.16;
    elbow.add(foreArm);
    if (s.pads != null) {                                      // elbow armour accent
      const epad = box(0.16 * b, 0.12, 0.16 * b, mPad);
      epad.position.set(0, -0.02, 0.02);
      elbow.add(epad);
    }

    const wrist = new THREE.Group();
    wrist.position.y = -0.32;
    elbow.add(wrist);
    const hand = box(0.14 * b, 0.16, 0.16 * b, mGlove);
    hand.position.y = -0.08;
    wrist.add(hand);

    arms[name] = shoulder;
    elbows[eName] = elbow;
    if (name === 'armR') rightWrist = wrist;
  }

  // ----- legs: hip -> thigh -> knee -> shin -> ankle -> foot -> toe -----------
  const legs = {}, knees = {}, ankles = {}, toes = {};
  for (const [ln, kn, an, tn, sx] of [
    ['legL', 'kneeL', 'ankleL', 'toeL', -1],
    ['legR', 'kneeR', 'ankleR', 'toeR', 1],
  ]) {
    const hip = new THREE.Group();
    hip.position.set(sx * HIP_X, HIP_Y, 0);
    body.add(hip);

    const thigh = limb(0.21 * b, THIGH_L, 0.23 * b, mPants, 0.82);
    thigh.position.y = -THIGH_L / 2;
    hip.add(thigh);

    // thigh holster (right leg) — a small sidearm rig
    if (s.holster && sx === 1) {
      const rig = box(0.1, 0.22, 0.12, mat(0x14181f));
      rig.position.set(0.16 * b, -THIGH_L * 0.6, 0.04);
      hip.add(rig);
    }

    const knee = new THREE.Group();
    knee.position.y = -THIGH_L;
    hip.add(knee);
    const shin = limb(0.17 * b, SHIN_L, 0.19 * b, mPants, 0.85);
    shin.position.y = -SHIN_L / 2;
    knee.add(shin);
    if (s.kneepads != null) {
      const kp = box(0.19 * b, 0.16, 0.14, mat(s.kneepads));
      kp.position.set(0, -0.08, 0.08 * b);
      knee.add(kp);
    }

    const ankle = new THREE.Group();
    ankle.position.y = -SHIN_L;
    knee.add(ankle);

    // Boot shaft + foot. Sole flush with the ground (bottom at y = -ANKLE_H).
    const shaft = limb(0.18 * b, 0.18, 0.2 * b, mBoot, 0.95);
    shaft.position.y = 0.02;
    ankle.add(shaft);
    const foot = box(0.18 * b, ANKLE_H, 0.24 * b, mBoot);
    foot.position.set(0, -ANKLE_H / 2, 0.05);
    ankle.add(foot);

    // Toe joint at the ball of the foot — where the toes bend on push-off.
    const toe = new THREE.Group();
    toe.position.set(0, -ANKLE_H / 2, 0.17);
    ankle.add(toe);
    const toeBox = box(0.17 * b, ANKLE_H, 0.1, mBoot);
    toeBox.position.set(0, 0, 0.05);
    toe.add(toeBox);

    legs[ln] = hip; knees[kn] = knee; ankles[an] = ankle; toes[tn] = toe;
  }

  // held gun (visual) — parented to the right hand so it tracks the arm
  const gun = new THREE.Group();
  const barrel = box(0.07, 0.07, 0.4, mat(s.gunColor, s.lens, 0.1));
  barrel.position.z = 0.2;
  gun.add(barrel);
  const grip = box(0.06, 0.14, 0.08, mat(0x14181f));
  grip.position.y = -0.08;
  gun.add(grip);
  gun.position.set(0, -0.1, 0.14);
  rightWrist.add(gun);

  g.traverse((o) => { o.castShadow = true; });
  g.scale.setScalar(scale);

  return {
    group: g,
    parts: {
      body, torso: upper, pelvis, lowerTorso, upperTorso, neck, headPivot, head,
      ...arms, ...elbows, ...legs, ...knees, ...ankles, ...toes,
      cape: null, gun,
    },
  };
}

// ---------------------------------------------------------------------------
// A four-legged attack dog for the handler enemy class. Simple procedural body;
// returns { group, parts } where parts exposes the leg pivots + head for a
// trotting animation (see animateDog).
// ---------------------------------------------------------------------------
export function buildDog(spec = {}) {
  const coat = spec.coat ?? 0x2a241f;
  const mCoat = mat(coat);
  const mDark = mat(0x140f0c);
  const g = new THREE.Group();

  const BODY_Y = 0.52;
  const body = box(0.34, 0.34, 0.9, mCoat);
  body.position.set(0, BODY_Y, 0);
  g.add(body);
  const chest = box(0.36, 0.36, 0.4, mCoat);
  chest.position.set(0, BODY_Y + 0.02, 0.32);
  g.add(chest);

  // neck + head reaching forward
  const neck = box(0.22, 0.24, 0.26, mCoat);
  neck.position.set(0, BODY_Y + 0.16, 0.5);
  neck.rotation.x = -0.5;
  g.add(neck);
  const headPivot = new THREE.Group();
  headPivot.position.set(0, BODY_Y + 0.26, 0.66);
  g.add(headPivot);
  const head = box(0.26, 0.24, 0.3, mCoat);
  headPivot.add(head);
  const snout = box(0.16, 0.14, 0.2, mDark);
  snout.position.set(0, -0.03, 0.2);
  head.add(snout);
  for (const sx of [-1, 1]) {                          // ears
    const ear = box(0.08, 0.14, 0.06, mDark);
    ear.position.set(sx * 0.09, 0.18, -0.02);
    head.add(ear);
    const eye = box(0.05, 0.05, 0.03, mat(0x000000, 0xff3020, 1.6));
    eye.position.set(sx * 0.08, 0.02, 0.15);
    head.add(eye);
  }

  // tail
  const tail = box(0.08, 0.08, 0.3, mCoat);
  tail.geometry.translate(0, 0, -0.15);
  tail.position.set(0, BODY_Y + 0.12, -0.45);
  tail.rotation.x = 0.6;
  g.add(tail);

  // four legs (hip pivots for a trot)
  const legPivots = {};
  const LEG_L = BODY_Y - 0.02;
  for (const [name, sx, sz] of [
    ['flL', -1, 0.3], ['frL', 1, 0.3], ['blL', -1, -0.3], ['brL', 1, -0.3],
  ]) {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.14, BODY_Y - 0.02, sz);
    g.add(hip);
    const leg = box(0.1, LEG_L, 0.12, mCoat);
    leg.position.y = -LEG_L / 2;
    hip.add(leg);
    const paw = box(0.12, 0.08, 0.16, mDark);
    paw.position.set(0, -LEG_L, 0.02);
    hip.add(paw);
    legPivots[name] = hip;
  }

  g.traverse((o) => { o.castShadow = true; });
  return { group: g, parts: { headPivot, tail, ...legPivots } };
}

// ---------------------------------------------------------------------------
// HIT FLASH — brief emissive "pop" on any mesh that gets hit. Collects every
// material once (heroes/enemies/dogs share a handful of MeshStandardMaterials),
// stashes their original emissive so it can be restored, and drives a fast
// white flash on trigger(). Works on any object tree, not just this rig.
// ---------------------------------------------------------------------------
export function collectFlashMaterials(root) {
  const set = new Set();
  root.traverse((o) => {
    const m = o.material;
    if (!m) return;
    if (Array.isArray(m)) m.forEach((x) => set.add(x));
    else set.add(m);
  });
  return [...set].map((m) => ({ m, hex: m.emissive ? m.emissive.getHex() : 0, ei: m.emissiveIntensity ?? 1 }));
}

export class HitFlash {
  constructor(root, color = 0xffffff) {
    this.mats = collectFlashMaterials(root);
    this.color = color;
    this.t = 0;
    this.dur = 0.09;
    this.active = false;
  }
  trigger(dur = 0.09, color = this.color) {
    this.t = this.dur = dur;
    this.color = color;
    this.active = true;
  }
  update(dt) {
    if (!this.active) return;
    this.t -= dt;
    if (this.t > 0) {
      const k = this.t / this.dur;
      for (const r of this.mats) {
        if (!r.m.emissive) continue;
        r.m.emissive.setHex(this.color);
        r.m.emissiveIntensity = 0.4 + 2.4 * k;
      }
    } else {
      for (const r of this.mats) {
        if (!r.m.emissive) continue;
        r.m.emissive.setHex(r.hex);
        r.m.emissiveIntensity = r.ei;
      }
      this.active = false;
    }
  }
}

export function animateDog(parts, t, moving) {
  const f = 10, amp = moving ? 0.7 : 0;
  parts.flL.rotation.x = Math.sin(t * f) * amp;
  parts.brL.rotation.x = Math.sin(t * f) * amp;
  parts.frL.rotation.x = -Math.sin(t * f) * amp;
  parts.blL.rotation.x = -Math.sin(t * f) * amp;
  parts.tail.rotation.z = Math.sin(t * 12) * 0.3;
  parts.headPivot.rotation.x = moving ? 0.1 + Math.sin(t * 6) * 0.05 : Math.sin(t * 2) * 0.05;
}

// ---------------------------------------------------------------------------
// ANIMATION
// Thin wrapper over the layered pose player in anim.js. Callers keep passing
// a state bag; the player picks locomotion, then overlays aim/attack/block.
//
// Standing invariant: when idle (not moving, crouch 0, grounded), every leg
// joint is 0 so the soles sit on the floor by construction.
// ---------------------------------------------------------------------------
export function animateHumanoid(parts, t, state) {
  poseHumanoid(parts, t, state || {});
}

// ---------------------------------------------------------------------------
// EXAMPLE SPECS — starting points. Open index.html to author your own and
// copy the JSON straight into your game.
// ---------------------------------------------------------------------------
export const EXAMPLE_SPECS = {
  operative: {
    name: 'OPERATIVE', build: 'hero',
    skin: 0xa5714a, hair: 0x161210, hairStyle: 'buzz',
    mask: 'respirator', maskColor: 0x30353b, lens: 0x3cf0ff,
    shirt: 0x2b3a55, hood: 0x1f2b40, pants: 0x3a3d45, vest: 0x45503a,
    gloves: 0x14181f, boots: 0x141518, kneepads: 0x2b2f26, belt: 0x3d3f2c,
    holster: true, gunColor: 0x2a2f36,
  },
  detective: {
    name: 'DETECTIVE', build: 'normal',
    skin: 0xd8a878, hair: 0x3a2a1a, hairStyle: 'combed',
    mask: 'goggles', maskColor: 0x2a2e34, lens: 0xffb347,
    shirt: 0x4d4038, coat: 0x6b5a44, pants: 0x2a2d33, pads: 0x8a5a3a,
    gloves: 0x1d1e22, boots: 0x1a1a1e, belt: 0x2a1c12, gunColor: 0x2a2f36,
  },
  runner: { name: 'RUNNER', build: 'light', skin: 0x8a5a3a, hair: 0x101014, mask: 'bandana', maskColor: 0x8a2f5f, shirt: 0x2f6b6b, pants: 0x1d1e22 },
  bruiser: { name: 'BRUISER', build: 'heavy', skin: 0xc79066, hair: null, hairStyle: 'buzz', shirt: 0x7a7a3a, pants: 0x4a3c2a, gloves: 0xc79066 },
};

const SHIRTS = [0x2f6b6b, 0x51407a, 0xb5772a, 0x3f6b3a, 0x8a2f5f, 0x6b3320, 0x2a4d63, 0x7a7a3a, 0x8a3a2a, 0x455066];
const PANTS = [0x3a3d45, 0x4a3c2a, 0x2a2d33, 0x55502f, 0x1d1e22, 0x3a4457, 0x4d4038];
const SKIN_TONES = [0xd8a878, 0xc79066, 0xa5714a, 0x8a5a3a, 0x6f4326];
const HAIR_TONES = [0x161210, 0x2a1c12, 0x3a2a1a, 0x555049, 0x101014];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** A random street-clothes NPC, so no two crowd members look identical. */
export function randomSpec(build = pick(['normal', 'light', 'heavy'])) {
  const skin = pick(SKIN_TONES);
  return {
    name: 'NPC', build, skin,
    hair: Math.random() < 0.2 ? null : pick(HAIR_TONES),
    hairStyle: pick(['short', 'combed', 'buzz']),
    mask: Math.random() < 0.3 ? 'bandana' : 'none', maskColor: 0x1c1c20,
    shirt: pick(SHIRTS), pants: pick(PANTS),
    boots: 0x1a1a1e, gloves: Math.random() < 0.5 ? 0x1a1a1e : skin,
  };
}
