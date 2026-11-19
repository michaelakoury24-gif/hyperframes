# The render contract, in code

The entry file states the rules. This file shows what each one costs when it is broken, and what the code looks like when it holds. `assets/starter/assets/render.js` in this skill is the whole thing, working.

## What the runtime gives you

| Signal                                  | When                               | What to do with it                                                                                   |
| --------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `hf-seek` event, `event.detail.time`    | every seek, including the first    | draw exactly that time                                                                               |
| `window.__hfThreeTime`                  | same seek                          | read it if your code has no event in scope (a helper deep in a scene)                                |
| `event.detail.waitUntil(promise)`       | inside the listener, synchronously | the runtime holds capture until it settles                                                           |
| `window.__hf.buildReady["<key>"]`       | registered during setup            | the first seek waits for it, and a rejection fails the render by name                                |
| `THREE.DefaultLoadingManager` in flight | any time                           | the render waits (the built-in three adapter), so your loader's assets do not need their own promise |

`hf-seek` is deduplicated by exact time equality: seeking to 4.0 twice fires one event. That is why the hand-written `if (time === shownTime) return` in the starter is a cheap win rather than a correctness fix — but keep it, the runtime force-dispatches a second event at the same time after injecting decoded video frames (see [video textures](#video-textures)).

## The searcher: what breaks and how it shows

| In the code                                                           | What the render does                                                                                                                               |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderer.setAnimationLoop(render)` or a `requestAnimationFrame` loop | Frames come out at whatever pose the loop reached. Often all identical, because `requestAnimationFrame` callbacks wait for a seek during a render. |
| `clock.getDelta()` added to `rotation.y`                              | Each frame advances by the previous frame's gap, not by `1/fps`; the loop drifts and a repeat seek gives a different angle.                        |
| `Date.now()` / `performance.now()` in the pose                        | Frozen at the seek time: every frame after the first reads the same value, so the motion stops.                                                    |
| `Math.random()` in animation or geometry                              | Every worker draws different pixels; a render split across workers shows seams.                                                                    |
| `await fetch(...)` or a loader inside a seek                          | The frame is captured before the texture lands, or the seek fails. Load in setup.                                                                  |
| No `data-no-timeline` on a root with no GSAP timeline                 | The producer polls for a timeline for 45 s per render, then continues.                                                                             |
| `preserveDrawingBuffer: false` and `alpha: false`                     | Captures can come back blank or stale. The starter sets it; a WebGLRenderer you keep must too.                                                     |

## The shape that works

```js
import * as THREE from "three";

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(width, height, false);

const { scene, camera, poseAt } = createScene(THREE, { aspect: width / height, variables });

async function setup() {
  poseAt(0);
  await renderer.compileAsync(scene, camera); // every shader, before the first real frame
  renderer.render(scene, camera); // the first frame differs; burn it here
  readOnePixelBack(renderer); // and make the GPU finish it
}

const ready = setup();
window.__hf = window.__hf || {};
window.__hf.buildReady = window.__hf.buildReady || {};
window.__hf.buildReady["my-scene"] = ready;

let queue = ready;
window.addEventListener("hf-seek", (event) => {
  const time = event.detail.time;
  queue = queue
    .catch(() => {})
    .then(() => ready)
    .then(() => draw(time));
  event.detail.waitUntil(queue); // synchronous, before any await
});
```

Three details that are easy to lose:

- **`waitUntil` must be called synchronously** from the listener. Calling it after an `await` throws `hf-seek waitUntil() must be called synchronously from the event listener`, and the runtime captures without waiting.
- **`queue` is the serialisation.** A seek while the previous frame is still drawing must not draw both at once — WebGL state is shared.
- **`ready` is awaited again inside the queue.** The first seek can arrive before setup finished; the promise is already settled by then.

## Reading the GPU back

`renderer.render()` returns after queueing; `gl.finish()` may return before a software GPU has run the work. Reading one pixel blocks until it has:

```js
const pixel = new Uint8Array(4);
function readOnePixelBack(renderer) {
  const gl = renderer.getContext();
  renderer.setRenderTarget(null);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
}
```

This is the difference between a correct render and an occasional half-drawn frame on SwiftShader (no GPU: Docker, CI, a cloud worker). It costs a millisecond on a real GPU.

## Async setup

Anything that is not ready at module evaluation goes into the same `buildReady` promise:

```js
const ready = (async () => {
  const gltf = await loader.loadAsync(new URL("../assets/hero.glb", import.meta.url).href);
  scene.add(gltf.scene);
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);
  readOnePixelBack(renderer);
})();
window.__hf.buildReady["hero"] = ready;
```

Paths: `assets/...` relative to the project, or `new URL(..., import.meta.url)` from a module in `assets/`. Never a leading `/`, never a network URL at render time. A `buildReady` promise that rejects is reported as `window.__hf.buildReady["hero"] rejected`, so the failure names the piece.

If you need several independent pieces, register several keys — the runtime waits for all of them.

## Video textures

A `<video>` element that HyperFrames owns is seeked and injected per frame by the engine, and the texture must be re-uploaded after that injection. Two things make it work:

```js
const texture = new THREE.VideoTexture(video);
texture.colorSpace = THREE.SRGBColorSpace;

function draw(time) {
  if (video.readyState >= 2) texture.needsUpdate = true; // re-upload this frame's pixels
  poseAt(time);
  renderer.render(scene, camera);
  readOnePixelBack(renderer);
}
```

The engine force-dispatches a second `hf-seek` at the same time once the frames are injected, so a `shownTime` shortcut that swallows duplicate times must still re-upload — key the texture update off `video.currentTime`, not off the seek.

Do not call `play()`, `pause()` or set `currentTime` yourself; the runtime owns media transport. A `<video>` inside a three.js scene is still a normal composition element: `class="clip"`, `data-start`, `data-duration`.

## Offline projects

The starter's import map points at a pinned `three@0.180.0` on jsDelivr, which the compiler already allowlists and a render fetches once at load. A project that must render with no network at all — a locked-down CI box, an air-gapped cloud worker — copies `three.module.js` and `three.core.js` from that same release into `assets/vendor/` and points the map at the local files:

```html
<script type="importmap">
  {
    "imports": {
      "three": "assets/vendor/three.module.js",
      "three/addons/": "assets/vendor/addons/"
    }
  }
</script>
```

`three.module.js` re-exports from `./three.core.js`, so both files are needed, and any addon you import brings its own relative imports (`three` itself) which the map resolves. Copy the licence (`LICENSE` from the package) beside them.

## Loaders and the LoadingManager

Three's `DefaultLoadingManager` is already hooked: while textures or models are in flight the render holds. That is a safety net, not a plan — load everything in `buildReady` so the hold is short and its failure is named.

`TextureLoader`, `GLTFLoader`, `EXRLoader` and `RGBELoader` all report through it. `DRACOLoader`/`KTX2Loader` need their own decoder files copied into `assets/`:

```js
const draco = new DRACOLoader().setDecoderPath("assets/draco/");
const ktx2 = new KTX2Loader().setTranscoderPath("assets/basis/").detectSupport(renderer);
loader.setDRACOLoader(draco).setKTX2Loader(ktx2);
```

Copy the decoder folders from the same `three@0.180.0` release (`examples/jsm/libs/draco/`, `examples/jsm/libs/basis/`). A CDN decoder path works in preview and fails in a locked-down render box.

## WebGPU

`WebGPURenderer` from `three/webgpu` follows the same contract with one difference: `renderer.renderAsync()` replaces `render()` and resolves when the GPU has finished, so no readback is needed.

```js
import * as THREE from "three/webgpu";

const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
await renderer.init();               // in buildReady, not at module top level
...
await renderer.compileAsync(scene, camera);
await renderer.renderAsync(scene, camera);
```

`await renderer.init()` must be inside the `buildReady` promise — at module top level the first seek can race it. If the target machine may not have WebGPU, fall back to `WebGLRenderer` rather than rendering nothing; a black frame is not a graceful degradation.

## Resizing and DPR

Fixed output: `setPixelRatio(1)` and the composition's `data-width`/`data-height`. A `resize` listener and `window.devicePixelRatio` make a render depend on the machine (2× DPR captures a 2× canvas into a 1× frame; the image is cropped). If you keep a resize handler for the Studio preview, size from `canvas.clientWidth`, never from `window.innerWidth`.

## Post-processing

`EffectComposer` with a fixed pass list is fine:

```js
const composer = new EffectComposer(renderer);
composer.setSize(width, height);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.5, 0.4, 0.9));

await renderer.compileAsync(scene, camera); // before the first composer.render()
```

- Keep the pass list fixed over time. Adding or removing a pass recompiles shaders mid-seek and can blow the frame budget.
- Bloom eats detail: keep it to the brightest points, and clamp anything that can divide by zero — one `NaN` pixel turns the whole frame black through bloom.
- Import addon paths through the import map (`three/addons/postprocessing/EffectComposer.js`), so a single version serves both.

## Resolution and cost

A still image and a 30 fps clip cost the same per frame here; a frame that takes 200 ms just makes the render 200 ms longer per frame. Two rules keep it tractable: `renderer.shadowMap.enabled` only if shadows are visible in the shot, and shadow map size at 1024 unless the shot is a close-up (2048 quadruples the shadow pass).
