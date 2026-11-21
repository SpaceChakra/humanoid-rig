# Low-Poly Humanoid Rig + Character Editor (three.js)

One procedural humanoid, dressed up by data. No model files and no animation clips: every character is built from code, and every pose is computed.

From **Anarcontra** (SpaceChakra). **[Open the editor](index.html)** (needs a local server).

## What's in it

- **`characters.js`**: `buildHumanoid(spec)` builds a jointed low-poly person from a **CharacterSpec**: skin, hair and style, face gear (respirator / goggles / bandana), shirt, hood, trench coat, tactical vest, armour pads, knee pads, belt, holster, gloves, boots, and four body builds (normal / hero / heavy / light). Also includes a dog, a `HitFlash` helper (a white flash on damage for any object), example specs and a `randomSpec()` crowd generator.
- **`anim.js`**: a **layered pose player**. Gameplay never touches bones; it passes a state bag and the player blends locomotion (idle / walk / run / crouch / crawl / air), overlays actions (aim, melee, kick, block, reload, surrender) and swaps in a dodge-roll.
- **The ground contract**: hip height is *derived* from the leg lengths, so feet always land exactly on the floor in every build. Nothing floats or clips.
- **`index.html` + `editor.js`**: a character editor. Tweak every field on a live turntable, preview any pose, and **copy the JSON** straight into your game.

## Use

```js
import { buildHumanoid, animateHumanoid, EXAMPLE_SPECS, randomSpec, HitFlash } from './characters.js';

const { group, parts } = buildHumanoid({ ...EXAMPLE_SPECS.operative, shirt: 0x7a2a8a });
scene.add(group);                 // origin = the floor under the feet
const flash = new HitFlash(group);

// each frame
animateHumanoid(parts, time, {
  moving: true,
  speed01: 0.6,      // 0 = walk … 1 = full run
  grounded: true, velY: 0,
  aiming: false, pitch: 0,
  crouch: 0,         // 0..1
  // blocking, melee + attackAnim, kicking, reload, dodge (roll), land,
  // surrendered, strafe, dead: see presetState() in anim.js for every field
});
flash.update(dt);

// on damage
flash.trigger();
```

The pose dropdown in the editor (driven by `POSE_PRESETS` / `presetState()` in `anim.js`) lists every state the pose player understands. Copy those as starting points.

## License

MIT. Made by [SpaceChakra](https://patreon.com/spacechakra).
