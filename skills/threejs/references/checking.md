# Checking a 3D composition

A 3D scene fails quietly: the file plays, the render exits 0, and the video is a black rectangle. Check the pixels, and check that the same time gives the same pixels.

## The four checks

```bash
npx hyperframes lint                    # static: the composition contract
npx hyperframes check --json            # browser: runtime errors, layout, motion, contrast
npx hyperframes snapshot --at 4,0,4 --no-end
npx hyperframes render --output out.mp4
```

`snapshot --at 4,0,4` draws 4 s, then 0 s, then 4 s again in one run. **The two stills at 4 s must be byte-identical.** If they differ, the scene is reading something other than time — most often a retained clock, an accumulating angle, or `Math.random()`.

Then open the stills (`snapshot` writes them beside the project) and look:

| What you see                                           | Cause                                                                          | Fix                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Black or empty frame                                   | capture ran before setup, or `preserveDrawingBuffer: false`                    | register the setup as `buildReady`, render one throwaway frame in it, set `preserveDrawingBuffer: true` |
| Frame 0 everywhere; the scene never moves              | a `Clock`/`performance.now()` survived, or the seek listener does nothing      | pose from `event.detail.time`; see `porting.md` §1                                                      |
| Two stills at one time differ                          | accumulation (`+=`), unseeded `Math.random()`, or a `Date.now()`-driven shader | closed-form pose; seeded PRNG                                                                           |
| Everything washed out or grey                          | colour space: textures without `SRGBColorSpace`, or tone mapping off           | set `texture.colorSpace = THREE.SRGBColorSpace`, `renderer.toneMapping = ACESFilmicToneMapping`         |
| Object invisible but lights work                       | camera outside the scene, or a `NaN` in a transform                            | log `camera.position` and the object's matrix in setup; clamp every division                            |
| Whole frame black except the glow                      | a `NaN` propagated through bloom                                               | clamp the value that divides; bloom threshold high                                                      |
| Hard diagonal seam across the frame                    | two workers drew different scenes (randomness), or a half-drawn frame          | seed the build; `readOnePixelBack` per frame                                                            |
| Shadow acne, or a shadow floating away from the object | shadow map bias / size                                                         | `shadow.bias = -0.0002`, `mapSize 1024`, keep the light's `target` inside the scene                     |
| The scene renders in preview but is empty in `render`  | the import map or an asset URL was unreachable from the render box             | vendor three into `assets/vendor/` (`contract.md`, "Offline projects") and keep every asset relative    |

## Read the console, not just the exit code

`npx hyperframes check --json` reports page errors and the readiness it waited on. Two entries matter most:

- `window.__hf.buildReady["<key>"] rejected` — your setup threw; the message carries the reason.
- `seek did not settle within <n> ms: still waiting on hf-seek` — a `waitUntil` promise never resolved. A deadlock in the seek queue looks exactly like a slow frame; check that every queued promise can settle, and that no seek awaits a later seek.

## Slow frames

A frame that takes 400 ms does not fail; it just makes the render 12 s longer per second of video, and on a machine without a GPU (CI, Docker, a cloud worker) it is the whole render. Profile the heaviest moment once:

```js
const started = performance.now(); // only while debugging, never in the shipped file
renderer.render(scene, camera);
console.log("frame ms", performance.now() - started);
```

Usual causes, in order: shadow map size, antialiasing plus a high pixel ratio, a bloom pass at full resolution, more than ~200k triangles, and per-frame geometry rebuilds (`new Geometry` inside `draw` — build it once in setup).

## Determinism on a machine without a GPU

Chrome draws WebGL in software (SwiftShader) when there is no GPU. It is 10–50× slower and its first shader run is the slowest thing in the render. Two consequences:

- The default 45 s readiness wait can be too short for a heavy scene. Raise it: `--timeout 170000` for `check` and `snapshot`, `--player-ready-timeout 180000` for `render`.
- Keep `readOnePixelBack` in the draw path. On SwiftShader, `gl.finish()` can return before the queued work has run, and the captured frame is then the previous one.
