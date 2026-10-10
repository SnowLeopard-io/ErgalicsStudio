// ==========================================================================
// Water-waves plugin — GLSL kernels.
//
// 1. Solver: ping-pong FDTD leapfrog pass of h_tt = A²∇²h over a half-float
//    render target, with sponge-layer absorbing boundaries, continuous
//    sinusoidal point sources (interference demos) and transient drops.
//    The stencil mirrors `physics.ts::waveStepFdtd` exactly.
// 2. Surface: ripples displace the grid from the height texture; the ocean
//    sums the Gerstner trains built in TS (`physics.ts::buildSpectrum`) and
//    uploaded as uniform arrays — GPU renders the same tested physics.
// 3. Floor: procedural pool tiles lit through a curvature-based caustic
//    factor and gradient-refracted sampling.
// ==========================================================================

import {
  HalfFloatType,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  type Texture,
  Vector4,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';

// ---- fullscreen quad passthrough (sim passes) --------------------------------
export const SIM_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// ---- FDTD solver pass (ping-pong) ---------------------------------------------
export const SOLVER_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform sampler2D uCurr;
uniform vec2 uTexel;
uniform float uA2;        // A² = (c·dt/dx)²
uniform float uDamping;   // per-step damping (0.9..1)
uniform float uAbsorb;    // 1 = sponge-layer absorbing edges, 0 = reflective
uniform vec4 uDrops[8];   // xy = uv pos, z = radius (uv), w = amplitude
uniform int uDropCount;
uniform vec4 uSources[2]; // xy = uv pos, z = omega (rad/step), w = amplitude
uniform int uSourceCount;
uniform float uStep;      // discrete step counter (source phase)

float sampleH(vec2 uv) { return texture2D(uCurr, uv).r; }

void main() {
  vec2 uv = vUv;
  float hc = sampleH(uv);
  float hp = texture2D(uPrev, uv).r;
  float sum =
    sampleH(uv + vec2(uTexel.x, 0.0)) + sampleH(uv - vec2(uTexel.x, 0.0)) +
    sampleH(uv + vec2(0.0, uTexel.y)) + sampleH(uv - vec2(0.0, uTexel.y));
  float hn = 2.0 * hc - hp + uA2 * (sum - 4.0 * hc);

  // Continuous sinusoidal point sources (double-source interference).
  for (int i = 0; i < 2; i++) {
    if (i >= uSourceCount) break;
    vec2 d = uv - uSources[i].xy;
    float g = exp(-dot(d, d) / (2.0 * 0.0035));
    hn += uSources[i].w * g * sin(uSources[i].z * uStep);
  }
  // Transient drops (gaussian impulse added to h_new).
  for (int i = 0; i < 8; i++) {
    if (i >= uDropCount) break;
    vec2 d = uv - uDrops[i].xy;
    float s = max(uDrops[i].z, 1e-4);
    float g = exp(-dot(d, d) / (2.0 * s * s));
    hn += uDrops[i].w * g;
  }

  hn *= uDamping;

  // Sponge layer: quadratic damping ramp within the outer 7% of the domain.
  if (uAbsorb > 0.5) {
    float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float s = clamp(edge / 0.07, 0.0, 1.0);
    hn *= 1.0 - 0.22 * (1.0 - s) * (1.0 - s);
  }
  gl_FragColor = vec4(hn, 0.0, 0.0, 1.0);
}
`;

// ---- shared sky / sun shading --------------------------------------------------
const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;    // normalised toward the sun
const vec3 SKY_ZENITH = vec3(0.16, 0.34, 0.62);
const vec3 SKY_HORIZON = vec3(0.66, 0.78, 0.92);

vec3 skyColor(vec3 dir) {
  float t = clamp(dir.y, 0.0, 1.0);
  vec3 sky = mix(SKY_HORIZON, SKY_ZENITH, pow(t, 0.55));
  float sun = max(dot(dir, uSunDir), 0.0);
  sky += vec3(1.0, 0.88, 0.7) * pow(sun, 900.0) * 12.0; // sun disk
  sky += vec3(1.0, 0.82, 0.6) * pow(sun, 6.0) * 0.12;   // haze glow
  return sky;
}
`;

// ---- Gerstner sum (uniform array = TS-tested spectrum) --------------------------
const GERSTNER_GLSL = /* glsl */ `
uniform vec4 uWavesA[26]; // k, omega, amplitude, q
uniform vec4 uWavesB[26]; // dirX, dirZ, phase, unused
uniform int uWaveCount;

// Sums the Gerstner trains; also returns the two tangent vectors so the
// fragment stage gets an analytic normal, and the folding Jacobian.
void oceanDisplace(vec2 xm, float t, out vec3 disp, out vec3 dx, out vec3 dz, out float jacobi) {
  disp = vec3(0.0);
  dx = vec3(1.0, 0.0, 0.0);
  dz = vec3(0.0, 0.0, 1.0);
  float jxx = 1.0;
  float jzz = 1.0;
  float jxz = 0.0;
  for (int i = 0; i < 26; i++) {
    if (i >= uWaveCount) break;
    float k = uWavesA[i].x;
    float omega = uWavesA[i].y;
    float amp = uWavesA[i].z;
    float q = uWavesA[i].w;
    vec2 dirv = uWavesB[i].xy;
    float phase = uWavesB[i].z;
    float th = k * dot(dirv, xm) - omega * t + phase;
    float s = sin(th);
    float c = cos(th);
    float qa = q * amp;
    disp += vec3(-qa * dirv.x * s, amp * c, -qa * dirv.y * s);
    // Analytic tangent accumulation (GPU Gems 1, ch. 1).
    float wa = k * amp;
    dx += vec3(-qa * dirv.x * dirv.x * k * c, -dirv.x * wa * s, -qa * dirv.x * dirv.y * k * c);
    dz += vec3(-qa * dirv.x * dirv.y * k * c, -dirv.y * wa * s, -qa * dirv.y * dirv.y * k * c);
    jxx -= qa * dirv.x * dirv.x * k * c;
    jzz -= qa * dirv.y * dirv.y * k * c;
    jxz -= qa * dirv.x * dirv.y * k * c;
  }
  jacobi = jxx * jzz - jxz * jxz;
}
`;

// ---- water surface (ripples + ocean in one material, uMode switch) --------------
export const SURFACE_VERTEX = /* glsl */ `
precision highp float;
uniform sampler2D uHeight;
uniform float uMode;       // 0 = ripples, 1 = ocean
uniform float uHScale;     // vertical exaggeration (ripples)
uniform float uTime;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vJacobi;
varying float vHeight;

${GERSTNER_GLSL}

void main() {
  vUv = uv;
  vec3 p = position;
  vec3 nrm = vec3(0.0, 1.0, 0.0);
  float jac = 1.0;
  if (uMode < 0.5) {
    float h = texture2D(uHeight, uv).r;
    vHeight = h * uHScale;
    p.y += h * uHScale;
  } else {
    // Ocean mesh spans ±1000 in world metres already.
    vec3 disp;
    vec3 dx;
    vec3 dz;
    oceanDisplace(position.xz, uTime, disp, dx, dz, jac);
    p += disp;
    vHeight = disp.y;
    nrm = normalize(cross(dz, dx));
  }
  vJacobi = jac;
  vNormalW = nrm;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const SURFACE_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vJacobi;
varying float vHeight;

uniform sampler2D uHeight;
uniform vec2 uTexel;
uniform float uMode;
uniform vec3 uCamPos;
uniform float uFoam;       // Jacobian threshold for foam

${SKY_GLSL}

void main() {
  vec3 n = normalize(vNormalW);
  vec3 viewDir = normalize(uCamPos - vWorldPos);

  if (uMode < 0.5) {
    // Ripples: normal from central differences of the height texture.
    float hL = texture2D(uHeight, vUv - vec2(uTexel.x, 0.0)).r;
    float hR = texture2D(uHeight, vUv + vec2(uTexel.x, 0.0)).r;
    float hD = texture2D(uHeight, vUv - vec2(0.0, uTexel.y)).r;
    float hU = texture2D(uHeight, vUv + vec2(0.0, uTexel.y)).r;
    // World size 16 m across uv [0,1]; scale 4 ≈ half-grid spacing factor.
    vec3 grad = vec3((hR - hL) * 4.0, 0.0, (hU - hD) * 4.0);
    n = normalize(vec3(-grad.x, 1.0, -grad.z));
  }

  // Fresnel (Schlick, F0 = 0.02 for water).
  float cosV = max(dot(n, viewDir), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);

  vec3 refl = reflect(-viewDir, n);
  refl.y = abs(refl.y);
  vec3 sky = skyColor(refl);

  // Sun specular (Blinn).
  vec3 halfV = normalize(uSunDir + viewDir);
  float spec = pow(max(dot(n, halfV), 0.0), 360.0) * 3.2;

  // Water body colour: absorption tint, modulated by the local height.
  vec3 deep = vec3(0.03, 0.14, 0.18);
  vec3 shallow = vec3(0.10, 0.42, 0.45);
  float hmix = uMode < 0.5 ? clamp(vHeight * 24.0 + 0.5, 0.0, 1.0)
                           : clamp(vHeight * 0.35 + 0.5, 0.0, 1.0);
  vec3 body = mix(deep, shallow, hmix);

  vec3 col = mix(body, sky, clamp(fres, 0.0, 1.0)) + vec3(1.0, 0.95, 0.85) * spec;

  // Foam where the Gerstner surface folds (Jacobian below threshold).
  if (uMode > 0.5) {
    float foam = smoothstep(uFoam + 0.12, uFoam - 0.12, vJacobi);
    col = mix(col, vec3(0.92, 0.96, 0.98), foam * 0.85);
  }

  // Distance fog toward the sky horizon (ocean edge blend).
  float dist = length(uCamPos - vWorldPos);
  float fog = 1.0 - exp(-max(dist - 250.0, 0.0) / 700.0);
  col = mix(col, SKY_HORIZON, fog);

  gl_FragColor = vec4(col, 1.0);
}
`;

// ---- pool floor with refraction-style tiles and caustics ------------------------
export const FLOOR_VERTEX = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const FLOOR_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D uHeight;
uniform vec2 uTexel;
uniform float uDepth;      // water depth, metres
uniform float uCaustics;

void main() {
  // Surface gradient refracts the sight ray (small-angle Snell): shift the
  // floor sampling position by grad·depth.
  float hL = texture2D(uHeight, vUv - vec2(uTexel.x, 0.0)).r;
  float hR = texture2D(uHeight, vUv + vec2(uTexel.x, 0.0)).r;
  float hD = texture2D(uHeight, vUv - vec2(0.0, uTexel.y)).r;
  float hU = texture2D(uHeight, vUv + vec2(0.0, uTexel.y)).r;
  vec2 grad = vec2(hR - hL, hU - hD);
  vec2 fuv = vUv + grad * uDepth * 1.2;

  // Procedural pool tiles (0.4 m grid over the 16 m pool).
  vec2 gp = fuv * 40.0;
  vec2 cell = abs(fract(gp) - 0.5);
  float line = smoothstep(0.44, 0.5, max(cell.x, cell.y));
  vec3 tileA = vec3(0.75, 0.86, 0.88);
  vec3 tileB = vec3(0.55, 0.74, 0.82);
  float checker = mod(floor(gp.x) + floor(gp.y), 2.0);
  vec3 floorCol = mix(tileA, tileB, checker);
  floorCol = mix(floorCol, vec3(0.35, 0.55, 0.62), line * 0.6);

  // Caustics: thin-lens focusing ∝ curvature. Convex-up regions (Laplacian < 0)
  // converge light → brighten the floor.
  float hc = texture2D(uHeight, vUv).r;
  float lap = (hL + hR + hD + hU - 4.0 * hc);
  float caustic = clamp(1.0 - uCaustics * lap * 64.0, 0.0, 5.0);
  caustic = pow(caustic, 2.2);

  // Water absorbance tints the floor blue-green with depth.
  vec3 absorb = exp(-vec3(0.35, 0.08, 0.04) * uDepth * 1.4);
  vec3 col = floorCol * absorb * (0.55 + 0.45 * caustic);

  gl_FragColor = vec4(col, 1.0);
}
`;

// ---- simulation plumbing ---------------------------------------------------------

export interface SolverMaterial extends ShaderMaterial {
  uniforms: {
    uPrev: { value: Texture | null };
    uCurr: { value: Texture | null };
    uTexel: { value: { x: number; y: number } };
    uA2: { value: number };
    uDamping: { value: number };
    uAbsorb: { value: number };
    uDrops: { value: Vector4[] };
    uDropCount: { value: number };
    uSources: { value: Vector4[] };
    uSourceCount: { value: number };
    uStep: { value: number };
  };
}

export interface WaterSim {
  /** Advance one FDTD step; pass drops only on the first substep of a frame. */
  step(drops: Array<{ x: number; y: number; radius: number; amp: number }>): void;
  /** Height texture of the current state (bind as a sampler2D uniform value). */
  texture(): Texture;
  /** Reset both buffers to zero. */
  reset(): void;
  resize(n: number): void;
  dispose(): void;
  readonly size: number;
  stepCount(): number;
  setDamping(d: number): void;
  setAbsorb(on: boolean): void;
  setSources(srcs: Array<{ x: number; y: number; omega: number; amp: number }>): void;
}

export interface SimDrop {
  x: number;
  y: number;
  radius: number;
  amp: number;
}

/**
 * Ping-pong FDTD wave solver driving two half-float N×N render targets.
 * Deterministic: identical inputs → identical heights (no randomness inside).
 */
export function createWaterSim(renderer: WebGLRenderer, n: number): WaterSim {
  let size = n;
  const rtOpts = {
    type: HalfFloatType,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  } as const;
  // Three rotating buffers: the leapfrog stencil samples BOTH h(t) (rtA) and
  // h(t−1) (rtB), so the new field must go into a third target — writing into
  // a bound sampler would be a WebGL feedback loop (black screen after any
  // non-zero wave content appears).
  let rtA = new WebGLRenderTarget(size, size, rtOpts);
  let rtB = new WebGLRenderTarget(size, size, rtOpts);
  let rtC = new WebGLRenderTarget(size, size, rtOpts);
  const quadScene = new Scene();
  const quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const solverMat = new ShaderMaterial({
    vertexShader: SIM_VERTEX,
    fragmentShader: SOLVER_FRAGMENT,
    uniforms: {
      uPrev: { value: null },
      uCurr: { value: null },
      uTexel: { value: { x: 1 / size, y: 1 / size } },
      uA2: { value: 0.25 },
      uDamping: { value: 0.9985 },
      uAbsorb: { value: 1 },
      // Fixed-length GLSL arrays: three.js' PureArrayUniform flattening indexes
      // the DECLARED size and calls Vector4.prototype.toArray on each element,
      // so the JS arrays must carry exactly 8 / 2 real Vector4 instances.
      // Unused slots are zeros; uDropCount / uSourceCount gate real usage.
      uDrops: { value: Array.from({ length: 8 }, () => new Vector4()) },
      uDropCount: { value: 0 },
      uSources: { value: [new Vector4(), new Vector4()] },
      uSourceCount: { value: 0 },
      uStep: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  }) as SolverMaterial;
  const quad = new Mesh(new PlaneGeometry(2, 2), solverMat);
  quad.frustumCulled = false;
  quadScene.add(quad);

  let steps = 0;

  const clearTo = (rt: WebGLRenderTarget) => {
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.setRenderTarget(null);
  };
  clearTo(rtA);
  clearTo(rtB);
  clearTo(rtC);

  const api: WaterSim = {
    step(drops) {
      // Sample h(t) from rtA and h(t−1) from rtB; write h(t+1) into the unused
      // rtC, then rotate (A,B,C) → the write target becomes the newest field.
      solverMat.uniforms.uPrev.value = rtB.texture;
      solverMat.uniforms.uCurr.value = rtA.texture;
      solverMat.uniforms.uDropCount.value = drops.length;
      // Pad back to the declared uDrops[8] size (three.js flatten requirement).
      const dropArr = solverMat.uniforms.uDrops.value;
      for (let i = 0; i < 8; i++) {
        const d = drops[i];
        const v = dropArr[i] ?? (dropArr[i] = new Vector4());
        if (d) v.set(d.x, d.y, d.radius, d.amp);
        else v.set(0, 0, 0, 0);
      }
      solverMat.uniforms.uStep.value = steps;
      renderer.setRenderTarget(rtC);
      renderer.render(quadScene, quadCam);
      renderer.setRenderTarget(null);
      const old = rtB;
      rtB = rtA;
      rtA = rtC;
      rtC = old;
      steps++;
    },
    texture() {
      return rtA.texture;
    },
    reset() {
      clearTo(rtA);
      clearTo(rtB);
      clearTo(rtC);
      steps = 0;
    },
    resize(nNew) {
      if (nNew === size) return;
      size = nNew;
      rtA.dispose();
      rtB.dispose();
      rtC.dispose();
      rtA = new WebGLRenderTarget(size, size, rtOpts);
      rtB = new WebGLRenderTarget(size, size, rtOpts);
      rtC = new WebGLRenderTarget(size, size, rtOpts);
      solverMat.uniforms.uTexel.value = { x: 1 / size, y: 1 / size };
      clearTo(rtA);
      clearTo(rtB);
      clearTo(rtC);
    },
    dispose() {
      rtA.dispose();
      rtB.dispose();
      rtC.dispose();
      quad.geometry.dispose();
      solverMat.dispose();
    },
    get size() {
      return size;
    },
    stepCount() {
      return steps;
    },
    setDamping(d: number) {
      solverMat.uniforms.uDamping.value = d;
    },
    setAbsorb(on: boolean) {
      solverMat.uniforms.uAbsorb.value = on ? 1 : 0;
    },
    setSources(srcs) {
      const list = srcs.slice(0, 2);
      solverMat.uniforms.uSourceCount.value = list.length;
      // Pad back to the declared uSources[2] size (three.js flatten requirement).
      const arr = solverMat.uniforms.uSources.value;
      for (let i = 0; i < 2; i++) {
        const s = list[i];
        const v = arr[i] ?? (arr[i] = new Vector4());
        if (s) v.set(s.x, s.y, s.omega, s.amp);
        else v.set(0, 0, 0, 0);
      }
    },
  };
  return api;
}
