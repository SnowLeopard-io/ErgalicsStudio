// ==========================================================================
// Volumetric cloud plugin — GLSL raymarched sky renderer.
//
// A fullscreen quad ray-marches a flat cloud slab (uCloudBase..uCloudTop) in
// world meters: FBM coverage advected by a wind vector, Worley detail
// erosion, Beer–Lambert extinction with dual-lobe Henyey–Greenstein phase and
// a short "light march" toward the sun/moon for self-shadowing. The sky
// gradient, sunset glow, deep-blue night and the sidereally-rotating star
// field (斗转星移) are driven by sun/moon direction uniforms computed in TS
// from real ephemeris formulas (`@/core/raytrace/astro`).
//
// All reusable GLSL (camera ray, noise, blackbody, stars, scatter, tonemap)
// comes from the shared ray-tracing core.
// ==========================================================================

import {
  RT_CAMERA_RAY,
  RT_CAMERA_VERTEX,
  RT_INTERSECT,
  RT_NOISE,
  RT_SCATTER,
  RT_STARS,
  RT_TONEMAP,
} from '@/core/raytrace';

export const CLOUD_VERTEX = RT_CAMERA_VERTEX;

export const CLOUD_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vNdc;

uniform float uTime;      // animation time (s) — drives wind advection
uniform vec3 uSunDir;     // normalised direction toward the sun (world)
uniform vec3 uMoonDir;    // normalised direction toward the moon (world)
uniform vec3 uSunColor;   // pre-tinted sunlight (sunset-aware)
uniform vec3 uMoonColor;  // pre-scaled moonlight
uniform float uNight;     // 0 = full day, 1 = deep night
uniform float uCoverage;  // cloud coverage 0..1
uniform float uDensity;   // extinction multiplier
uniform vec2 uWind;       // wind advection velocity (m/s, world xz)
uniform float uCloudBase; // slab bottom (m)
uniform float uCloudTop;  // slab top (m)
uniform int uSteps;       // primary raymarch step budget

${RT_CAMERA_RAY}
${RT_NOISE}
${RT_INTERSECT}
${RT_SCATTER}
${RT_STARS}
${RT_TONEMAP}

// ---- cloud density field ------------------------------------------------------
// q: world position (m). Returns the local cloud density (0..1).
float cloudDensity(vec3 p) {
  vec3 q = p + vec3(uWind.x * uTime, 0.0, uWind.y * uTime); // wind advection
  float h = (p.y - uCloudBase) / max(uCloudTop - uCloudBase, 1.0);
  float profile = smoothstep(0.0, 0.22, h) * smoothstep(1.0, 0.55, h); // rounded slab
  float base = fbm2(q.xz * 0.00045);
  // Coverage gate: shift the fbm threshold so uCoverage spans clear → overcast.
  float cov = smoothstep(1.05 - uCoverage * 1.1, 1.35 - uCoverage * 0.7, base);
  float detail = worley3(q * 0.0016);
  float d = cov * profile * uDensity;
  d *= 0.55 + 0.45 * smoothstep(1.0, 0.2, detail); // Worley erosion
  return clamp(d, 0.0, 1.0);
}

// ---- self-shadow light march ----------------------------------------------------
// Short fixed-length march toward the light; returns transmittance 0..1.
float lightMarch(vec3 p, vec3 ld) {
  float tau = 0.0;
  float stepL = (uCloudTop - uCloudBase) * 0.14;
  for (int i = 0; i < 5; i++) {
    p += ld * stepL;
    tau += cloudDensity(p) * stepL * 0.006; // σ ≈ 0.006 /m × density
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
vec3 groundColor(vec3 dir) {
  float fog = exp(-max(-dir.y, 0.0) * 9.0);
  vec3 soil = mix(vec3(0.10, 0.11, 0.10), vec3(0.13, 0.13, 0.12), fbm2(dir.xz * 3.0 + 4.2));
  vec3 lit = soil * (0.25 + 0.75 * smoothstep(-0.14, 0.18, uSunDir.y));
  return mix(lit, skyColor(vec3(dir.x, 0.004, dir.z)) * 0.9, fog); // horizon fade
}

void main() {
  vec3 ro, rd;
  rtCameraRay(ro, rd);

  vec3 col;
  if (rd.y < 0.0) {
    col = groundColor(rd);
    gl_FragColor = vec4(tonemap(col * 1.2), 1.0);
    return;
  }

  // Sky + stars behind the clouds.
  float night = uNight;
  vec3 sky = skyColor(rd);
  vec3 stars = starField(rd) * (0.35 + 0.65 * uStars);
  col = sky + stars * night * 1.6;

  // ---- cloud-slab raymarch -------------------------------------------------------
  vec2 slab = raySlab(ro, rd, uCloudBase, uCloudTop);
  float t0 = max(slab.x, 0.0);
  float t1 = min(slab.y, 42000.0); // cap the far distance
  float trans = 1.0;
  if (t1 > t0 && uCoverage > 0.012) { // clear sky: skip the march entirely
    float stepLen = (t1 - t0) / float(uSteps);
    float cosSun = dot(rd, uSunDir);
    float cosMoon = dot(rd, uMoonDir);
    float phase = hgPhaseDual(0.6, cosSun) * (1.0 - night) * 26.0
                + hgPhaseDual(0.7, cosMoon) * night * 9.0 * length(uMoonColor);
    vec3 sunLight = (uSunColor * (1.0 - night * 0.82) + uMoonColor * night * 3.0);
    vec3 ambient = mix(vec3(0.03, 0.045, 0.09), vec3(0.55, 0.65, 0.85), 1.0 - night) * 0.9;
    float jitter = hash11(gl_FragCoord.x * 12.9898 + gl_FragCoord.y * 78.233) - 0.5;

    float tauAcc = 0.0;
    for (int i = 0; i < 256; i++) {
      if (i >= uSteps || trans < 0.03) break;
      float t = t0 + (float(i) + jitter) * stepLen;
      vec3 p = ro + rd * t;
      float d = cloudDensity(p);
      if (d > 0.004) {
        float shadow = lightMarch(p, normalize(uSunDir + vec3(0.0, 0.08, 0.0)));
        float pw = powderEffect(d);
        vec3 lit = sunLight * (shadow * phase * (0.6 + 0.4 * pw));
        vec3 contrib = (lit + ambient) * d * stepLen * 0.006 * 12.0;
        col += trans * contrib;
        float ext = d * stepLen * 0.006 * uDensity;
        trans *= exp(-max(ext, 0.0));
        tauAcc += ext;
      }
    }
    // Science uniform hook: total optical depth feeds the plugin readouts.
  }

  gl_FragColor = vec4(tonemap(col * 1.15), 1.0);
}
`;

import { Color, Matrix3, Matrix4, Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3 } from 'three';

export interface CloudMaterial extends ShaderMaterial {
  uniforms: {
    uCamWorld: { value: Matrix4 };
    uProjInv: { value: Matrix4 };
    uCelestial: { value: Matrix3 };
    uTime: { value: number };
    uSunDir: { value: import('three').Vector3 };
    uMoonDir: { value: import('three').Vector3 };
    uSunColor: { value: import('three').Color };
    uMoonColor: { value: import('three').Color };
    uNight: { value: number };
    uStars: { value: number };
    uCoverage: { value: number };
    uDensity: { value: number };
    uWind: { value: import('three').Vector2 };
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
      uCelestial: { value: new Matrix3() },
      uTime: { value: 0 },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uMoonDir: { value: new Vector3(0, -1, 0) },
      uSunColor: { value: new Color(1, 0.95, 0.85) },
      uMoonColor: { value: new Color(0.65, 0.7, 0.85) },
      uNight: { value: 0 },
      uStars: { value: 1 },
      uCoverage: { value: 0.55 },
      uDensity: { value: 1 },
      uWind: { value: new Vector2(3, 1.5) },
      uCloudBase: { value: 650 },
      uCloudTop: { value: 1450 },
      uSteps: { value: 96 },
    },
    depthTest: false,
    depthWrite: false,
  }) as CloudMaterial;
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9999;
  return { mesh, material };
}
