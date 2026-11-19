// Guards: skills/threejs/assets/starter/**
//
// The starter is the skill's executable claim: copy it, edit scene.js, and every
// frame renders identically. These tests hold the two halves of that claim — the
// render contract in render.js (static) and pose purity in scene.js (run against
// a stub three, because the real one is 600 KB of CDN URL).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const starter = fileURLToPath(new URL("../assets/starter", import.meta.url));
const read = (path) => readFileSync(join(starter, path), "utf8");

// ── The render contract ──────────────────────────────────────────────────────

test("rendering never waits on frames, the clock or a timer", () => {
  // Comments stripped: the file explains each of these by name, which is the point.
  const source = read("assets/render.js").replace(/^\s*\/\/.*$/gm, "");
  for (const banned of [
    "requestAnimationFrame",
    "setAnimationLoop",
    "performance.now",
    "Date.now",
    "setTimeout",
    "setInterval",
    "THREE.Clock",
    "mixer.update",
  ]) {
    assert.ok(!source.includes(banned), `render.js uses ${banned}`);
  }
  assert.match(source, /window\.__hf\.buildReady\[READY_KEY\] = ready;/);
  assert.match(source, /event\.detail\.waitUntil\(queue\);/);
  assert.match(source, /await renderer\.compileAsync\(scene, camera\);/);
  assert.match(source, /preserveDrawingBuffer: true/);
  // The first frame a renderer draws differs, so setup must burn one.
  assert.match(source, /async function setup\(\)[\s\S]*?renderer\.render\(scene, camera\)/);
  // A GPU submit can outlive render(); one pixel back cannot.
  assert.match(source, /gl\.readPixels\(/);
  // A seek that arrives mid-draw must not draw concurrently.
  assert.match(source, /queue = queue\s*\.catch/);
});

test("the page pins three, and the scene reads nothing but time", () => {
  const html = read("index.html");
  const imports = JSON.parse(
    html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1],
  ).imports;
  // An unpinned CDN specifier renders differently next month.
  assert.match(imports.three, /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@\d+\.\d+\.\d+\//);
  assert.match(
    imports["three/addons/"],
    /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@\d+\.\d+\.\d+\//,
  );
  // Same version in both halves of the map, or two copies load.
  assert.equal(
    imports.three.match(/three@([\d.]+)/)[1],
    imports["three/addons/"].match(/three@([\d.]+)/)[1],
  );

  // No GSAP timeline here, so the producer must not poll 45 s for one.
  assert.match(html, /data-composition-id="main"[\s\S]{0,200}data-no-timeline/);
  // A finite root duration is what the clip is cut to.
  assert.match(html, /data-duration="\d+(\.\d+)?"/);

  const scene = read("assets/scene.js");
  for (const banned of [
    "performance.now",
    "Date.now",
    "Math.random",
    "requestAnimationFrame",
    "new THREE.Clock",
  ]) {
    assert.ok(!scene.includes(banned), `scene.js uses ${banned}`);
  }
});

// ── Pose purity, against a stub three ────────────────────────────────────────

const vec = (x = 0, y = 0, z = 0) => ({
  x,
  y,
  z,
  set(a = 0, b = 0, c = 0) {
    this.x = a;
    this.y = b;
    this.z = c;
    return this;
  },
});

class Object3D {
  constructor() {
    this.position = vec();
    this.rotation = vec();
    this.scale = vec(1, 1, 1);
    this.children = [];
  }
  add(...objects) {
    this.children.push(...objects);
    return this;
  }
  updateMatrixWorld() {}
}

class Colour {
  constructor(value = "#ffffff") {
    this.set(value);
  }
  set(value) {
    if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) {
      throw new Error(`three: unknown colour ${value}`);
    }
    this.value = value;
    return this;
  }
}

const geometry = class {
  constructor(...args) {
    this.args = args;
  }
};

class Material {
  constructor(params = {}) {
    Object.assign(this, params);
  }
}

const THREE = {
  Scene: class extends Object3D {},
  Color: Colour,
  PerspectiveCamera: class extends Object3D {
    constructor(fov, aspect, near, far) {
      super();
      Object.assign(this, { fov, aspect, near, far });
    }
    lookAt() {}
  },
  Mesh: class extends Object3D {
    constructor(geo, material) {
      super();
      Object.assign(this, { geometry: geo, material });
    }
  },
  PlaneGeometry: geometry,
  CylinderGeometry: geometry,
  TorusKnotGeometry: geometry,
  MeshStandardMaterial: Material,
  SpotLight: class extends Object3D {
    constructor(colour, intensity) {
      super();
      Object.assign(this, {
        colour,
        intensity,
        target: new Object3D(),
        shadow: { mapSize: vec(), bias: 0 },
      });
    }
  },
  DirectionalLight: class extends Object3D {},
  AmbientLight: class extends Object3D {},
  DataTexture: class {
    constructor(pixels, width, height) {
      Object.assign(this, { pixels, width, height });
    }
  },
  RGBAFormat: "RGBAFormat",
  FloatType: "FloatType",
  EquirectangularReflectionMapping: "EquirectangularReflectionMapping",
};

const { createScene, DURATION } = await import(
  new URL("../assets/starter/assets/scene.js", import.meta.url)
);

function poseSnapshot({ scene, camera }) {
  const walk = (object) => ({
    position: { ...object.position },
    rotation: { ...object.rotation },
    scale: { ...object.scale },
    children: object.children.map(walk),
  });
  return JSON.stringify({ camera: walk(camera), scene: walk(scene) });
}

test("a pose depends only on its time, whatever was posed before", () => {
  const scene = createScene(THREE, { aspect: 16 / 9 });
  scene.poseAt(4);
  const atFour = poseSnapshot(scene);
  scene.poseAt(0);
  const atZero = poseSnapshot(scene);
  scene.poseAt(2.5);
  scene.poseAt(4);
  assert.equal(poseSnapshot(scene), atFour, "re-posing 4 s differs from the first 4 s");
  assert.notEqual(atZero, atFour, "every time renders the same pose");
});

test("variables are clamped to their declared ranges", () => {
  const wild = createScene(THREE, { aspect: 16 / 9, variables: { spin: 99, roughness: -4 } });
  const sane = createScene(THREE, { aspect: 16 / 9, variables: { spin: 2, roughness: 0.05 } });
  wild.poseAt(3);
  sane.poseAt(3);
  assert.equal(poseSnapshot(wild), poseSnapshot(sane));
  // A hostile value for a colour falls back instead of throwing mid-render.
  const bad = createScene(THREE, { aspect: 16 / 9, variables: { keyColor: "not a colour" } });
  assert.doesNotThrow(() => bad.poseAt(1));
});

test("the last frame is the end of the shot, and it is a finite time", () => {
  const scene = createScene(THREE, { aspect: 16 / 9 });
  scene.poseAt(DURATION);
  const end = poseSnapshot(scene);
  scene.poseAt(DURATION + 10);
  assert.equal(poseSnapshot(scene), end, "the pose runs past the clip's end");
  scene.poseAt(Number.NaN);
  assert.doesNotThrow(() => poseSnapshot(scene));
});
