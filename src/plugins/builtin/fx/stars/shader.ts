// ==========================================================================
// fx.stars — night-sky star renderer (fragment shader).
//
// Composition, drawn additively over a Bortle-dependent sky background:
//  - procedural star grid (RT_STARS), rotated by GMST via uCelestial so the
//    whole celestial sphere turns with sidereal time (斗转星移);
//  - a galactic-plane band anchored on the REAL galactic pole/center
//    directions (passed from TS, computed from RA/Dec → horizontal frame),
//    textured by FBM clouds and dark lanes;
//  - light-pollution glow from the Bortle class (horizon-weighted);
//  - moonlight: phase-scaled glow that washes out faint stars;
//  - scintillation (twinkle) controlled by a seeing parameter;
//  - occasional meteors: great-circle streaks between two CPU-computed
//    directions with a moving head glow.
//
// Shared GLSL (camera ray, noise, stars, scatter, tonemap) from the core.
// ==========================================================================

import { Matrix3, Matrix4, ShaderMaterial, Vector3 } from 'three';
import type { Mesh } from 'three';
import { RT_CAMERA_RAY, RT_CAMERA_VERTEX, RT_NOISE, RT_SCATTER, RT_STARS, RT_TONEMAP, createSkyQuad } from '@/core/raytrace';

export const STARS_VERTEX = RT_CAMERA_VERTEX;

export const STARS_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vNdc;

uniform float uTime;
uniform vec3 uMoonDir;       // world-space, normalized
uniform float uMoonBright;   // 0..1 illuminated fraction × altitude factor
uniform float uBortle;       // 1..9 light-pollution class
uniform float uSeeing;       // 0..1 scintillation strength
uniform float uMwBright;     // 0..2 Milky-Way brightness
uniform float uExposure;
uniform vec3 uGalacticPole;  // world-space unit vector (CPU: RA 192.86°, Dec +27.13°)
uniform vec3 uGalacticCenter; // world-space unit vector (CPU: RA 266.4°, Dec −29.0°)
uniform vec3 uMeteorA;       // meteor streak start direction
uniform vec3 uMeteorB;       // meteor streak end direction
uniform float uMeteorT;      // head progress 0..1
uniform float uMeteorFade;   // 0..1 envelope

${RT_CAMERA_RAY}
${RT_NOISE}
${RT_STARS}
${RT_SCATTER}
${RT_TONEMAP}

void main() {
  vec3 ro, rd;
  rtCameraRay(ro, rd);

  float b = clamp((uBortle - 1.0) / 8.0, 0.0, 1.0); // 0 = pristine, 1 = inner city

  // ---- sky background: airglow floor + Bortle light pollution ---------------
  vec3 col = vec3(0.0035, 0.006, 0.011);
  float hor = pow(1.0 - clamp(rd.y, 0.0, 1.0), 5.0);
  col += b * (vec3(0.05, 0.042, 0.032) * hor + vec3(0.012, 0.011, 0.0095));

  // ---- Milky Way: real galactic-plane geometry ------------------------------
  // b = angular distance above the galactic plane (asin of pole dot).
  float sinB = clamp(dot(rd, uGalacticPole), -1.0, 1.0);
  float gal = exp(-pow(asin(sinB) / 0.115, 2.0)); // ~13° Gaussian half-width
  if (uMwBright > 0.001 && b < 0.85) {
    vec3 e1 = normalize(cross(uGalacticPole, vec3(0.0, 1.0, 0.001)));
    vec3 e2 = cross(uGalacticPole, e1);
    vec2 uv = vec2(dot(rd, e1), dot(rd, e2));
    float neb = fbm2(uv * 5.5 + 3.7);
    float lanes = smoothstep(0.42, 0.72, fbm2(uv * 3.1 + 9.2));
    float bulge = pow(clamp(dot(rd, uGalacticCenter), 0.0, 1.0), 5.0); // Sgr brightening
    float mw = gal * (0.10 + 0.16 * neb + 0.35 * bulge * neb) * (1.0 - 0.55 * lanes);
    col += mw * uMwBright * (1.0 - 0.8 * b) * vec3(0.78, 0.74, 0.66);
  }

  // ---- stars (RT_STARS), dimmed by light pollution and moonlight ------------
  float wash = clamp(1.0 - 0.55 * b - 0.85 * uMoonBright * (1.0 - 0.6 * b), 0.05, 1.0);
  vec3 stars = starField(rd) * wash;
  // Scintillation: direction-indexed noise wobbling the starlight.
  if (uSeeing > 0.001) {
    float tw = vnoise2(vec2(atan(rd.x, rd.z), asin(rd.y)) * 240.0 + uTime * 3.5);
    stars *= 1.0 + uSeeing * (tw - 0.5) * 1.5;
  }
  col += stars;

  // ---- moonlight glow + lunar disk ------------------------------------------
  float muM = clamp(dot(rd, uMoonDir), -1.0, 1.0);
  col += uMoonBright * (0.012 + 0.05 * hgPhase(0.5, muM)) * vec3(0.62, 0.68, 0.85);
  float moonDisk = smoothstep(0.999985, 0.999995, muM);
  col += moonDisk * uMoonBright * 2.2 * vec3(0.95, 0.96, 1.0);

  // ---- meteors: great-circle streak with a moving head glow ------------------
  if (uMeteorFade > 0.001) {
    vec3 ab = uMeteorB - uMeteorA;
    float len2 = max(dot(ab, ab), 1e-6);
    float tt = clamp(dot(rd - uMeteorA, ab) / len2, 0.0, 1.0);
    vec3 cp = normalize(uMeteorA + ab * tt);
    float dStreak = acos(clamp(dot(rd, cp), -1.0, 1.0));
    float streak = exp(-dStreak * dStreak * 2800.0);
    vec3 head = normalize(mix(uMeteorA, uMeteorB, clamp(uMeteorT, 0.0, 1.0)));
    float dHead = acos(clamp(dot(rd, head), -1.0, 1.0));
    float glow = exp(-dHead * dHead * 1100.0);
    col += (streak * 0.55 + glow * 1.4) * uMeteorFade * vec3(0.85, 0.92, 1.0);
  }

  col *= uExposure;
  gl_FragColor = vec4(tonemap(col), 1.0);
}
`;

export interface StarsMaterial extends ShaderMaterial {
  uniforms: {
    uCamWorld: { value: Matrix4 };
    uProjInv: { value: Matrix4 };
    uCelestial: { value: Matrix3 };
    uStars: { value: number };
    uTime: { value: number };
    uMoonDir: { value: Vector3 };
    uMoonBright: { value: number };
    uBortle: { value: number };
    uSeeing: { value: number };
    uMwBright: { value: number };
    uExposure: { value: number };
    uGalacticPole: { value: Vector3 };
    uGalacticCenter: { value: Vector3 };
    uMeteorA: { value: Vector3 };
    uMeteorB: { value: Vector3 };
    uMeteorT: { value: number };
    uMeteorFade: { value: number };
  };
}

/** Builds the fullscreen star-sky quad via the shared sky-base factory. */
export function createStarsQuadMesh(): { mesh: Mesh; material: StarsMaterial } {
  const { mesh, material } = createSkyQuad(STARS_FRAGMENT, {
    uCamWorld: { value: new Matrix4() },
    uProjInv: { value: new Matrix4() },
    uCelestial: { value: new Matrix3() },
    uStars: { value: 1 },
    uTime: { value: 0 },
    uMoonDir: { value: new Vector3(0, -1, 0) },
    uMoonBright: { value: 0 },
    uBortle: { value: 3 },
    uSeeing: { value: 0.4 },
    uMwBright: { value: 1 },
    uExposure: { value: 1.3 },
    uGalacticPole: { value: new Vector3(0, 1, 0) },
    uGalacticCenter: { value: new Vector3(1, 0, 0) },
    uMeteorA: { value: new Vector3(0, 1, 0) },
    uMeteorB: { value: new Vector3(1, 1, 0) },
    uMeteorT: { value: 0 },
    uMeteorFade: { value: 0 },
  });
  return { mesh, material: material as StarsMaterial };
}
