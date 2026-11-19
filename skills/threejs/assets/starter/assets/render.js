// Draws the scene for HyperFrames. Copy this file as is and edit `scene.js`.
//
// The whole contract is here:
//   - setup is one promise in `window.__hf.buildReady`, so the first seek waits for
//     the meshes and shader compiles instead of capturing an empty canvas;
//   - frames are drawn only in the `hf-seek` listener, from `event.detail.time`;
//   - each seek registers its frame with `event.detail.waitUntil(promise)`, and is
//     queued behind the previous one, so nothing is captured half-drawn;
//   - nothing reads a clock or runs an animation loop.
import * as THREE from "three";
import { createScene } from "./scene.js";

const READY_KEY = "threejs-starter";
const root = document.querySelector("[data-composition-id]");
const canvas = document.getElementById("scene-canvas");
const width = Number(root.dataset.width);
const height = Number(root.dataset.height);

const variables = window.__hyperframes?.getVariables?.() ?? {};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(width, height, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const { scene, camera, poseAt } = createScene(THREE, { aspect: width / height, variables });

let shownTime = null;
const pixel = new Uint8Array(4);

// gl.finish() can return before a software GPU has run the queued work; reading one
// pixel back cannot, so the frame is really on the canvas when this returns.
function waitForGpu() {
  const gl = renderer.getContext();
  renderer.setRenderTarget(null);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
}

async function setup() {
  // The first frame a renderer draws differs from later ones (shader warm-up, first
  // texture uploads), so compile everything now and draw one throwaway frame.
  poseAt(0);
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);
  waitForGpu();
}

function draw(time) {
  if (time === shownTime) return;
  shownTime = null;
  poseAt(time);
  renderer.render(scene, camera);
  waitForGpu();
  shownTime = time;
}

const ready = setup();
window.__hf = window.__hf || {};
window.__hf.buildReady = window.__hf.buildReady || {};
window.__hf.buildReady[READY_KEY] = ready;

let queue = ready;
window.addEventListener("hf-seek", (event) => {
  const { time } = event.detail;
  // Registered synchronously: the runtime waits on this before capturing.
  queue = queue
    .catch(() => {})
    .then(() => ready)
    .then(() => draw(time));
  event.detail.waitUntil(queue);
});
