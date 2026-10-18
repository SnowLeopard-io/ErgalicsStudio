// ==========================================================================
// Volumetric cloud plugin — GLSL raymarched sky renderer.
//
// A fullscreen quad ray-marches a flat cloud slab (uCloudBase..uCloudTop) in
// world meters: 3-D value-noise coverage advected by a wind vector, detail
// erosion for wispy edges, Beer–Lambert extinction with dual-lobe
// Henyey–Greenstein phase and a two-tap "light march" toward the sun/moon for
// self-shadowing. The sky gradient, sunset glow and deep-blue night are driven
// by sun/moon direction uniforms computed in TS from real ephemeris formulas
// (`@/core/raytrace/astro`). Stars are intentionally not rendered: the
// procedural star grid dominated the fragment cost on integrated GPUs.
//
// All reusable GLSL (camera ray, noise, blackbody, scatter, tonemap) comes
// from the shared ray-tracing core.
// ==========================================================================

import {
  RT_CAMERA_RAY,
  RT_CAMERA_VERTEX,
  RT_INTERSECT,
  RT_NOISE,
  RT_SCATTER,
  RT_TONEMAP,
} from '@/core/raytrace';

export const CLOUD_VERTEX = RT_CAMERA_VERTEX;

export const CLOUD_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vNdc;

uniform vec3 uSunDir;     // normalised direction toward the sun (world)
uniform vec3 uMoonDir;    // normalised direction toward the moon (world)
uniform vec3 uSunColor;   // pre-tinted sunlight (sunset-aware)
uniform vec3 uMoonColor;  // pre-scaled moonlight
uniform float uNight;     // 0 = full day, 1 = deep night
uniform float uCoverage;  // cloud coverage 0..1
uniform float uDensity;   // extinction multiplier
uniform vec2 uWindOffset; // accumulated wind advection displacement (m, world xz)
uniform float uCloudBase; // slab bottom (m)
uniform float uCloudTop;  // slab top (m)
uniform int uSteps;       // primary raymarch step budget

${RT_CAMERA_RAY}
${RT_NOISE}
${RT_INTERSECT}
${RT_SCATTER}
${RT_TONEMAP}

// ---- cloud density field ------------------------------------------------------
// p: world position (m). Returns the local cloud density (0..1).
float cloudDensity(vec3 p) {
  // Wind advection: the accumulated displacement (m) is integrated in TS from
  // the wind vector, so editing the wind speed changes the drift *rate* from
  // that moment on instead of teleporting the whole field.
  vec3 q = p + vec3(uWindOffset.x, 0.0, uWindOffset.y);
  float h = clamp((p.y - uCloudBase) / max(uCloudTop - uCloudBase, 1.0), 0.0, 1.0);
  float profile = smoothstep(0.0, 0.18, h) * smoothstep(1.0, 0.55, h); // rounded slab
  // 3-D base shape: the vertical axis is scaled tighter (0.0032 vs 0.0011 per
  // metre) so the cells flatten into cumulus-like billows. A 2-D fbm alone
  // extrudes one stamp through the whole slab and reads as a flat smear.
  float base = fbm3(vec3(q.x * 0.0011, q.y * 0.0032, q.z * 0.0011));
  // Contrast expansion + coverage ramp. fbm3 only spans ≈0.13..0.90, so a raw
  // threshold leaves the lower half of the slider almost clear.
  float shaped = (base - 0.535) * 1.8 + 0.535;
  float cov = smoothstep(1.10 - uCoverage, 1.28 - uCoverage, shaped);
  float core = cov * profile;
  // Edge erosion: high-frequency detail bites into the boundary while interiors
  // stay dense — the cauliflower silhouette and wispy fringe of real cumulus
  // instead of a smooth blob.
  float det = vnoise3(q * 0.0058);
  float d = core - (1.0 - det) * (1.0 - core) * 0.55;
  d *= 0.85 + 0.15 * det;
  // Normalised density (0..1): the uDensity extinction multiplier is applied
  // uniformly at the extinction sites (main march & lightMarch) so both
  // integrate the same density field — never scale it here.
  return clamp(d, 0.0, 1.0);
}

// ---- self-shadow light march ----------------------------------------------------
// Two taps along the column still above the sample point: the step adapts to the
// remaining depth, so the shadow follows the real column instead of a fixed
// offset that overshoots the slab top on high rays.
float lightMarch(vec3 p, vec3 ld) {
  float tau = 0.0;
  float stepL = max((uCloudTop - p.y) * 0.5, 20.0);
  for (int i = 0; i < 2; i++) {
    p += ld * stepL;
    tau += cloudDensity(p) * stepL * 0.006 * uDensity; // σ ≈ 0.006 /m × density
  }
  return exp(-tau);
}

// ---- sky dome -------------------------------------------------------------------
vec3 skyColor(vec3 dir) {
  float day = smoothstep(-0.14, 0.18, uSunDir.y); // day ↔ night factor
  // Deep night sky (deep-space blue), day Rayleigh-ish blue.
  vec3 zenithDay = vec3(0.16, 0.34, 0.62);
  vec3 zenithNight = vec3(0.012, 0.02, 0.055);
  vec3 horizonDay = vec3(0.66, 0.78, 0.92);
  vec3 horizonNight = vec3(0.03, 0.045, 0.085);
  float t = clamp(dir.y, 0.0, 1.0);
  vec3 sky = mix(
    mix(horizonNight, horizonDay, day),
    mix(zenithNight, zenithDay, day),
    pow(t, 0.55));
  // Sunset / sunrise glow: warm band near the sun when it grazes the horizon.
  float sunGrazing = exp(-abs(uSunDir.y) * 9.0);
  float toward = max(dot(normalize(vec3(dir.x, 0.0, dir.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0);
  float band = pow(1.0 - abs(dir.y), 3.5) * sunGrazing * pow(toward, 1.7);
  sky += vec3(1.0, 0.45, 0.16) * band * 0.55 * smoothstep(-0.22, 0.05, uSunDir.y + 0.12);
  // Sun / moon disk + halo.
  float sun = max(dot(dir, uSunDir), 0.0);
  sky += uSunColor * (pow(sun, 1400.0) * 14.0 + pow(sun, 7.0) * 0.16) * (1.0 - uNight * 0.85);
  float moon = max(dot(dir, uMoonDir), 0.0);
  sky += uMoonColor * (pow(moon, 3200.0) * 8.0 + pow(moon, 40.0) * 0.05) * uNight;
  return sky;
}

// ---- ground plane (below horizon) -------------------------------------------------
// There is no terrain mesh: this paints the plane y = 0 from its actual hit
// point, so an overhead view keeps spatial structure instead of one flat colour.
// Deliberately does not call skyColor(): the sky's horizon-glow term degenerates
// when the view direction is straight down (dir.xz ≈ 0).
vec3 groundColor(vec3 ro, vec3 rd) {
  float day = smoothstep(-0.14, 0.18, uSunDir.y); // day ↔ night factor
  float t = ro.y > 0.0 ? min(-ro.y / min(rd.y, -1e-4), 4.0e4) : 0.0;
  vec3 hit = ro + rd * t;
  // Aerial perspective by *hit distance* rather than by view angle. The old
  // exp(-|rd.y|·5) form already reached 0.78 haze 800 m out and ~1.0 within a
  // couple of degrees of the horizon, so the ground snapped to the horizon
  // colour and the seam read as two flat sheets of paper butted together.
  // Distance fog fades gradually and is continuous at rd.y = 0 (t → ∞).
  float fog = 1.0 - exp(-t * 7.0e-5);
  // Coarse desert-soil tone, textured by a kilometre-scale noise cell so the
  // plane keeps structure when the camera looks straight down at it.
  vec3 soil = mix(vec3(0.34, 0.33, 0.28), vec3(0.46, 0.42, 0.34), fbm2(hit.xz * 0.0016 + 4.2));
  // Sunlit by day, moonlit after dusk. With the sun term alone the plane fell to
  // pure black at night — the lower half of an overhead view then read as a
  // featureless black wall instead of ground. Airglow keeps a floor under it.
  vec3 light = mix(uMoonColor * 1.6, vec3(0.95), day);
  vec3 lit = soil * light + vec3(0.012, 0.014, 0.022);
  // Matches skyColor()'s horizon band so the ground meets the sky seamlessly.
  vec3 haze = mix(vec3(0.03, 0.045, 0.085), vec3(0.66, 0.78, 0.92), day);
  return mix(lit, haze, fog);
}

void main() {
  vec3 ro, rd;
  rtCameraRay(ro, rd);

  // Background: the painted ground plane below the horizon, the sky dome above
  // (stars dropped — the procedural star grid dominates the fragment cost on
  // integrated GPUs).
  vec3 col = rd.y < 0.0 ? groundColor(ro, rd) : skyColor(rd);
  float night = uNight;

  // ---- cloud-slab raymarch -------------------------------------------------------
  // Marched for every ray direction: with the camera above the slab an overhead
  // view has to show cloud tops, not just the ground. Only a ray that misses the
  // slab keeps its bare background colour.
  vec2 slab = raySlab(ro, rd, uCloudBase, uCloudTop);
  float t0 = max(slab.x, 0.0);
  float t1 = min(slab.y, 42000.0); // cap the far distance
  float trans = 1.0;
  vec3 inscatter = vec3(0.0);
  if (t1 > t0 && uCoverage > 0.012) { // clear sky: skip the march entirely
    // Step length grows with the distance already travelled. A fixed small step
    // (the slab-thickness cap) kept the noise cells resolved near the camera but
    // starved grazing rays: they cross a slab span of tens of kilometres yet only
    // integrated the first ~2 km, so the deck thinned out a few degrees above the
    // horizon and ended on a cut-out edge. Growing the step keeps the near field
    // crisp and still reaches the far deck, at the same sample cost.
    float stepBase = max(8.0, (uCloudTop - uCloudBase) * 0.06); // ≈ 48 m
    float stepMax = 400.0; // ≈ 2 samples per base noise cell
    // Interleaved gradient noise (Jimenez 2014) instead of a raw hash: adjacent
    // fragments get evenly spread offsets, so the dither reads as fine film
    // grain. A hash dither clumps neighbours into the same offset, which at the
    // plugin's reduced internal resolution is what read as coarse "smear".
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
    float cosSun = dot(rd, uSunDir);
    float cosMoon = dot(rd, uMoonDir);
    // Beer–Lambert extinction with single scattering: per unit optical depth the
    // medium scatters albedo·p(θ)·L. The albedo must stay ≤ 1 — a medium cannot
    // amplify light — so brightness comes from the radiance terms. The earlier
    // gains folded ~8 into the albedo and ~12 into the phase, i.e. a ~100×
    // amplification: every optically thick deck clipped to paper white and the
    // frame read as a black-and-white image with no shading.
    float albedo = 0.92;
    // Forward-lobe phase is ≈ 0.57, so 4.2 lands a fully sunlit opaque deck near
    // 2.2 linear radiance: white after the tonemap, still under its knee, so
    // shading, the ambient blue tint and the sunset warmth all survive.
    float phase = hgPhaseDual(0.6, cosSun) * (1.0 - night) * 4.2
                + hgPhaseDual(0.7, cosMoon) * night * 0.4;
    vec3 sunLight = (uSunColor * (1.0 - night * 0.82) + uMoonColor * night * 3.0);
    vec3 ambient = mix(vec3(0.03, 0.045, 0.09), vec3(0.46, 0.56, 0.76), 1.0 - night) * 0.55;
    vec3 ld = normalize(uSunDir + vec3(0.0, 0.08, 0.0));

    // Dither the first sample, then advance by a per-sample step: the per-fragment
    // jitter turns the coarse far-field sampling into dither instead of banding.
    // The step perturbation is kept small (≤ 6 %) — a large one randomises the
    // optical-depth integral itself and shows up as grain over the whole deck.
    float t = t0 + jitter * stepBase;
    for (int i = 0; i < 160; i++) {
      if (i >= uSteps || trans < 0.05 || t > t1) break;
      float stepLen = min(stepBase * (1.0 + t * 1.6e-3), stepMax) * (1.0 + jitter * 0.12);
      vec3 p = ro + rd * t;
      float d = cloudDensity(p);
      if (d > 0.012) {
        float shadow = lightMarch(p, ld);
        float pw = powderEffect(d);
        // Cheap multiple-scattering term: raising the single-scatter
        // transmittance to a small power stands in for the extra scattering
        // inside the cloud, so shadowed interiors stay soft, not soot-black.
        float ms = pow(shadow, 0.35);
        vec3 lit = sunLight * (0.7 * shadow + 0.3 * ms) * phase * (0.55 + 0.45 * pw);
        // Aerial perspective: distant cloud fades into the sky it sits against.
        float haze = exp(-t * 4.0e-5);
        // Optical-depth increment of this sample (σ ≈ 0.006 /m × density ×
        // uDensity), applied identically to scattering and extinction so the
        // σs/σe ratio is exactly the albedo.
        float dTau = d * stepLen * 0.006 * uDensity;
        inscatter += trans * (lit + ambient) * albedo * dTau * haze;
        trans *= exp(-max(dTau, 0.0));
      }
      t += stepLen;
    }
  }

  // Composited as background·transmittance + in-scattered light: a dense cloud
  // must actually hide whatever sits behind it, otherwise the sky bleeds
  // through and the cloud reads as translucent haze.
  col = col * trans + inscatter;

  gl_FragColor = vec4(tonemap(col * 1.15), 1.0);
}
`;

import { Color, Matrix4, Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3 } from 'three';

export interface CloudMaterial extends ShaderMaterial {
  uniforms: {
    uCamWorld: { value: Matrix4 };
    uProjInv: { value: Matrix4 };
    uSunDir: { value: import('three').Vector3 };
    uMoonDir: { value: import('three').Vector3 };
    uSunColor: { value: import('three').Color };
    uMoonColor: { value: import('three').Color };
    uNight: { value: number };
    uCoverage: { value: number };
    uDensity: { value: number };
    uWindOffset: { value: import('three').Vector2 };
    uCloudBase: { value: number };
    uCloudTop: { value: number };
    uSteps: { value: number };
  };
}

/** Build the fullscreen volumetric-cloud quad (call `scene.add(mesh)`). */
export function createCloudQuad(): { mesh: Mesh; material: CloudMaterial } {
  const geometry = new PlaneGeometry(2, 2);
  const material = new ShaderMaterial({
    vertexShader: CLOUD_VERTEX,
    fragmentShader: CLOUD_FRAGMENT,
    uniforms: {
      uCamWorld: { value: new Matrix4() },
      uProjInv: { value: new Matrix4() },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uMoonDir: { value: new Vector3(0, -1, 0) },
      uSunColor: { value: new Color(1, 0.95, 0.85) },
      uMoonColor: { value: new Color(0.65, 0.7, 0.85) },
      uNight: { value: 0 },
      uCoverage: { value: 0.55 },
      uDensity: { value: 1 },
      uWindOffset: { value: new Vector2(0, 0) },
      uCloudBase: { value: 650 },
      uCloudTop: { value: 1450 },
      uSteps: { value: 48 },
    },
    depthTest: false,
    depthWrite: false,
  }) as CloudMaterial;
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9999;
  return { mesh, material };
}
