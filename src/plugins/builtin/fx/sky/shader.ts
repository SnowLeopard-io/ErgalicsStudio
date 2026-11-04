// ==========================================================================
// fx.sky — analytic daylight sky renderer (fragment shader).
//
// A single-scattering atmospheric integrator over a spherical planet shell:
// Rayleigh + Mie extinction, exponential density profiles, per-sample light
// marches (4 taps) and view integration (10 taps) — the classic Nishita-style
// model in its cheap analytic form. Below-horizon light rays pass through the
// planet, which produces physically motivated twilight (earth-shadow) colors.
// The sun disk carries limb darkening and the view-ray transmittance, so it
// reddens realistically at low altitude. Moonlight reuses the same
// integrator scaled by the illuminated lunar fraction. No stars, no clouds —
// those live in fx.stars / fx.cloud.
//
// Shared GLSL (camera ray, tonemap) comes from the ray-tracing core.
// ==========================================================================

import { Matrix4, ShaderMaterial, Vector3 } from 'three';
import { RT_CAMERA_RAY, RT_CAMERA_VERTEX, RT_TONEMAP, createSkyQuad } from '@/core/raytrace';
import type { Mesh } from 'three';

export const SKY_VERTEX = RT_CAMERA_VERTEX;

export const SKY_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vNdc;

uniform vec3 uSunDir;       // world-space, normalized
uniform vec3 uMoonDir;      // world-space, normalized
uniform float uMoonBright;  // 0..1 — illuminated fraction × altitude factor
uniform float uTurbidity;   // 1..10 — Mie loading
uniform float uSunIntensity;
uniform float uExposure;

${RT_CAMERA_RAY}
${RT_TONEMAP}

const float PI = 3.141592653589793;
const float R_PLANET = 6360e3;   // m
const float R_ATMO = 6420e3;     // m
const float H_R = 8000.0;        // Rayleigh scale height (m)
const float H_M = 1200.0;        // Mie scale height (m)
const vec3 BETA_R = vec3(5.8e-6, 13.5e-6, 33.1e-6); // Rayleigh scattering (1/m)
const float BETA_M = 21e-6;      // Mie scattering (1/m) at turbidity 1

/** Ray–sphere entry/exit distances; (1e9, -1e9) when missing. */
vec2 rsi(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e9, -1e9);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}

/** Mie phase (Henyey–Greenstein). */
float miePhase(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
}

/**
 * Single-scattering integral along the view ray. Light rays that dip below
 * the horizon cross the planet shell, where the enormous optical depth
 * produces the earth-shadow twilight naturally.
 */
vec3 atmosphere(vec3 ro, vec3 rd, vec3 lightDir, float intensity, out vec3 viewTrans) {
  viewTrans = vec3(1.0);
  vec2 t = rsi(ro, rd, R_ATMO);
  if (t.y < 0.0) return vec3(0.0);
  float tStart = max(t.x, 0.0);
  float tEnd = t.y;
  vec2 tg = rsi(ro, rd, R_PLANET);
  bool ground = tg.x > 0.0;
  if (ground) tEnd = min(tEnd, tg.x);
  const int N = 10;
  const int NL = 4;
  float seg = (tEnd - tStart) / float(N);
  float odRv = 0.0;
  float odMv = 0.0;
  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 p = ro + rd * (tStart + (float(i) + 0.5) * seg);
    float h = max(length(p) - R_PLANET, 0.0);
    float dR = exp(-h / H_R) * seg;
    float dM = exp(-h / H_M) * seg;
    odRv += dR;
    odMv += dM;
    // Optical depth toward the light (4 taps up to the atmosphere top —
    // rays through the planet accumulate near-infinite depth → umbra).
    vec2 ta = rsi(p, lightDir, R_ATMO);
    float lseg = max(ta.y, 0.0) / float(NL);
    float odRl = 0.0;
    float odMl = 0.0;
    for (int j = 0; j < NL; j++) {
      vec3 q = p + lightDir * ((float(j) + 0.5) * lseg);
      float hq = max(length(q) - R_PLANET, 0.0);
      odRl += exp(-hq / H_R) * lseg;
      odMl += exp(-hq / H_M) * lseg;
    }
    vec3 att = exp(-(BETA_R * (odRv + odRl) + BETA_M * 1.1 * uTurbidity * (odMv + odMl)));
    sumR += dR * att;
    sumM += dM * att;
  }
  // Camera→light transmittance (4-tap) — colors the solar disk.
  float odRc = 0.0;
  float odMc = 0.0;
  vec2 tc = rsi(ro, lightDir, R_ATMO);
  float cseg = max(tc.y, 0.0) / 4.0;
  for (int j = 0; j < 4; j++) {
    vec3 q = ro + lightDir * ((float(j) + 0.5) * cseg);
    float hq = max(length(q) - R_PLANET, 0.0);
    odRc += exp(-hq / H_R) * cseg;
    odMc += exp(-hq / H_M) * cseg;
  }
  viewTrans = exp(-(BETA_R * odRc + BETA_M * 1.1 * uTurbidity * odMc));
  float mu = dot(rd, lightDir);
  float phR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float phM = miePhase(mu, 0.76);
  return intensity * (sumR * BETA_R * phR + sumM * BETA_M * phM);
}

void main() {
  vec3 ro0, rd;
  rtCameraRay(ro0, rd);
  // Eye on the planet surface; the orbit camera only supplies the direction.
  vec3 ro = vec3(0.0, R_PLANET + 2.0, 0.0);

  vec3 col = vec3(0.0);
  vec3 viewTrans;
  col += atmosphere(ro, rd, uSunDir, uSunIntensity, viewTrans);

  // Moonlight: the same integrator driven by the illuminated lunar fraction.
  if (uMoonBright > 0.001) {
    vec3 mt;
    col += atmosphere(ro, rd, uMoonDir, 0.25 * uMoonBright, mt);
  }

  // Solar disk: 0.267° angular radius, crude limb darkening, attenuated by
  // the view transmittance (reddens at low altitude).
  float muS = dot(rd, uSunDir);
  float disk = smoothstep(0.999988, 0.999996, muS);
  float limb = 0.45 + 0.55 * sqrt(clamp(muS, 0.0, 1.0));
  col += disk * limb * uSunIntensity * 14.0 * viewTrans;

  // Lunar disk: phase shading from the sun–moon geometry. The disk-plane
  // coordinate (pdisk) dotted with the sun's in-disk projection gives a
  // soft terminator; at full moon the projection degenerates → fully lit.
  float muM = dot(rd, uMoonDir);
  float moonDisk = smoothstep(0.999985, 0.999995, muM);
  if (moonDisk > 0.0 && uMoonBright > 0.001) {
    vec3 pdisk = normalize(rd - uMoonDir * muM);
    float shade;
    if (uMoonBright > 0.95) {
      shade = 1.0;
    } else {
      vec3 pd = uSunDir - uMoonDir * dot(uSunDir, uMoonDir);
      float pdLen = length(pd);
      shade = pdLen > 1e-4 ? clamp(0.5 + 0.62 * dot(pdisk, pd / pdLen) * (0.4 + uMoonBright), 0.02, 1.0) : 0.5;
    }
    col += moonDisk * shade * uMoonBright * 2.6;
  }

  // Ground shading (below-horizon rays): dark albedo + distance haze.
  vec2 tg = rsi(ro, rd, R_PLANET);
  if (tg.x > 0.0) {
    float day = clamp(uSunDir.y * 6.0 + 0.15, 0.0, 1.0);
    vec3 ground = vec3(0.045, 0.05, 0.046) * day + vec3(0.004, 0.005, 0.008);
    float haze = 1.0 - exp(-tg.x * 2.5e-4 * uTurbidity);
    vec3 hazeCol = vec3(0.42, 0.47, 0.53) * clamp(uSunDir.y + 0.12, 0.0, 1.0) + vec3(0.008, 0.01, 0.016);
    col = mix(ground, hazeCol, haze);
  }

  col *= uExposure;
  gl_FragColor = vec4(tonemap(col), 1.0);
}
`;

export interface SkyMaterial extends ShaderMaterial {
  uniforms: {
    uCamWorld: { value: Matrix4 };
    uProjInv: { value: Matrix4 };
    uSunDir: { value: Vector3 };
    uMoonDir: { value: Vector3 };
    uMoonBright: { value: number };
    uTurbidity: { value: number };
    uSunIntensity: { value: number };
    uExposure: { value: number };
  };
}

/** Builds the fullscreen sky quad via the shared sky-base factory. */
export function createSkyQuadMesh(): { mesh: Mesh; material: SkyMaterial } {
  const { mesh, material } = createSkyQuad(SKY_FRAGMENT, {
    uCamWorld: { value: new Matrix4() },
    uProjInv: { value: new Matrix4() },
    uSunDir: { value: new Vector3(0, 1, 0) },
    uMoonDir: { value: new Vector3(0, -1, 0) },
    uMoonBright: { value: 0 },
    uTurbidity: { value: 3 },
    uSunIntensity: { value: 20 },
    uExposure: { value: 1.2 },
  });
  return { mesh, material: material as SkyMaterial };
}
