// ==========================================================================
// Shared ray-tracing GLSL chunks.
//
// Reusable GLSL building blocks consumed by every fullscreen-quad ray tracer
// plugin (black-hole, volumetric clouds, sky, ocean, ...). Each export is a
// plain GLSL string the consumer concatenates into its own fragment shader.
// Keep chunks dependency-ordered: RT_NOISE → (RT_BLACKBODY | RT_STARS |
// RT_SCATTER), RT_CAMERA standalone, RT_INTERSECT standalone, RT_SKY_SIMPLE
// standalone, RT_TONEMAP standalone.
// ==========================================================================

/** Fullscreen quad vertex shader — writes NDC directly, forwards vNdc. */
export const RT_CAMERA_VERTEX = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  // Fullscreen: write NDC directly (host camera matrices are consumed in FS).
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

/** Camera ray reconstruction from vNdc via uProjInv / uCamWorld. */
export const RT_CAMERA_RAY = /* glsl */ `
uniform mat4 uCamWorld;   // camera.matrixWorld (position + orientation)
uniform mat4 uProjInv;    // camera.projectionMatrixInverse

// Reconstructs the world-space ray (origin, unit direction) for this pixel.
void rtCameraRay(out vec3 ro, out vec3 rd) {
  vec4 tgt = uProjInv * vec4(vNdc, 1.0, 1.0);
  rd = normalize(mat3(uCamWorld) * (tgt.xyz / tgt.w));
  ro = uCamWorld[3].xyz;
}
`;

/** Tiny hash / value-noise / fbm kit shared by all procedural shaders. */
export const RT_NOISE = /* glsl */ `
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; return fract(p * (p + p)); }
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float vnoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash13(vec3(i, 7.0));
  float b = hash13(vec3(i + vec2(1.0, 0.0), 7.0));
  float c = hash13(vec3(i + vec2(0.0, 1.0), 7.0));
  float d = hash13(vec3(i + vec2(1.0, 1.0), 7.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm2(vec2 p) {
  float s = 0.0;
  float a = 0.55;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise2(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    a *= 0.5;
  }
  return s;
}
float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z);
}
// 3-octave value-noise fbm over a 3-D domain (marched volumes), normalised to
// 0..1 so a coverage threshold tuned once holds for every consumer.
float fbm3(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * vnoise3(p);
    p = p * 2.02 + vec3(11.3, 7.7, 19.1);
    a *= 0.5;
  }
  return s * 1.142857; // 1 / (0.5 + 0.25 + 0.125) — normalise the octave sum
}
`;

/** Approximate Planckian-locus colour (1000..40000 K), max-normalised. */
export const RT_BLACKBODY = /* glsl */ `
vec3 blackbody(float tK) {
  float t = clamp(tK, 1000.0, 40000.0) / 100.0;
  float r, g, b;
  if (t <= 66.0) {
    r = 1.0;
    g = clamp(0.3900816 * log(t) - 0.6318414, 0.0, 1.0);
  } else {
    r = clamp(1.292936 * pow(t - 60.0, -0.1332047), 0.0, 1.0);
    g = clamp(1.1298909 * pow(t - 60.0, -0.0755148), 0.0, 1.0);
  }
  if (t >= 66.0) b = 1.0;
  else if (t <= 19.0) b = 0.0;
  else b = clamp(0.5432068 * log(t - 10.0) - 1.1962541, 0.0, 1.0);
  return vec3(r, g, b) / max(max(r, g), b);
}
`;

/**
 * Procedural star field sampled on an escaped ray direction, with optional
 * celestial-sphere rotation (斗转星移): pass uCelestial (3x3, built in TS from
 * GMST + latitude) to rotate the whole sky so stars/sun/moon drift correctly.
 */
export const RT_STARS = /* glsl */ `
uniform float uStars;      // star density 0..2
uniform mat3 uCelestial;   // equatorial → local view rotation (identity = static)

vec3 starField(vec3 d) {
  vec3 dir = uCelestial * d; // rotate the celestial sphere with sidereal time
  vec3 col = vec3(0.0);
  // Three shells of cell-based stars; positions jittered per cell.
  for (int shell = 0; shell < 3; shell++) {
    float scale = 22.0 * pow(2.6, float(shell));
    vec3 p = dir * scale;
    vec3 cell = floor(p);
    // Search the 3x3x3 neighbourhood so stars near cell borders are found.
    for (int dx = -1; dx <= 1; dx++)
    for (int dy = -1; dy <= 1; dy++)
    for (int dz = -1; dz <= 1; dz++) {
      vec3 c = cell + vec3(float(dx), float(dy), float(dz));
      vec3 h = hash33(c);
      // Density gate: only some cells host a star.
      if (h.z > 0.82 - 0.18 * uStars) {
        vec3 sp = c + 0.15 + 0.7 * h;
        float dist = length(p - sp);
        float mag = pow(h.x, 6.0) * (0.4 + 0.6 * h.y);
        float star = mag * exp(-dist * dist * 42.0);
        // Star colour: mix warm/cool via another hash channel.
        vec3 tint = mix(vec3(1.0, 0.72, 0.5), vec3(0.62, 0.75, 1.0), h.y);
        col += star * 5.0 * tint;
      }
    }
  }
  // Faint nebula band (Milky-Way-ish), deflected with the same rays.
  float band = exp(-abs(dir.y + 0.18 * vnoise3(dir * 2.0) - 0.09) * 5.5);
  float neb = fbm2(vec2(atan(dir.z, dir.x) * 2.4, dir.y * 4.0) + 3.7);
  col += band * (0.028 + 0.05 * neb) * vec3(0.55, 0.62, 0.85);
  col += band * band * neb * 0.05 * vec3(0.9, 0.7, 0.55);
  return col;
}
`;

/** Participating-media helpers: Beer–Lambert extinction + Henyey–Greenstein. */
export const RT_SCATTER = /* glsl */ `
// Beer–Lambert transmittance through optical depth tau.
vec3 beerLambert(vec3 sigma, float tau) { return exp(-sigma * tau); }
// "Powder" darkening near cloud edges: dense material darkens view-in rays.
float powderEffect(float density) { return 1.0 - exp(-density * 2.0); }
// Henyey–Greenstein phase (single lobe): forward scatter for g > 0.
float hgPhase(float g, float cosTheta) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(max(1.0 + g2 - 2.0 * g * cosTheta, 1e-4), 1.5));
}
// Simple dual-lobe HG: back-scatter boost for realistic silver linings.
float hgPhaseDual(float g, float cosTheta) {
  return 0.7 * hgPhase(g, cosTheta) + 0.3 * hgPhase(-0.35 * g, cosTheta);
}
`;

/** Analytic ray/primitive intersections used by volume slabs and spheres. */
export const RT_INTERSECT = /* glsl */ `
// Ray–sphere: returns nearest positive hit distance, -1.0 when missed.
float raySphere(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float cc = dot(oc, oc) - r * r;
  float h = b * b - cc;
  if (h < 0.0) return -1.0;
  h = sqrt(h);
  float t = -b - h;
  if (t > 0.0) return t;
  t = -b + h;
  return t > 0.0 ? t : -1.0;
}
// Ray vs axis-aligned slab pair: returns (tNear, tFar); tNear > tFar ⇒ miss.
vec2 raySlab(vec3 ro, vec3 rd, float y0, float y1) {
  // Horizontal rays: inside → full span, outside → miss.
  if (abs(rd.y) < 1e-6) {
    float inside = step(y0, ro.y) * step(ro.y, y1);
    return vec2(inside > 0.5 ? 0.0 : 1.0, inside > 0.5 ? 1e9 : -1.0);
  }
  float inv = 1.0 / rd.y;
  float t0 = (y0 - ro.y) * inv;
  float t1 = (y1 - ro.y) * inv;
  return vec2(min(t0, t1), max(t0, t1));
}
`;

/** ACES-ish tonemap (Narkowicz fit), shared output stage. */
export const RT_TONEMAP = /* glsl */ `
vec3 tonemap(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
`;

/**
 * Analytic "one-bounce" sky shared by the landscape renderers (ocean, misty
 * peaks). Declares its own uniforms — consumers must NOT redeclare them:
 *   uSunDir / uSunColor / uSunIntensity / uAtmoHaze
 * The sun/moon direction and tint come from the host (real ephemeris); the
 * gradient, Mie forward glow, limb-darkened disk and dusk/horizon haze are
 * evaluated here so every scene keeps one consistent sky.
 */
export const RT_SKY_SIMPLE = /* glsl */ `
uniform vec3 uSunDir;        // world-space, normalized
uniform vec3 uSunColor;      // elevation-corrected beam tint from the host
uniform float uSunIntensity; // beam radiance multiplier
uniform float uAtmoHaze;     // 0..1 horizon veil loading (also tints the fog)

/** Sky radiance along a world-space view direction. */
vec3 skyRadiance(vec3 d) {
  float y = clamp(d.y, -0.2, 1.0);
  float sunUp = uSunDir.y;
  float day = smoothstep(-0.10, 0.20, sunUp);
  float dusk = exp(-pow((sunUp - 0.03) / 0.16, 2.0));

  // Horizontal bearing relative to the sun's azimuth: 0 behind, 1 towards it.
  // The warm sunrise/sunset band has to hug the sun instead of wrapping the
  // whole horizon — mixing orange into the blue zenith at every bearing is what
  // turns a dawn sky into a muddy purple wash.
  vec2 hd = normalize(vec2(d.x, d.z) + vec2(1e-5));
  vec2 hs = normalize(vec2(uSunDir.x, uSunDir.z) + vec2(1e-5));
  float towardSun = pow(clamp(dot(hd, hs) * 0.5 + 0.5, 0.0, 1.0), 2.0);

  // Rayleigh-ish gradient: deep blue overhead, pale at the horizon.
  vec3 zen = mix(vec3(0.010, 0.018, 0.046), vec3(0.105, 0.270, 0.620), day);
  zen = mix(zen, vec3(0.022, 0.050, 0.130), 0.55 * dusk);
  vec3 hor = mix(vec3(0.030, 0.042, 0.082), vec3(0.590, 0.680, 0.820), day);
  hor = mix(hor, vec3(0.180, 0.220, 0.330), 0.60 * dusk);
  float wy = 1.0 - clamp(y, 0.0, 1.0);
  vec3 col = mix(zen, hor, pow(wy, 4.0));
  // A thin ember band sits on the horizon, and only on the sun's side.
  col = mix(col, vec3(0.930, 0.590, 0.290), pow(wy, 9.0) * (0.28 + 0.72 * towardSun) * 0.92 * dusk);

  // Mie forward-scattering glow hugging the sun (strongest near the horizon).
  float mu = max(dot(d, uSunDir), 0.0);
  col += uSunColor * pow(mu, 6.0) * (0.45 + 0.55 * (1.0 - clamp(y, 0.0, 1.0)))
       * uSunIntensity * 0.035 * (0.45 + 0.55 * day + 0.60 * dusk);

  // Limb-darkened solar disk (angular radius ~0.267°).
  float ang = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
  float disk = 1.0 - smoothstep(0.0044, 0.0050, ang);
  float limb = sqrt(max(0.0, 1.0 - pow(ang / 0.0050, 2.0)));
  col += uSunColor * disk * (0.45 + 0.55 * limb) * uSunIntensity;

  // Horizon veil: warm grey toward the sun at dusk, cool grey elsewhere.
  float haze = exp(-max(y, 0.0) * 9.0) * uAtmoHaze;
  vec3 hazeCol = mix(vec3(0.58, 0.66, 0.76), vec3(0.94, 0.70, 0.44), 0.55 * dusk * towardSun);
  col = mix(col, hazeCol * (0.55 + 0.45 * day + 0.50 * dusk), clamp(haze, 0.0, 1.0) * 0.80);
  return col;
}

/** Sky just above the horizon toward d — the aerial-perspective target. */
vec3 horizonColor(vec3 d) {
  vec3 h = vec3(d.x, 0.0, d.z);
  if (dot(h, h) < 1e-8) h = vec3(0.0, 0.0, -1.0);
  return skyRadiance(normalize(h + vec3(0.0, 0.040, 0.0)));
}
`;
