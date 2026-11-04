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
//
// Camera ray, noise, blackbody, star field and tonemap chunks come from the
// shared core (`@/core/raytrace`); only the geodesic integration and disk
// emission are black-hole-specific.
// ==========================================================================

import { RT_BLACKBODY, RT_CAMERA_RAY, RT_CAMERA_VERTEX, RT_NOISE, RT_STARS, RT_TONEMAP } from '@/core/raytrace';

export const BLACKHOLE_VERTEX = RT_CAMERA_VERTEX;

export const BLACKHOLE_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vNdc;

uniform float uTime;      // animation time (s)
uniform float uDiskIn;    // inner disk radius (r_s), default ISCO = 3
uniform float uDiskOut;   // outer disk radius (r_s)
uniform float uTpeak;     // disk peak temperature (K)
uniform float uBright;    // disk brightness scale
uniform float uBeaming;   // 1 = relativistic beaming on
uniform float uRedshift;  // 1 = gravitational redshift on
uniform float uTurb;      // disk turbulence 0..1
uniform int uSteps;       // RK4 step budget

${RT_CAMERA_RAY}
${RT_NOISE}
${RT_BLACKBODY}
${RT_STARS}
${RT_TONEMAP}

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
  // I_obs = g⁴·I_em with I_em ∝ T_em⁴. Using the observed temperature
  // T_obs = g·T_em already carries the g⁴ factor, so no extra g⁴ here —
  // an additional explicit g⁴ would double-count beaming to g⁸.
  float e = uBright * pow(max(tob, 1.0) / 6500.0, 4.0) * pat * env;
  return blackbody(tob) * e;
}

void main() {
  // Reconstruct the world-space ray for this pixel (shared camera chunk).
  vec3 dir, ro;
  rtCameraRay(ro, dir);

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

import { Matrix3, Matrix4, Mesh, PlaneGeometry, ShaderMaterial } from 'three';

export interface BlackholeMaterial extends ShaderMaterial {
  uniforms: {
    uCamWorld: { value: import('three').Matrix4 };
    uProjInv: { value: import('three').Matrix4 };
    uCelestial: { value: import('three').Matrix3 };
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
      uCelestial: { value: new Matrix3() }, // static sky (no sidereal drift here)
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
