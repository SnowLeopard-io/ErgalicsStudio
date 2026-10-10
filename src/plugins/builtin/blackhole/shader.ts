// ==========================================================================
// Black-hole plugin — GLSL per-pixel null-geodesic ray tracer.
//
// A fullscreen quad is drawn last (depthTest off, high renderOrder) and for
// every pixel integrates the Schwarzschild null geodesic (Binet form,
// u'' = −u + 1.5·u², r_s = 1 units) with RK4 in the ray's orbital plane.
// Disk crossings accumulate emission with relativistic Doppler beaming and
// gravitational redshift; captured rays stay black; escaped rays sample a
// procedural, gravitationally lensed star field — the shadow, photon ring
// and Einstein ring all emerge from the integration itself.
// ==========================================================================

export const BLACKHOLE_VERTEX = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  // Fullscreen: write NDC directly (host camera matrices are consumed in FS).
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

export const BLACKHOLE_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vNdc;

uniform mat4 uCamWorld;   // camera.matrixWorld (position + orientation)
uniform mat4 uProjInv;    // camera.projectionMatrixInverse
uniform float uTime;      // animation time (s)
uniform float uDiskIn;    // inner disk radius (r_s), default ISCO = 3
uniform float uDiskOut;   // outer disk radius (r_s)
uniform float uTpeak;     // disk peak temperature (K)
uniform float uBright;    // disk brightness scale
uniform float uBeaming;   // 1 = relativistic beaming on
uniform float uRedshift;  // 1 = gravitational redshift on
uniform float uStars;     // star density 0..2
uniform float uTurb;      // disk turbulence 0..1
uniform int uSteps;       // RK4 step budget

// ---- tiny hash / noise kit -------------------------------------------------
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

// ---- approximate Planckian-locus colour (1000..40000 K), max-normalised ----
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

// ---- procedural star field sampled on the escaped ray direction -------------
vec3 starField(vec3 d) {
  vec3 col = vec3(0.0);
  // Three shells of cell-based stars; positions jittered per cell.
  for (int shell = 0; shell < 3; shell++) {
    float scale = 22.0 * pow(2.6, float(shell));
    vec3 p = d * scale;
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
  // Faint nebula band ( Milky-Way-ish ), deflected with the same rays.
  float band = exp(-abs(d.y + 0.18 * vnoise3(d * 2.0) - 0.09) * 5.5);
  float neb = fbm2(vec2(atan(d.z, d.x) * 2.4, d.y * 4.0) + 3.7);
  col += band * (0.028 + 0.05 * neb) * vec3(0.55, 0.62, 0.85);
  col += band * band * neb * 0.05 * vec3(0.9, 0.7, 0.55);
  return col;
}

// ---- relativistic disk emission at a crossing point -------------------------
// pos: crossing point (r_s units); tang: backward-trace tangent (unit, points
// away from camera along the geodesic); returns premultiplied RGB emission.
vec3 diskEmission(vec3 pos, vec3 tang, float r) {
  // Keplerian orbital direction (counter-clockwise about +y): v̂ ∝ (z, 0, −x)
  vec3 vdir = normalize(vec3(pos.z, 0.0, -pos.x));
  // Local circular-orbit speed: v² = 1/(2(r − 1)) in r_s units → β
  float beta = clamp(1.0 / sqrt(max(2.0 * (r - 1.0), 0.35)), 0.0, 0.999);
  // Photon travels toward the camera = opposite the backward-trace tangent.
  float cosPsi = dot(vdir, -tang);
  // Total shift g = g_grav · g_sr; I_obs = g⁴·I_em and T_obs = g·T_em.
  float g = 1.0;
  if (uRedshift > 0.5) g *= sqrt(max(1.0 - 1.0 / r, 0.02));
  if (uBeaming > 0.5) {
    float gam = 1.0 / sqrt(max(1.0 - beta * beta, 1e-4));
    g /= gam * (1.0 - beta * cosPsi);
  }
  // Shakura–Sunyaev temperature profile normalised to uTpeak at r = 49/36·rIn.
  float x = max(r / uDiskIn, 1.0001);
  float f = pow(x, -0.75) * pow(max(1.0 - pow(x, -0.5), 0.0), 0.25);
  float xp = 49.0 / 36.0;
  float fp = pow(xp, -0.75) * pow(1.0 - pow(xp, -0.5), 0.25);
  float tem = uTpeak * f / fp;
  float tob = g * tem;
  // Turbulent ring pattern sheared by the (differential) Keplerian rotation.
  float omega = 0.9 / (pow(r, 1.5) + 1e-3);
  float ang = atan(pos.z, pos.x) + omega * uTime * 0.55;
  float rings = fbm2(vec2(log(r) * 5.2, ang * 1.9));
  float pat = mix(0.75, 0.55 + 0.9 * rings, uTurb);
  // Radial envelope: soft inner/outer edges.
  float env = smoothstep(uDiskIn, uDiskIn * 1.06, r) * (1.0 - smoothstep(uDiskOut * 0.72, uDiskOut, r));
  float e = uBright * g * g * g * g * pow(max(tob, 1.0) / 6500.0, 4.0) * pat * env;
  return blackbody(tob) * e;
}

// ---- ACES-ish tonemap --------------------------------------------------------
vec3 tonemap(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  // Reconstruct the world-space ray for this pixel.
  vec4 tgt = uProjInv * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(mat3(uCamWorld) * (tgt.xyz / tgt.w));
  vec3 ro = uCamWorld[3].xyz;

  vec3 col = vec3(0.0);
  float trans = 1.0;

  // Orbital-plane basis: e1 = camera direction from the BH, e2 ⊥ e1 in-plane.
  float r0 = length(ro);
  vec3 rHat = ro / max(r0, 1e-6);
  vec3 nrm = cross(rHat, dir);
  float nlen = length(nrm);
  if (nlen < 1e-5) {
    // Radial ray: falls straight in (or straight out) — no plane needed.
    if (dot(dir, rHat) > 0.0) col = starField(dir) * uStars;
    gl_FragColor = vec4(tonemap(col * 1.25), 1.0);
    return;
  }
  nrm /= nlen;
  vec3 e1 = rHat;
  vec3 e2 = normalize(cross(nrm, e1)); // points toward the ray's transverse part

  float u = 1.0 / r0;
  float phiHat = dot(dir, e2);            // > 0 by construction
  float v = -u * dot(dir, e1) / phiHat;   // u' from the ray direction
  float phi = 0.0;

  // Adaptive RK4 step: fine near the hole (u large), coarse far away.
  float dphi0 = 10.0 / float(uSteps) + 0.006;
  float prevY = ro.y;
  vec3 prevPos = ro;

  for (int i = 0; i < 640; i++) {
    if (i >= uSteps) break;
    float dphi = clamp(dphi0 / (4.0 * u * u + 0.02), 0.008, 0.45);

    // RK4 on (u' = v, v' = −u + 1.5u²), r_s = 1.
    float k1u = v;               float k1v = -u + 1.5 * u * u;
    float u2 = u + 0.5 * dphi * k1u; float v2 = v + 0.5 * dphi * k1v;
    float k2u = v2;              float k2v = -u2 + 1.5 * u2 * u2;
    float u3 = u + 0.5 * dphi * k2u; float v3 = v + 0.5 * dphi * k2v;
    float k3u = v3;              float k3v = -u3 + 1.5 * u3 * u3;
    float u4 = u + dphi * k3u;   float v4 = v + dphi * k3v;
    float k4u = v4;              float k4v = -u4 + 1.5 * u4 * u4;
    u += (dphi / 6.0) * (k1u + 2.0 * k2u + 2.0 * k3u + k4u);
    v += (dphi / 6.0) * (k1v + 2.0 * k2v + 2.0 * k3v + k4v);
    phi += dphi;

    if (u >= 1.0) { trans = 0.0; break; }          // captured by the horizon
    if (u <= 3.3e-4) break;                        // escaped (r > 3000 r_s)

    // 3-D position on the orbital plane at angle φ.
    float r = 1.0 / u;
    float cf = cos(phi);
    float sf = sin(phi);
    vec3 pos = r * (cf * e1 + sf * e2);

    // Disk plane (y = 0) crossing → interpolate the hit point.
    if (prevPos.y * pos.y < 0.0) {
      float t = prevY / (prevY - pos.y);
      vec3 hit = mix(prevPos, pos, t);
      float rh = length(hit.xz);
      if (rh > uDiskIn && rh < uDiskOut) {
        // Unit tangent of the backward-traced path: T̂ ∝ −u'·ê_r + u·ê_φ.
        vec3 eR = (cf * e1 + sf * e2);
        vec3 ePhi = (-sf * e1 + cf * e2);
        vec3 tang = normalize(-v * eR + u * ePhi);
        vec3 emit = diskEmission(hit, tang, rh);
        float dens = clamp(length(emit) * 0.9 + 0.12, 0.0, 1.0);
        col += trans * emit;
        trans *= 1.0 - clamp(dens, 0.0, 0.92);
        if (trans < 0.02) break;
      }
    }
    prevPos = pos;
    prevY = pos.y;
  }

  if (trans > 0.02) {
    // Escaped direction = path tangent at the last point.
    float cf = cos(phi);
    float sf = sin(phi);
    vec3 eR = (cf * e1 + sf * e2);
    vec3 ePhi = (-sf * e1 + cf * e2);
    vec3 outDir = normalize(-v * eR + u * ePhi);
    col += trans * starField(outDir) * (0.4 + 0.6 * uStars);
  }

  gl_FragColor = vec4(tonemap(col * 1.2), 1.0);
}
`;

import { Matrix4, Mesh, PlaneGeometry, ShaderMaterial } from 'three';

export interface BlackholeMaterial extends ShaderMaterial {
  uniforms: {
    uCamWorld: { value: import('three').Matrix4 };
    uProjInv: { value: import('three').Matrix4 };
    uTime: { value: number };
    uDiskIn: { value: number };
    uDiskOut: { value: number };
    uTpeak: { value: number };
    uBright: { value: number };
    uBeaming: { value: number };
    uRedshift: { value: number };
    uStars: { value: number };
    uTurb: { value: number };
    uSteps: { value: number };
  };
}

/** Build the fullscreen ray-tracer quad (call `scene.add(mesh)`). */
export function createBlackholeQuad(): { mesh: Mesh; material: BlackholeMaterial } {
  const geometry = new PlaneGeometry(2, 2);
  const material = new ShaderMaterial({
    vertexShader: BLACKHOLE_VERTEX,
    fragmentShader: BLACKHOLE_FRAGMENT,
    uniforms: {
      uCamWorld: { value: new Matrix4() },
      uProjInv: { value: new Matrix4() },
      uTime: { value: 0 },
      uDiskIn: { value: 3 },
      uDiskOut: { value: 16 },
      uTpeak: { value: 6500 },
      uBright: { value: 1 },
      uBeaming: { value: 1 },
      uRedshift: { value: 1 },
      uStars: { value: 1 },
      uTurb: { value: 0.55 },
      uSteps: { value: 192 },
    },
    depthTest: false,
    depthWrite: false,
  }) as BlackholeMaterial;
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9999; // painted last: covers the host grid/axes furniture
  return { mesh, material };
}
