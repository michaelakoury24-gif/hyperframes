// The scene, and nothing that reads the clock. `poseAt(t)` sets every moving
// thing from `t` alone, so any frame can be drawn on its own, in any order, on
// any worker. Everything you animate goes through it.

export const DURATION = 6;

export function createScene(THREE, { aspect, variables = {} }) {
  const num = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const colour = (value, fallback) => {
    const parsed = new THREE.Color();
    try {
      parsed.set(value ?? fallback);
    } catch {
      parsed.set(fallback);
    }
    return parsed;
  };

  const spin = num(variables.spin, 0.55, -2, 2);
  const keyColour = colour(variables.keyColor, "#ffd9b0");
  const roughness = num(variables.roughness, 0.45, 0.05, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0d1014");
  scene.environment = studioEnvironment(THREE);
  scene.environmentIntensity = 0.6;

  const camera = new THREE.PerspectiveCamera(32, aspect, 0.1, 200);
  camera.position.set(0, 2.4, 8.2);
  camera.lookAt(0, 1.1, 0);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ color: "#12151a", roughness: 0.92 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(1.9, 2, 0.45, 96),
    new THREE.MeshStandardMaterial({ color: "#33373d", roughness: 0.6 }),
  );
  plinth.position.y = 0.225;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  scene.add(plinth);

  // One hero object. A second one competes with it for attention.
  const hero = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.52, 0.17, 220, 32),
    new THREE.MeshStandardMaterial({ color: "#d9a94e", metalness: 1, roughness }),
  );
  hero.castShadow = true;
  hero.receiveShadow = true;
  scene.add(hero);

  // Warm key, cool rim, dark environment: the standard three-point read. Roughness
  // above ~0.45 keeps glossy metal from streaking white under a low key.
  const key = new THREE.SpotLight(keyColour, 140);
  key.position.set(-4, 6.5, 3.5);
  key.angle = 0.55;
  key.penumbra = 0.45;
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0002;
  key.target.position.set(0, 1.1, 0);
  scene.add(key, key.target);

  const rim = new THREE.DirectionalLight("#bcd2ff", 1.4);
  rim.position.set(4, 3.5, -5);
  scene.add(rim);
  scene.add(new THREE.AmbientLight("#8fa3c0", 0.25));

  function poseAt(t) {
    // Clamped, so a seek past the end holds the last frame instead of drifting on,
    // and a NaN from a bad variable lands on frame 0 rather than a black canvas.
    const time = Number.isFinite(t) ? Math.min(Math.max(t, 0), DURATION) : 0;
    // Smoothstep on the normalised time: no delta, nothing accumulated between frames.
    const p = time / DURATION;
    const eased = p * p * (3 - 2 * p);

    hero.position.y = 1.45 + 0.06 * Math.sin(time * 1.2);
    hero.rotation.set(0.32, time * spin, 0.12 * Math.sin(time * 0.7));

    camera.position.set(
      Math.sin(-0.18 + 0.36 * eased) * 8.2,
      2.45 - 0.5 * eased,
      Math.cos(-0.18 + 0.36 * eased) * 8.2,
    );
    camera.lookAt(0, 1.15, 0);
    camera.updateMatrixWorld();
    scene.updateMatrixWorld(true);
  }

  return { scene, camera, poseAt };
}

// A dark studio with a warm and a cool light strip, as an equirect texture. Built
// from numbers, so it loads nothing over the network and never differs per run.
function studioEnvironment(THREE) {
  const width = 256;
  const height = 128;
  const pixels = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      const warm = Math.exp(-(((u - 0.2) / 0.06) ** 4) - ((v - 0.32) / 0.12) ** 4) * 4;
      const cool = Math.exp(-(((u - 0.7) / 0.04) ** 4) - ((v - 0.38) / 0.16) ** 4) * 2.2;
      const base = 0.05 + 0.08 * Math.max(0, Math.cos(v * Math.PI));
      const i = (y * width + x) * 4;
      pixels[i] = base + warm + cool * 0.7;
      pixels[i + 1] = base + warm * 0.86 + cool * 0.85;
      pixels[i + 2] = base + warm * 0.66 + cool;
      pixels[i + 3] = 1;
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.needsUpdate = true;
  return texture;
}
