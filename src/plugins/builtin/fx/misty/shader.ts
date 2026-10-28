// ==========================================================================
// fx.misty — layered misty-peaks renderer (fragment shader).
//
// Distant-scenery model: 6 geometric-range layers carve a near-to-far stack
// of ridge silhouettes out of 3-octave ridged value noise. The ray altitude
// falls with distance (−d²/2R_EARTH, earth curvature), so the first layer the
// ray crosses is the visible crest ("单次命中" — one hit, nearest-first). Rock
// and forest albedo blend by crest altitude, the real sun lights the surface
// with a two-term ambient fill, then Koschmieder aerial perspective pushes
// each range towards the horizon colour. A Gaussian mist band pools in the
// valleys, integrated through the ray path, so the low ground is veiled while
// the high peaks stand clear over a sea of cloud.
//
// The sky is the shared analytic one-bounce RT_SKY_SIMPLE (which declares its
// own uSunDir / uSunColor / uSunIntensity / uAtmoHaze uniforms).
// ==========================================================================

import { Matrix4, ShaderMaterial, Vector3 } from 'three';
import { RT_CAMERA_RAY, RT_CAMERA_VERTEX, RT_NOISE, RT_SKY_SIMPLE, RT_TONEMAP, createSkyQuad } from '@/core/raytrace';
import type { Mesh } from 'three';

export const MISTY_VERTEX = RT_CAMERA_VERTEX;

export const MISTY_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vNdc;

uniform float uRidgeScale;     // horizontal ridge frequency multiplier
uniform float uRidgeHeight;    // base ridge height (m)
uniform float uAerialExt;      // aerial-perspective extinction (1/m)
uniform float uMistDensity;    // mist band opacity multiplier
uniform float uMistHeight;     // mist band centre altitude (m)
uniform float uExposure;
uniform float uColorTemp;      // white balance: 0 cool .. 0.5 neutral .. 1 warm
uniform float uSaturation;     // 0 grey .. 1 neutral .. 1.6 vivid

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

const float R_EARTH = 6.371e6;
const float LAYER_NEAR = 2500.0;
const float LAYER_GROW = 1.85;
const int LAYERS = 6;
const float SKY_D = 45000.0;

/** Ridged crest altitude (m) of the terrain layer at world position q.xz. */
float ridgeAt(vec2 q, int layer) {
  float fl = float(layer);
  // Finer relief on the farther layers, taller crests behind the near ones.
  float freq = uRidgeScale * 0.00016 * pow(1.55, fl);
  vec2 o = vec2(fl * 41.3, fl * 23.7);
  float n = 0.0;
  n += 0.62 * (1.0 - abs(2.0 * vnoise2(q * freq + o) - 1.0));
  n += 0.26 * (1.0 - abs(2.0 * vnoise2(q * freq * 2.7 + o + vec2(13.0, 5.0)) - 1.0));
  n += 0.12 * (1.0 - abs(2.0 * vnoise2(q * freq * 6.1 + o + vec2(3.0, 9.0)) - 1.0));
  n = pow(clamp(n, 0.0, 1.0), 1.35);
  return uRidgeHeight * (0.42 + 0.30 * fl) * n;
}

void main() {
  vec3 ro, rd;
  rtCameraRay(ro, rd);

  // Flat valley floor where a downward ray meets y = 0.
  float tGround = rd.y < -1e-5 ? (0.0 - ro.y) / rd.y : -1.0;

  // Near-to-far silhouette search; the first crossed layer wins.
  float tHit = -1.0;
  float li = -9.0;
  float d = LAYER_NEAR;
  for (int i = 0; i < LAYERS; i++) {
    if (tGround > 0.0 && d > tGround) { tHit = tGround; li = -1.0; break; }
    vec3 p = ro + rd * d;
    float alt = p.y - (d * d) / (2.0 * R_EARTH);
    if (alt < ridgeAt(p.xz, i)) { tHit = d; li = float(i); break; }
    d *= LAYER_GROW;
  }

  vec3 col;
  float td;
  if (tHit > 0.0) {
    td = tHit;
    vec3 p = ro + rd * tHit;
    vec3 n;
    float crest;
    if (li < 0.0) {
      n = vec3(0.0, 1.0, 0.0);
      crest = 0.0;
    } else {
      int I = int(li);
      float e = 140.0;
      float h0 = ridgeAt(p.xz, I);
      float hx = ridgeAt(p.xz + vec2(e, 0.0), I);
      float hz = ridgeAt(p.xz + vec2(0.0, e), I);
      crest = h0;
      n = normalize(vec3((h0 - hx) / e, 1.0, (h0 - hz) / e));
    }

    // Forest → rock blend by crest altitude; low ground stays green (青山).
    float altFrac = clamp(crest / max(uRidgeHeight, 1.0), 0.0, 1.0);
    vec3 forest = vec3(0.052, 0.090, 0.062);
    vec3 rock = vec3(0.150, 0.158, 0.176);
    vec3 albedo = mix(forest, rock, smoothstep(0.30, 0.90, altFrac));

    float day = smoothstep(-0.08, 0.18, uSunDir.y);
    float ndl = clamp(dot(n, normalize(uSunDir)), 0.0, 1.0);
    vec3 lit = albedo * (0.26 + 0.74 * ndl) * uSunColor * (0.22 + 1.05 * day);
    lit += albedo * 0.05 * (0.3 + 0.7 * day); // sky ambient fill

    // Aerial perspective: each range dissolves towards the horizon colour.
    float aerial = 1.0 - exp(-uAerialExt * tHit);
    col = mix(lit, horizonColor(rd), clamp(aerial, 0.0, 1.0));
  } else {
    td = SKY_D;
    col = skyRadiance(rd);
  }

  // Mist band: Gaussian in altitude, integrated along the ray path.
  const int MN = 12;
  float seg = td / float(MN);
  float w = uMistHeight * 0.65 + 120.0;
  float mist = 0.0;
  for (int j = 0; j < MN; j++) {
    float dj = (float(j) + 0.5) * seg;
    vec3 pj = ro + rd * dj;
    float alt = pj.y - (dj * dj) / (2.0 * R_EARTH);
    float band = exp(-pow((alt - uMistHeight) / w, 2.0));
    mist += band * seg;
  }
  float tau = mist * uMistDensity * 2.5e-3;
  col = mix(col, horizonColor(rd), clamp(1.0 - exp(-tau), 0.0, 1.0));

  gl_FragColor = vec4(grade(tonemap(col * uExposure)), 1.0);
}
`;

export interface MistyMaterial extends ShaderMaterial {
  uniforms: {
    uCamWorld: { value: Matrix4 };
    uProjInv: { value: Matrix4 };
    uSunDir: { value: Vector3 };
    uSunColor: { value: Vector3 };
    uSunIntensity: { value: number };
    uAtmoHaze: { value: number };
    uRidgeScale: { value: number };
    uRidgeHeight: { value: number };
    uAerialExt: { value: number };
    uMistDensity: { value: number };
    uMistHeight: { value: number };
    uExposure: { value: number };
    uColorTemp: { value: number };
    uSaturation: { value: number };
  };
}

export function createMistyQuadMesh(): { mesh: Mesh; material: MistyMaterial } {
  const uniforms = {
    uCamWorld: { value: new Matrix4() },
    uProjInv: { value: new Matrix4() },
    uSunDir: { value: new Vector3(0, 0.35, -1) },
    uSunColor: { value: new Vector3(1, 1, 1) },
    uSunIntensity: { value: 8 },
    uAtmoHaze: { value: 0.35 },
    uRidgeScale: { value: 1 },
    uRidgeHeight: { value: 900 },
    uAerialExt: { value: 4.8e-5 },
    uMistDensity: { value: 0.55 },
    uMistHeight: { value: 220 },
    uExposure: { value: 1.15 },
    uColorTemp: { value: 0.5 },
    uSaturation: { value: 1 },
  };
  const { mesh, material } = createSkyQuad(MISTY_FRAGMENT, uniforms);
  return { mesh, material: material as MistyMaterial };
}
