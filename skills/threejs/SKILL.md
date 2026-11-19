---
name: threejs
description: Put a Three.js scene in a HyperFrames video so every frame renders identically, or make an existing three.js demo seekable. Use for WebGL 3D shots, product turntables, orbit scenes and any three.js code that must become a video.
---

**Plugin installs:** Inside a HyperFrames plugin, follow [plugin execution rules](../hyperframes/references/plugin-installation.md).

**Usage beacon:** run `npx hyperframes events --skill=threejs` once as this skill starts. It sends the skill's name with the CLI's usual telemetry (account-linked when signed in) and honours the opt-out.

# Three.js

HyperFrames renders by seeking, never by playing: it asks for frame 90, waits, captures, asks for frame 91. A `requestAnimationFrame` loop therefore draws nothing a render can use — the frame it captures is whatever the loop happened to leave behind. Everything here exists to make the scene a function of one number.

The runtime already meets you half way. Every seek dispatches an `hf-seek` event carrying `detail.time` (and sets `window.__hfThreeTime`), and while three's `DefaultLoadingManager` has items in flight the render waits for them. Start the work from there and nothing else.

## Start

- **A new 3D shot.** Copy `assets/starter/` into the project and edit `assets/scene.js`; `assets/render.js` is the contract below, ready as is. It pins `three@0.180.0` in an import map, so the version cannot drift under a render.
- **A named visual.** Search first: `npx hyperframes catalog --query "chrome orb" --json` — about 450 blocks already solve orbit cards, turntables, extruded logos and glass. `npx hyperframes add <name>`.
- **An existing three.js demo.** Read `references/porting.md`: it converts the loop, `OrbitControls`, mixer, loaders and the resize handler without rewriting the scene.
- **Real light** (soft shadows, bounced light, reflections) is `../hyperframes/references/path-tracing.md`, which trades speed for it.

## The contract

1. Setup is one promise on `window.__hf.buildReady["<key>"]`: build the scene, `await renderer.compileAsync(scene, camera)`, draw one throwaway frame. The first frame a renderer draws differs from later ones, and shader compiles are slow enough to matter.
2. Draw only inside the `hf-seek` listener, from `event.detail.time`. Register the work synchronously with `event.detail.waitUntil(promise)` and queue each seek behind the last one.
3. No loop (`renderer.setAnimationLoop`, `requestAnimationFrame`), no `THREE.Clock`, no `THREE.Clock.getDelta()`, no timers. During a render `Date.now()` and `performance.now()` return the seek time and do not move.
4. Everything visible is set from `t`, in one `poseAt(t)` — the scene's only mover. No `+=` on rotation, no velocity integrated per frame, no state that depends on which frame came before.
5. Seed randomness (`mulberry32`), and load every asset before frame 0: no fetch inside a seek. A canvas with no `alpha` needs `preserveDrawingBuffer: true` or captures come back blank.
6. A composition with no GSAP timeline needs `data-no-timeline` on its root, or every render polls 45 s for a timeline that never arrives.

## Piece by piece

- **Camera**: drive `camera.position` and `lookAt` from `t`, then `camera.updateMatrixWorld()`. Handheld float is `Math.sin(t * k)` sums, not noise sampled per frame.
- **Materials**: a surface moves only through what `poseAt` writes — `map.offset` at `t`, an emissive ramp from `t` — and a video texture needs `preserveDrawingBuffer` plus a re-upload on every seek.
- **Simulations**: step them once at load into arrays, then index the array by `t`; never integrate inside a seek.
- **Post-processing**: `EffectComposer` is fine, but compose and render inside the same seek and keep the pass list fixed — adding a pass mid-timeline recompiles mid-frame.

## Check

```bash
npx hyperframes check --json
npx hyperframes snapshot --at 4,0,4 --no-end   # the two stills at 4 s must be byte-identical
```

Then look at the frames themselves: a black still (capture ran before setup), a frozen scene (a clock survived the port), and two different stills at the same time are the three failures this skill exists to prevent. `references/checking.md` has the fixes.

## What to read

| The task                                                                 | Read                      |
| ------------------------------------------------------------------------ | ------------------------- |
| How the seeking runtime meets three, async setup, video textures, WebGPU | `references/contract.md`  |
| Camera, light, materials, the motion that reads as 3D                    | `references/authoring.md` |
| An existing demo's loop, controls, mixers, loaders                       | `references/porting.md`   |
| Verifying frames and fixing a broken still                               | `references/checking.md`  |
