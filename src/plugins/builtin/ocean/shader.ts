// ==========================================================================
// fx.ocean — open-sea swell renderer (fragment shader).
//
// Gerstner wave trains whose amplitudes come from a discretised
// Pierson–Moskowitz spectrum (built on the CPU — see plugin.ts), a two-lobe
// micro-facet sun path (the classic glitter track), a Schlick-Fresnel water
// body and the analytic one-bounce sky from the shared core. The
// ray/height-field intersection is a 3-step Newton solve on the vertical
// height error. Swell amplitude decays with range, so the far sea flattens
// into a mirror and dissolves into the marine haze — that is what reads as
// "wide open water".
//
// Shared GLSL (camera ray, noise, sky, tonemap) comes from the ray-tracing core.
// ==========================================================================

import { Matrix4, ShaderMaterial, Vector2, Vector3 } from 'three';
import { RT_CAMERA_RAY, RT_CAMERA_VERTEX, RT_NOISE, RT_SKY_SIMPLE, RT_TONEMAP, createSkyQuad } from '@/core/raytrace';
import type { Mesh } from 'three';

// 9 trains put a train exactly on the spectral peak fp (the middle of the
// log-spaced [fp/2.5, 2.5 fp] fan), so the discrete sea state reproduces the
// analytic Pierson–Moskowitz peak period without interpolation.
/** Number of Gerstner trains; must match the array sizes in the shader. */
export const WAVE_COUNT = 9;

export const OCEAN_VERTEX = RT_CAMERA_VERTEX;

export const OCEAN_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vNdc;

uniform float uTime;
uniform float uChoppiness;    // Gerstner steepness Q (0..1.1)
uniform float uWaveScale;     // amplitude multiplier
uniform float uDetail;        // capillary-ripple normal strength
uniform float uGlitter;       // sun-glitter multiplier
uniform float uFogDensity;    // marine haze extinction (1/m)
uniform float uExposure;
uniform float uColorTemp;     // white balance: 0 cool .. 0.5 neutral .. 1 warm
uniform float uSaturation;    // 0 grey .. 1 neutral .. 1.6 vivid
uniform float uWaveAmp[9];    // Pierson–Moskowitz train amplitudes (m)
uniform float uWaveFreq[9];   // train frequencies (Hz)
uniform vec2  uWaveDir[9];    // horizontal propagation directions (unit)
uniform float uWavePhase[9];  // deterministic phases (rad)

${RT_CAMERA_RAY}
${RT_NOISE}
${RT_SKY_SIMPLE}
${RT_TONEMAP}

/** Post-tonemap look: white balance + luminance-preserving saturation. */
vec3 grade(vec3 c) {
  float t = (uColorTemp - 0.5) * 2.0;
  c.r *= 1.0 + 0.20 * t;
  c.b *= 1.0 - 0.20 * t;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return clamp(mix(vec3(l), c, uSaturation), 0.0, 1.0);
}

const float G_ACC = 9.81;
const float TAU = 6.283185307179586;

// Wave-train LOD: swell shorter than a pixel is unrenderable far away, so
// amplitudes decay with range — the distant sea flattens into a mirror.
float swellFade(float dist) { return exp(-dist / 6000.0); }

/** Surface height above still water at an undisplaced coordinate. */
float waveHeight(vec2 xz, float dist) {
  float h = 0.0;
  float fade = swellFade(dist);
  for (int i = 0; i < 9; i++) {
    float a = uWaveAmp[i] * uWaveScale * fade;
    float w = TAU * uWaveFreq[i];
    float k = w * w / G_ACC;                        // deep-water dispersion
    h += a * sin(k * dot(uWaveDir[i], xz) - w * uTime + uWavePhase[i]);
  }
  return h;
}

/** Gerstner displacement plus analytic tangents (dP/dx, dP/dz). */
vec3 gerstner(vec2 xz, float dist, out vec3 tx, out vec3 tz) {
  vec3 p = vec3(xz.x, 0.0, xz.y);
  tx = vec3(1.0, 0.0, 0.0);
  tz = vec3(0.0, 0.0, 1.0);
  float fade = swellFade(dist);
  for (int i = 0; i < 9; i++) {
    float a = uWaveAmp[i] * uWaveScale * fade;
    float w = TAU * uWaveFreq[i];
    float k = w * w / G_ACC;
    vec2 dl = uWaveDir[i];
    float th = k * dot(dl, xz) - w * uTime + uWavePhase[i];
    float c = cos(th);
    float s = sin(th);
    float q = uChoppiness * a * k;
    p.x += uChoppiness * a * dl.x * c;
    p.z += uChoppiness * a * dl.y * c;
    p.y += a * s;
    tx += vec3(-q * dl.x * dl.x * s, a * k * dl.x * c, -q * dl.x * dl.y * s);
    tz += vec3(-q * dl.x * dl.y * s, a * k * dl.y * c, -q * dl.y * dl.y * s);
  }
  return p;
}

/** Ray/height-field intersection: Newton on the vertical height error. */
float surfaceT(vec3 ro, vec3 rd, out vec2 xzOut) {
  float t = clamp(-ro.y / rd.y, 0.0, 200000.0);
  for (int i = 0; i < 3; i++) {
    vec3 q = ro + rd * t;
    t += (waveHeight(q.xz, t) - q.y) / rd.y;
  }
  t = clamp(t, 0.0, 200000.0);
  xzOut = (ro + rd * t).xz;
  return t;
}

/** Water body + reflected sky + sun path, at a surface point with normal n. */
vec3 shadeWater(vec3 n, vec3 rd, float dist) {
  vec3 v = normalize(-rd);
  float ct = clamp(dot(n, v), 0.0, 1.0);
  // Schlick Fresnel, F0 = ((n_w - 1)/(n_w + 1))² = 0.02 for n_w = 1.333.
  float F = 0.02 + 0.98 * pow(1.0 - ct, 5.0);

  vec3 r = reflect(rd, n);
  r.y = max(r.y, -0.02);
  vec3 refl = skyRadiance(normalize(r));

  // Two-lobe micro-facet glitter: the broad sheen carries the sun path while a
  // narrower core adds the sparkle. A tight lobe on its own reads as plastic.
  vec3 hv = normalize(v + uSunDir);
  float nh = max(dot(n, hv), 0.0);
  vec3 glint = uSunColor * uSunIntensity * uGlitter
             * (0.30 * pow(nh, 220.0) + 0.16 * pow(nh, 24.0))
             * smoothstep(-0.035, 0.02, uSunDir.y);

  // Deep-water body: blue-green absorption with a warm upwelling near the
  // crests, so the surface never reads as a flat, near-black sheet.
  vec3 deep = vec3(0.018, 0.062, 0.096);
  float up = pow(1.0 - ct, 2.0);
  vec3 sss = vec3(0.055, 0.230, 0.235) * up * uSunIntensity * 0.16 * exp(-dist / 9000.0);

  return mix(deep + sss, refl, F) + glint;
}

void main() {
  vec3 ro, rd;
  rtCameraRay(ro, rd);

  vec3 col;
  if (rd.y > -0.0004) {
    col = skyRadiance(rd);
  } else {
    vec2 xz;
    float t = surfaceT(ro, rd, xz);
    vec3 tx, tz;
    vec3 P = gerstner(xz, t, tx, tz);
    vec3 n = normalize(cross(tz, tx));

    // Capillary ripples — the texture that makes the sun path sparkle. Two
    // octaves only (a 4-octave fbm aliases into moiré at grazing angles) and
    // faded out with range so the far sea stays clean.
    if (uDetail > 0.001 && t < 2800.0) {
      vec2 q = P.xz * 0.11 + vec2(uTime * 0.09, uTime * 0.065);
      float e = 1.4;
      vec2 qx = q + vec2(e, 0.0);
      vec2 qz = q + vec2(0.0, e);
      float n0 = vnoise2(q) * 0.68 + vnoise2(q * 2.17 + 19.0) * 0.32;
      float nx = vnoise2(qx) * 0.68 + vnoise2(qx * 2.17 + 19.0) * 0.32;
      float nz = vnoise2(qz) * 0.68 + vnoise2(qz * 2.17 + 19.0) * 0.32;
      float k = uDetail * exp(-t / 1400.0) * 1.25;
      n = normalize(n + vec3(-(nx - n0), 0.0, -(nz - n0)) * k);
    }

    col = shadeWater(n, rd, t);

    // Marine haze: exponential extinction that dissolves the swell into the
    // horizon. Combined with the swell fade this is the "vast sea" reading.
    float fog = 1.0 - exp(-uFogDensity * t);
    col = mix(col, horizonColor(rd), clamp(fog, 0.0, 1.0));
  }

  gl_FragColor = vec4(grade(tonemap(col * uExposure)), 1.0);
}
`;

export interface OceanMaterial extends ShaderMaterial {
  uniforms: {
    uCamWorld: { value: Matrix4 };
    uProjInv: { value: Matrix4 };
    uSunDir: { value: Vector3 };
    uSunColor: { value: Vector3 };
    uSunIntensity: { value: number };
    uAtmoHaze: { value: number };
    uTime: { value: number };
    uChoppiness: { value: number };
    uWaveScale: { value: number };
    uDetail: { value: number };
    uGlitter: { value: number };
    uFogDensity: { value: number };
    uExposure: { value: number };
    uColorTemp: { value: number };
    uSaturation: { value: number };
    uWaveAmp: { value: number[] };
    uWaveFreq: { value: number[] };
    uWaveDir: { value: Vector2[] };
    uWavePhase: { value: number[] };
  };
}

export function createOceanQuadMesh(): { mesh: Mesh; material: OceanMaterial } {
  const uniforms = {
    uCamWorld: { value: new Matrix4() },
    uProjInv: { value: new Matrix4() },
    uSunDir: { value: new Vector3(0, 0.25, -1) },
    uSunColor: { value: new Vector3(1, 1, 1) },
    uSunIntensity: { value: 8 },
    uAtmoHaze: { value: 0.3 },
    uTime: { value: 0 },
    uChoppiness: { value: 0.6 },
    uWaveScale: { value: 1 },
    uDetail: { value: 0.55 },
    uGlitter: { value: 1 },
    uFogDensity: { value: 5.9e-5 },
    uExposure: { value: 1.1 },
    uColorTemp: { value: 0.5 },
    uSaturation: { value: 1 },
    uWaveAmp: { value: new Array<number>(WAVE_COUNT).fill(0) },
    uWaveFreq: { value: new Array<number>(WAVE_COUNT).fill(0) },
    uWavePhase: { value: new Array<number>(WAVE_COUNT).fill(0) },
    uWaveDir: { value: Array.from({ length: WAVE_COUNT }, () => new Vector2(0, -1)) },
  };
  const { mesh, material } = createSkyQuad(OCEAN_FRAGMENT, uniforms);
  return { mesh, material: material as OceanMaterial };
}
