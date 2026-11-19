# Authoring a 3D shot

The render contract makes the clip correct. This file is about making it look like a film rather than a spinning default object, and about the motion that reads as depth on a flat screen.

## One hero, one idea

- **One hero object** beats a crowd of them. A second object that competes for the centre of frame splits attention.
- Fly **through or into** the object rather than orbiting it from a fixed radius. One dive is worth ten turns: a continuous approach in which scale, parallax and shadow change together reads as 3D; a turntable reads as a product page.
- Keep an **occluder in front** of the hero for part of the shot — a bar of the set, a foreground edge. Depth cues need something at a different depth.

## Camera

```js
// A dive: distance shrinks, height drops, the aim rises.
const p = clamp01(t / DURATION);
const eased = p * p * (3 - 2 * p); // smoothstep, ends at rest
camera.position.set(
  Math.sin(-0.35 + 0.7 * eased) * (7.4 - 1.6 * eased),
  2.7 - 0.6 * eased,
  Math.cos(-0.35 + 0.7 * eased) * (7.4 - 1.6 * eased),
);
camera.lookAt(0, 1.05, 0);
camera.updateMatrixWorld();
```

- **Ease the camera, never linear-move it.** Real cameras take time to start and stop; a linear dolly looks like a screensaver. Smoothstep is enough; a cubic ease-out for arrivals (`1 - Math.pow(1 - p, 3)`) is snappier.
- **Add one small non-linear orbit** to any travelling move (the `Math.sin` term above). Purely radial moves flatten; a slight arc separates foreground from background.
- **Handheld float** is a sum of sines, not noise: `0.008 * Math.sin(t * 1.7) + 0.005 * Math.sin(t * 3.1 + 1.2)`. Noise sampled per frame is a different value on a repeat seek and breaks determinism.
- **FOV 30–40** for product-like shots (compressed, stable), 60–75 for interiors and corridors. Changing FOV mid-shot is a dolly zoom — use it once, as a beat.
- **Pull the aim point**, not just the position: `lookAt` a target that lags the camera by a beat, so the object settles into the centre rather than being locked there.

## Light

- Three lights, standard read: a **warm key** (slightly above and to one side), a **cool rim** from behind, a **dark environment** with two or three soft strips. The starter's `studioEnvironment()` builds that environment from numbers, so nothing loads from the network.
- **Turn the environment, not the object**, to sweep a highlight across a still surface. Rotating the object to fake it also rotates its silhouette, which reads as the whole scene spinning.
- **Contact shadow** under the hero: a `PlaneGeometry` floor receiving a shadow, or a radial-gradient sprite for cheapness. Without one, everything floats.
- **Glossy metal under a low light streaks white.** `roughness` about 0.45 or more, `scene.environmentIntensity` about 0.5–0.6.
- **Bloom eats detail.** Threshold high enough that only the brightest points glow; and clamp anything that can divide by zero — a single `NaN` pixel turns the frame black through a bloom pass.

## Materials that read as real

- Metalness 1 with roughness under 0.2 needs an environment map or it renders black. Use the studio environment, and keep `metalness` below 1 for anything that is supposed to look like painted metal.
- A clearcoat on a light body (`MeshPhysicalMaterial`, `clearcoat: 1`, `clearcoatRoughness: 0.1`) reads as ceramic/product plastic better than lowering roughness does.
- One saturated accent against a desaturated set. Two saturated colours compete; the hero reads as the one the light is on.
- Textures go through `SRGBColorSpace` (`texture.colorSpace = THREE.SRGBColorSpace`) or the colours land washed out after tone mapping.

## Motion that is a function of time

```js
// Bad: integrates per frame, so the result depends on seek order.
hero.rotation.y += 0.01;

// Good: absolute, from t.
hero.rotation.y = t * spin;

// Good: a cycle, with no accumulated phase.
hero.rotation.y = 0.4 * Math.sin((t / 1.6) * Math.PI * 2);

// Good: a settle that has finished by the time the shot cuts.
const settle = 1 - Math.pow(1 - clamp01((t - 0.6) / 1.4), 3);
hero.position.y = 1.4 - 0.5 * (1 - settle);
```

**Stagger a group** by offsetting each child's phase from its index — `phase = i * 0.12` — and giving every child the same closed-form motion. Never start a `for` loop that mutates state over frames.

**Simulations** (particles, cloth, agents, orbits with gravity): run the whole thing once at load into arrays, then index by `t`:

```js
const path = [];
for (let i = 0; i < frames; i++) path.push(step(previous(i))); // once, in setup

function poseAt(t) {
  const i = Math.min(path.length - 1, Math.max(0, Math.round(t * fps)));
  hero.position.copy(path[i]); // a lookup, not an integration
}
```

That is also what makes a simulation seekable: a lookup has no history requirement, an integration does.

## Text in 3D

- Text on a surface is an HTML overlay in the composition (or a `CanvasTexture` you draw once in setup). Live HTML text inside a WebGL scene needs Chrome's `drawElementImage()` — the "HTML in Canvas" guide on the docs site — and a fallback for builds without it.
- A `CanvasTexture` needs the font loaded before it is drawn: `await document.fonts.load('700 64px "LocalFace"')` inside `buildReady`, then draw and set `needsUpdate = true`.
- Perspective-tilted body text is unreadable. Only generated content tilts.

## Cost

- Shadow maps: `1024` unless the shot is a close-up; `2048` quadruples the shadow pass.
- Antialiasing at 1920×1080: `antialias: true` is usually enough. `pixelRatio` above 1 is 4× the pixels for a marginally sharper frame — not worth it when the output is 1080p.
- `renderer.shadowMap.enabled = false` on shots where no shadow is visible. It is a full extra scene render per frame.
- Instanced meshes for anything repeated more than about 20 times: `InstancedMesh` with `setMatrixAt` per instance from `t`, then `instanceMatrix.needsUpdate = true`.
