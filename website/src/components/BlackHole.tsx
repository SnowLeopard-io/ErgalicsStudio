import { useEffect, useRef, useState } from 'react';

// ==========================================================================
// Live black-hole hero render (WebGPU).
//
// A self-contained port of the workbench's fx-blackhole plugin math
// (src/plugins/builtin/blackhole) — per-pixel Schwarzschild null-geodesic
// integration in Binet form (u'' = −u + 1.5u², r_s = 1) with adaptive RK4,
// thin-disk emission with relativistic Doppler beaming + gravitational
// redshift (g⁴ intensity law via T_obs = g·T_em), and a procedural,
// gravitationally-lensed star field. The camera is a fixed slow cinematic
// orbit computed in-shader, so no matrix uniforms are needed.
//
// Robustness contract: no WebGPU / failed init → CSS fallback art; the loop
// parks when scrolled offscreen (IntersectionObserver); prefers-reduced-motion
// renders a single static frame; frame-time EMA shrinks/grows the internal
// resolution like the workbench SkyLoop. Never mutates the workbench source.
// ==========================================================================

const STEPS = 192; // RK4 step budget — matches the plugin default
const FIXED = /* wgsl */ `
struct U {
  time: f32,
  aspect: f32,
  res: vec2f,
};
@group(0) @binding(0) var<uniform> u: U;

struct VOut {
  @builtin(position) pos: vec4f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  return o;
}

// ---- noise kit (port of the shared core RT_NOISE subset) --------------------
fn hash13(p3in: vec3f) -> f32 {
  var p3 = fract(p3in * 0.1031);
  p3 += vec3f(dot(p3, p3.zyx + vec3f(31.32)));
  return fract((p3.x + p3.y) * p3.z);
}
fn hash33(pin: vec3f) -> vec3f {
  var p = fract(pin * vec3f(0.1031, 0.1030, 0.0973));
  p += vec3f(dot(p, p.yxz + vec3f(33.33)));
  return fract((p.xxy + p.yxx) * p.zyx);
}
fn vnoise2(p: vec2f) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let a = hash13(vec3f(i, 7.0));
  let b = hash13(vec3f(i + vec2f(1.0, 0.0), 7.0));
  let c = hash13(vec3f(i + vec2f(0.0, 1.0), 7.0));
  let d = hash13(vec3f(i + vec2f(1.0, 1.0), 7.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
fn fbm2(pin: vec2f) -> f32 {
  var p = pin;
  var s = 0.0;
  var a = 0.55;
  for (var k = 0; k < 4; k++) {
    s += a * vnoise2(p);
    p = p * 2.03 + vec2f(17.1, 9.7);
    a *= 0.5;
  }
  return s;
}
fn vnoise3(p: vec3f) -> f32 {
  let i = floor(p);
  let f0 = fract(p);
  let f = f0 * f0 * (3.0 - 2.0 * f0);
  let n000 = hash13(i);
  let n100 = hash13(i + vec3f(1.0, 0.0, 0.0));
  let n010 = hash13(i + vec3f(0.0, 1.0, 0.0));
  let n110 = hash13(i + vec3f(1.0, 1.0, 0.0));
  let n001 = hash13(i + vec3f(0.0, 0.0, 1.0));
  let n101 = hash13(i + vec3f(1.0, 0.0, 1.0));
  let n011 = hash13(i + vec3f(0.0, 1.0, 1.0));
  let n111 = hash13(i + vec3f(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z);
}

// ---- approximate Planckian-locus colour (port of RT_BLACKBODY) --------------
fn blackbody(tKin: f32) -> vec3f {
  let t = clamp(tKin, 1000.0, 40000.0) / 100.0;
  var r: f32;
  var g: f32;
  var b: f32;
  if (t <= 66.0) {
    r = 1.0;
    g = clamp(0.3900816 * log(t) - 0.6318414, 0.0, 1.0);
  } else {
    r = clamp(1.292936 * pow(t - 60.0, -0.1332047), 0.0, 1.0);
    g = clamp(1.1298909 * pow(t - 60.0, -0.0755148), 0.0, 1.0);
  }
  if (t >= 66.0) { b = 1.0; }
  else if (t <= 19.0) { b = 0.0; }
  else { b = clamp(0.5432068 * log(t - 10.0) - 1.1962541, 0.0, 1.0); }
  return vec3f(r, g, b) / max(max(r, g), b);
}

// ---- procedural star field (port of RT_STARS, static sky, density 1.0) ------
fn starField(dir: vec3f) -> vec3f {
  var col = vec3f(0.0);
  for (var shell = 0; shell < 3; shell++) {
    let scale = 22.0 * pow(2.6, f32(shell));
    let p = dir * scale;
    let cell = floor(p);
    for (var dx = -1; dx <= 1; dx++) {
      for (var dy = -1; dy <= 1; dy++) {
        for (var dz = -1; dz <= 1; dz++) {
          let c = cell + vec3f(f32(dx), f32(dy), f32(dz));
          let h = hash33(c);
          if (h.z > 0.64) {
            let sp = c + vec3f(0.15) + vec3f(0.7) * h;
            let dist = length(p - sp);
            let mag = pow(h.x, 6.0) * (0.4 + 0.6 * h.y);
            let star = mag * exp(-dist * dist * 42.0);
            let tint = mix(vec3f(1.0, 0.72, 0.5), vec3f(0.62, 0.75, 1.0), h.y);
            col += star * 5.0 * tint;
          }
        }
      }
    }
  }
  // faint Milky-Way-ish nebula band
  let band = exp(-abs(dir.y + 0.18 * vnoise3(dir * 2.0) - 0.09) * 5.5);
  let neb = fbm2(vec2f(atan2(dir.z, dir.x) * 2.4, dir.y * 4.0) + vec2f(3.7, 3.7));
  col += band * (0.028 + 0.05 * neb) * vec3f(0.55, 0.62, 0.85);
  col += band * band * neb * 0.05 * vec3f(0.9, 0.7, 0.55);
  return col;
}

// ---- ACES-ish tonemap (port of RT_TONEMAP) ----------------------------------
fn tonemap(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + vec3f(0.03))) / (x * (2.43 * x + vec3f(0.59)) + vec3f(0.14)), vec3f(0.0), vec3f(1.0));
}

// ---- relativistic disk emission (port of the plugin's diskEmission) ---------
// Fixed parameters mirror the plugin defaults: diskIn 3, diskOut 15,
// Tpeak 6500 K, brightness 1, beaming on, redshift on, turbulence 0.55.
fn diskEmission(pos: vec3f, tang: vec3f, r: f32, time: f32) -> vec3f {
  let vdir = normalize(vec3f(pos.z, 0.0, -pos.x));
  let beta = clamp(1.0 / sqrt(max(2.0 * (r - 1.0), 0.35)), 0.0, 0.999);
  let cosPsi = dot(vdir, -tang);
  var g = 1.0;
  g *= sqrt(max(1.0 - 1.0 / r, 0.02));
  let gam = 1.0 / sqrt(max(1.0 - beta * beta, 1e-4));
  g /= gam * (1.0 - beta * cosPsi);
  let x = max(r / 3.0, 1.0001);
  let f = pow(x, -0.75) * pow(max(1.0 - pow(x, -0.5), 0.0), 0.25);
  let xp = 49.0 / 36.0;
  let fp = pow(xp, -0.75) * pow(1.0 - pow(xp, -0.5), 0.25);
  let tob = g * 6500.0 * f / fp;
  let omega = 0.9 / (pow(r, 1.5) + 1e-3);
  let ang = atan2(pos.z, pos.x) + omega * time * 0.55;
  let rings = fbm2(vec2f(log(r) * 5.2, ang * 1.9));
  let pat = mix(0.75, 0.55 + 0.9 * rings, 0.55);
  let env = smoothstep(3.0, 3.0 * 1.06, r) * (1.0 - smoothstep(16.0 * 0.72, 16.0, r));
  let e = pow(max(tob, 1.0) / 6500.0, 4.0) * pat * env;
  return blackbody(tob) * e;
}

@fragment
fn fs(vin: VOut) -> @location(0) vec4f {
  let ndc = vec2f(vin.pos.x / u.res.x * 2.0 - 1.0, 1.0 - vin.pos.y / u.res.y * 2.0);

  // fixed slow cinematic orbit — composition mirrors the plugin's default
  // fitCamera(16): distance 16 r_s, height 0.28×dist, vertical fov 50°
  let az = u.time * 0.06 + 0.85;
  let ro = vec3f(16.0 * cos(az), 4.48, 16.0 * sin(az));
  let fwd = normalize(-ro);
  let right = normalize(cross(fwd, vec3f(0.0, 1.0, 0.0)));
  let up = cross(right, fwd);
  let tanF = 0.4663;
  // wide screens: pan the hole toward the right so the text side keeps a
  // dark, legible starfield; narrow screens keep it centred
  let pan = clamp((u.aspect - 1.0) * 0.42, 0.0, 0.55);
  let dir = normalize(fwd + right * ((ndc.x - pan) * tanF * u.aspect) + up * (ndc.y * tanF));
  let simT = u.time; // snapshot before the geodesic var u shadows the uniform

  var col = vec3f(0.0);
  var trans = 1.0;

  // orbital-plane basis (port of the plugin's main integration)
  let r0 = length(ro);
  let rHat = ro / max(r0, 1e-6);
  var col0 = vec3f(0.0);
  let nrmRaw = cross(rHat, dir);
  let nlen = length(nrmRaw);
  if (nlen < 1e-5) {
    col0 = starField(dir);
    return vec4f(tonemap(col0 * 1.25), 1.0);
  }
  let nrm = nrmRaw / nlen;
  let e1 = rHat;
  let e2 = normalize(cross(nrm, e1));

  var u = 1.0 / r0;
  let phiHat = dot(dir, e2);
  var v = -u * dot(dir, e1) / phiHat;
  var phi = 0.0;

  let dphi0 = 10.0 / ${STEPS}.0 + 0.006;
  var prevY = ro.y;
  var prevPos = ro;

  for (var i = 0; i < ${STEPS}; i++) {
    let dphi = clamp(dphi0 / (4.0 * u * u + 0.02), 0.008, 0.45);
    // RK4 on (u' = v, v' = −u + 1.5u²), r_s = 1
    let k1u = v;
    let k1v = -u + 1.5 * u * u;
    let u2 = u + 0.5 * dphi * k1u;
    let v2 = v + 0.5 * dphi * k1v;
    let k2u = v2;
    let k2v = -u2 + 1.5 * u2 * u2;
    let u3 = u + 0.5 * dphi * k2u;
    let v3 = v + 0.5 * dphi * k2v;
    let k3u = v3;
    let k3v = -u3 + 1.5 * u3 * u3;
    let u4 = u + dphi * k3u;
    let v4 = v + dphi * k3v;
    let k4u = v4;
    let k4v = -u4 + 1.5 * u4 * u4;
    u += (dphi / 6.0) * (k1u + 2.0 * k2u + 2.0 * k3u + k4u);
    v += (dphi / 6.0) * (k1v + 2.0 * k2v + 2.0 * k3v + k4v);
    phi += dphi;

    if (u >= 1.0) { trans = 0.0; break; }   // captured by the horizon
    if (u <= 3.3e-4) { break; }             // escaped (r > 3000 r_s)

    let r = 1.0 / u;
    let cf = cos(phi);
    let sf = sin(phi);
    let pos = r * (cf * e1 + sf * e2);

    // disk plane (y = 0) crossing → interpolated hit
    if (prevPos.y * pos.y < 0.0) {
      let t = prevY / (prevY - pos.y);
      let hit = mix(prevPos, pos, vec3f(t));
      let rh = length(hit.xz);
      if (rh > 3.0 && rh < 16.0) {
        let eR = cf * e1 + sf * e2;
        let ePhi = -sf * e1 + cf * e2;
        let tang = normalize(-v * eR + u * ePhi);
        let emit = diskEmission(hit, tang, rh, simT);
        let dens = clamp(length(emit) * 0.9 + 0.12, 0.0, 1.0);
        col += trans * emit;
        trans *= 1.0 - clamp(dens, 0.0, 0.92);
        if (trans < 0.02) { break; }
      }
    }
    prevPos = pos;
    prevY = pos.y;
  }

  if (trans > 0.02) {
    let cf = cos(phi);
    let sf = sin(phi);
    let eR = cf * e1 + sf * e2;
    let ePhi = -sf * e1 + cf * e2;
    let outDir = normalize(-v * eR + u * ePhi);
    col += trans * starField(outDir);
  }

  return vec4f(tonemap(col * 1.2), 1.0);
}
`;

/** Live WebGPU black hole; CSS fallback art when WebGPU is unavailable. */
export function BlackHole({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState('');

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let cancelled = false;
    let raf = 0;
    let device: GPUDevice | null = null;

    (async () => {
      try {
        if (!('gpu' in navigator)) throw new Error('WebGPU unavailable');
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error('no GPU adapter');
        device = await adapter.requestDevice();
        if (cancelled) { device.destroy(); return; }
        const ctx = canvas.getContext('webgpu');
        if (!ctx) throw new Error('no webgpu context');
        const format = navigator.gpu.getPreferredCanvasFormat();
        ctx.configure({ device, format, alphaMode: 'opaque' });
        const module = device.createShaderModule({ code: FIXED });
        const info = await module.getCompilationInfo();
        const errs = info.messages.filter((m) => m.type === 'error');
        if (errs.length > 0) {
          throw new Error(`WGSL: ${errs.map((m) => `L${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`);
        }
        const pipeline = device.createRenderPipeline({
          layout: 'auto',
          vertex: { module, entryPoint: 'vs' },
          fragment: { module, entryPoint: 'fs', targets: [{ format }] },
          primitive: { topology: 'triangle-list' },
        });
        const ubo = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        const bind = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: ubo } }],
        });

        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        // FPS governor: the camera drifts at 0.06 rad/s, so consecutive 60 fps
        // frames are near-identical — submit on a 24 fps budget instead and
        // keep u.time continuous (visually identical for slow motion, ~60%
        // less GPU). The adaptive-resolution EMA is rebased on the budget
        // interval: vsync quantization adds up to one display period on top
        // of the budget, so only sustained overruns beyond that mean the GPU
        // cannot keep up and resolution must shrink.
        const FPS = 24;
        const interval = 1 / FPS;
        // the scene is soft deep-sky art — 1.25× is plenty to start; the
        // adaptive loop below raises it back up on strong GPUs
        const maxScale = Math.min(window.devicePixelRatio || 1, 1.25);
        let scale = maxScale;
        let lastT = 0;
        let ema = 0;
        let visible = true;

        const frame = (now: number) => {
          raf = 0;
          if (cancelled || !device) return;
          const t = now / 1000;
          if (lastT && t - lastT < interval) {
            // budget not spent yet — reschedule without a GPU submit
            if (!reduced && visible) raf = requestAnimationFrame(frame);
            return;
          }
          canvas.width = Math.max(2, Math.round(canvas.clientWidth * scale));
          canvas.height = Math.max(2, Math.round(canvas.clientHeight * scale));
          const dt = lastT ? Math.min(t - lastT, 0.1) : interval;
          lastT = t;
          // adaptive internal resolution (budget-relative thresholds)
          ema = ema ? ema * 0.9 + dt * 0.1 : dt;
          if (ema > interval + 0.032 && scale > 0.24) { scale = Math.max(0.24, scale * 0.85); ema = 0; }
          else if (ema < interval + 0.012 && scale < maxScale) { scale = Math.min(maxScale, scale * 1.12); ema = 0; }

          device.queue.writeBuffer(ubo, 0, new Float32Array([
            t, canvas.clientWidth / Math.max(canvas.clientHeight, 1), canvas.width, canvas.height,
          ]));
          const enc = device.createCommandEncoder();
          const pass = enc.beginRenderPass({
            colorAttachments: [{
              view: ctx.getCurrentTexture().createView(),
              loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 },
            }],
          });
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bind);
          pass.draw(3);
          pass.end();
          device.queue.submit([enc.finish()]);
          if (!reduced && visible) raf = requestAnimationFrame(frame);
        };

        new IntersectionObserver((entries) => {
          visible = entries[0]?.isIntersecting ?? true;
          if (visible && !raf && !reduced) { lastT = 0; raf = requestAnimationFrame(frame); }
          else if (!visible && raf) { cancelAnimationFrame(raf); raf = 0; }
        }).observe(canvas);

        if (reduced) frame(0);
        else raf = requestAnimationFrame(frame);
      } catch (err) {
        if (!cancelled) setFailed(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      device?.destroy();
      device = null;
    };
  }, []);

  if (failed) return <div className="bh-fallback" data-error={failed} aria-hidden="true" />;
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
