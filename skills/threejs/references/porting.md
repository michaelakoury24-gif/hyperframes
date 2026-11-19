# Porting an existing three.js demo

A three.js example is written to run on its own: a render loop, `OrbitControls`, a `Clock` for mixers, loaders that fire whenever they finish, and a `resize` handler. Four of those five must go. The scene graph and the materials rarely need to change.

Take the code as is where you can, and delete the clock. `/remotion-to-hyperframes` calls this the Hosted level: you keep the code and drive it from HyperFrames time, so timing, position and exposed parameters stay editable afterwards.

## 1. Find every clock and delete it

Grep the source for these before reading any more of it:

```bash
grep -n "requestAnimationFrame\|setAnimationLoop\|Clock\|getDelta\|getElapsedTime\|performance.now\|Date.now\|setTimeout\|setInterval\|Math.random" demo.js
```

| Found                                                                | Replace with                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `renderer.setAnimationLoop(render)` / a `requestAnimationFrame` loop | the `hf-seek` listener; `render` becomes `draw(time)`                                      |
| `const clock = new THREE.Clock()` + `clock.getDelta()`               | the frame's `time` argument; `delta` is `1 / fps` when a physical step genuinely needs one |
| `clock.getElapsedTime()`                                             | `time`                                                                                     |
| mixer updates                                                        | `mixer.setTime(time)`, not `mixer.update(delta)` — see "Animation clips" below             |
| `Math.random()`                                                      | a seeded PRNG (`mulberry32`)                                                               |
| `setTimeout(fn, ms)` for a delayed reveal                            | an `if (t > when)` branch inside `poseAt`                                                  |

`THREE.Clock` is the most common single failure: it reads `performance.now()`, which during a render is the seek time and does not advance between seeks, so `getDelta()` returns 0 after the first frame and the animation freezes.

## 2. Turn the loop into a pose function

Before:

```js
function animate() {
  const dt = clock.getDelta();
  t += dt;
  mesh.rotation.y += dt * 0.6;
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
```

After:

```js
function poseAt(time) {
  mesh.rotation.y = time * 0.6; // absolute
  camera.position.copy(cameraTrack(time)); // from OrbitControls, see below
  camera.lookAt(target);
  camera.updateMatrixWorld();
}

function draw(time) {
  poseAt(time);
  renderer.render(scene, camera);
  readOnePixelBack(renderer);
}
```

Anything that was `x += rate * dt` becomes `x = start + rate * time`; anything that was oscillating becomes `Math.sin(time * k)`. If a value must react to the previous one (a spring, a trail), either solve it in closed form or precompute it once at load — see `authoring.md`, "Motion that is a function of time".

## 3. OrbitControls

`OrbitControls` reads pointer events, damps over frames and calls into the DOM. During a render nothing drags it, and `controls.update()` with damping enabled advances a few frames' worth of inertia, which differs by seek order.

Use it as a **pose source**, not as a driver:

```js
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
controls.autoRotate = false;

// Choose the shot once: where the demo's camera sits, the film decides.
const start = { radius: 6, theta: 0.4, phi: 1.15 };
const end = { radius: 3.4, theta: 0.9, phi: 1.35 };

function poseAt(t) {
  const p = clamp01(t / DURATION);
  const eased = p * p * (3 - 2 * p);
  const radius = start.radius + (end.radius - start.radius) * eased;
  const theta = start.theta + (end.theta - start.theta) * eased;
  const phi = start.phi + (end.phi - start.phi) * eased;
  camera.position.set(
    radius * Math.sin(phi) * Math.sin(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.cos(theta),
  );
  camera.lookAt(controls.target);
  camera.updateMatrixWorld();
}
```

Keep the controls object if you need `controls.target` and the min/max clamps; drop the `addEventListener("change", render)` wiring, which is a render loop in disguise.

For a demo whose whole appeal is the user spinning the object, choreograph the spin: a full turn over the clip with a slow start, and a slight tilt so the top and bottom are both visible.

## 4. Animation clips (GLTF, FBX, skinned meshes)

```js
const mixer = new THREE.AnimationMixer(gltf.scene);
const action = mixer.clipAction(gltf.animations[0]);
action.play();
action.paused = true; // the mixer is a pose, not a player

function draw(time) {
  mixer.setTime(time % action.getClip().duration); // absolute; loops by modulo
  renderer.render(scene, camera);
}
```

- `mixer.setTime(t)` is absolute and seekable; `mixer.update(delta)` is not.
- `.play()` is required before `setTime` has an effect, and `paused = true` stops it advancing on its own.
- Morph targets, `MorphTargetInfluences` and skinned bindings all follow the mixer, so nothing else needs changing.
- Blender/C4D exports: keep the export's frame rate equal to the composition's (`data-fps`), or the clip plays at the wrong speed.

## 5. Loaders

Loaders fire callbacks whenever they finish, which is usually after the first seek. Move them into the setup promise:

```js
const ready = (async () => {
  const gltf = await new GLTFLoader().loadAsync(asset("model.glb"));
  scene.add(gltf.scene);
  ...
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);
  readOnePixelBack(renderer);
})();
window.__hf.buildReady["demo"] = ready;
```

- Copy the model and its textures into `assets/` and reference them relatively. A demo that fetches from a CDN fails in a locked-down render box, and `three` itself must come from the import map (pinned), not an `import` of a bare CDN URL — although a CDN URL in an `import` line does work, it breaks the version pin.
- Convert `.hdr` to a local `.exr`/`.hdr` in `assets/`, or build the environment from numbers (the starter's `studioEnvironment`) — a remote HDRI is a render-time fetch.
- Draco/KTX2 decoders: see `contract.md`.

## 6. The stage

The demo's `<canvas>` becomes a timed clip on a composition root, and the root needs `data-no-timeline` (no GSAP timeline here):

```html
<div
  id="root"
  data-composition-id="main"
  data-start="0"
  data-duration="6"
  data-width="1920"
  data-height="1080"
  data-no-timeline
>
  <canvas
    id="scene-canvas"
    class="clip"
    data-start="0"
    data-duration="6"
    data-track-index="1"
  ></canvas>
</div>
```

- `renderer.setPixelRatio(1)` and `setSize(data-width, data-height, false)`.
- Delete the demo's `resize` handler, or make it size from `canvas.clientWidth` only.
- The demo's GUI (`lil-gui`, dat.GUI, a stats panel) comes out; expose at most three of its knobs as composition variables (`data-composition-variables`), read through `window.__hyperframes.getVariables()`. A `/stats` panel and a debug axis helper never ship.

## 7. Verify the port

```bash
npx hyperframes check --json
npx hyperframes snapshot --at 3,1,3 --no-end
```

The two stills at 3 s must be byte-identical, and each still must show the scene at that time — not frame 0. If the scene appears frozen, a clock survived; if the stills differ, something is accumulating state or reading randomness.

Then compare against the demo running live: open the original, pause it at an equivalent moment, and match the framing. The port should look like the demo, at the times the clip chooses.
