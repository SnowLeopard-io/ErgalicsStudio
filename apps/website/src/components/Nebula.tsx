// ==========================================================================
// Nebula.tsx — live WebGPU Milky-Way background for the closing section.
//
// WGSL port of the workbench's fx.stars night-sky renderer
// (src/plugins/builtin/stars): procedural three-shell star field with
// hash-cell jitter, the galactic-plane band (FBM clouds + dark lanes +
// Sagittarius bulge) anchored on the plugin's real galactic-pole geometry,
// scintillation, and occasional meteors. Background simplifications:
// pristine Bortle-1 sky, no moon, fixed framing with a slow sidereal drift.
// No workbench source is modified.
// ==========================================================================
import { useEffect, useRef, useState } from 'react';

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

// ---- hash / value noise / fbm (port of RT_NOISE) ---------------------------
fn hash13(p: vec3f) -> f32 {
  var q = fract(p * 0.1031);
  q += dot(q, q.zyx + 31.32);
  return fract((q.x + q.y) * q.z);
}
fn hash33(p: vec3f) -> vec3f {
  var q = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, p.yxz + 33.33);
  return fract((q.xxy + q.yxx) * q.zyx);
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
fn fbm2(p0: vec2f) -> f32 {
  var s = 0.0;
  var a = 0.55;
  var p = p0;
  for (var i = 0; i < 4; i++) {
    s += a * vnoise2(p);
    p = p * 2.03 + vec2f(17.1, 9.7);
    a *= 0.5;
  }
  return s;
}
fn vnoise3(p: vec3f) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
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

@fragment
fn fs(vin: VOut) -> @location(0) vec4f {
  let ndc = vec2f(vin.pos.x / u.res.x * 2.0 - 1.0, 1.0 - vin.pos.y / u.res.y * 2.0);

  // fixed framing: slight upward gaze, fov 50 deg
  let fwd = normalize(vec3f(0.0, 0.10, -1.0));
  let right = normalize(cross(fwd, vec3f(0.0, 1.0, 0.0)));
  let up = cross(right, fwd);
  let tanF = 0.4663;
  var rd = normalize(fwd + right * (ndc.x * tanF * u.aspect) + up * (ndc.y * tanF));

  // sidereal drift (斗转星移): rotate the celestial sphere about world Y
  let a = u.time * 0.008;
  let cs = cos(a);
  let sn = sin(a);
  let dir = vec3f(cs * rd.x + sn * rd.z, rd.y, -sn * rd.x + cs * rd.z);

  // ---- sky background: pristine Bortle-1 airglow floor ----------------------
  var col = vec3f(0.0035, 0.006, 0.011);

  // ---- galactic-plane band on the plugin's real pole/center geometry --------
  // pole tilted so the band crosses the frame diagonally through the bulge
  let pole = normalize(vec3f(0.8, 0.6, 0.05));
  let gcenter = normalize(cross(vec3f(0.0, 1.0, 0.0), pole));
  let sinB = clamp(dot(dir, pole), -1.0, 1.0);
  let gal = exp(-pow(asin(sinB) / 0.115, 2.0)); // ~13 deg Gaussian half-width
  let e1 = normalize(cross(pole, vec3f(0.0, 1.0, 0.001)));
  let e2 = cross(pole, e1);
  let uv = vec2f(dot(dir, e1), dot(dir, e2));
  let neb = fbm2(uv * 5.5 + 3.7);
  let lanes = smoothstep(0.42, 0.72, fbm2(uv * 3.1 + 9.2));
  let bulge = pow(clamp(dot(dir, gcenter), 0.0, 1.0), 5.0); // Sgr brightening
  let mw = gal * (0.10 + 0.16 * neb + 0.35 * bulge * neb) * (1.0 - 0.55 * lanes);
  col += mw * 1.25 * vec3f(0.78, 0.74, 0.66);

  // ---- three-shell procedural star field (port of RT_STARS) -----------------
  var stars = vec3f(0.0);
  let density = 0.82 - 0.18 * 1.1;
  for (var shell = 0; shell < 3; shell++) {
    let scale = 22.0 * pow(2.6, f32(shell));
    let p = dir * scale;
    let cell = floor(p);
    for (var dx = -1; dx <= 1; dx++) {
      for (var dy = -1; dy <= 1; dy++) {
        for (var dz = -1; dz <= 1; dz++) {
          let c = cell + vec3f(f32(dx), f32(dy), f32(dz));
          let h = hash33(c);
          if (h.z > density) {
            let sp = c + 0.15 + 0.7 * h;
            let dist = length(p - sp);
            let mag = pow(h.x, 6.0) * (0.4 + 0.6 * h.y);
            let star = mag * exp(-dist * dist * 42.0);
            let tint = mix(vec3f(1.0, 0.72, 0.5), vec3f(0.62, 0.75, 1.0), h.y);
            stars += star * 5.0 * tint;
          }
        }
      }
    }
  }
  // faint inner band from RT_STARS adds depth behind the main Milky Way
  let band2 = exp(-abs(dir.y + 0.18 * vnoise3(dir * 2.0) - 0.09) * 5.5);
  let neb2 = fbm2(vec2f(atan2(dir.z, dir.x) * 2.4, dir.y * 4.0) + 3.7);
  stars += band2 * (0.028 + 0.05 * neb2) * vec3f(0.55, 0.62, 0.85);
  stars += band2 * band2 * neb2 * 0.05 * vec3f(0.9, 0.7, 0.55);

  // scintillation: direction-indexed noise wobbling the starlight (seeing .35)
  let tw = vnoise2(vec2f(atan2(dir.x, dir.z), asin(clamp(dir.y, -1.0, 1.0))) * 240.0 + u.time * 3.5);
  stars *= 1.0 + 0.35 * (tw - 0.5) * 1.5;
  col += stars;

  // ---- occasional meteor: great-circle streak with a moving head glow -------
  let ph = fract(u.time / 13.0);
  let mt = clamp((ph - 0.45) / 0.17, 0.0, 1.0);
  let fade = smoothstep(0.45, 0.5, ph) * (1.0 - smoothstep(0.6, 0.68, ph));
  if (fade > 0.001) {
    let m1 = normalize(vec3f(-0.6, 0.25, -1.0));
    let m2 = normalize(vec3f(0.4, -0.1, -1.0));
    let ab = m2 - m1;
    let len2 = max(dot(ab, ab), 1e-6);
    let tt = clamp(dot(rd - m1, ab) / len2, 0.0, 1.0);
    let cp = normalize(m1 + ab * tt);
    let dStreak = acos(clamp(dot(rd, cp), -1.0, 1.0));
    let streak = exp(-dStreak * dStreak * 2800.0);
    let head = normalize(mix(m1, m2, mt));
    let dHead = acos(clamp(dot(rd, head), -1.0, 1.0));
    let glow = exp(-dHead * dHead * 1100.0);
    col += (streak * 0.55 + glow * 1.4) * fade * vec3f(0.85, 0.92, 1.0);
  }

  // ACES-ish tonemap (Narkowicz fit), plugin exposure
  col *= 1.3;
  let mapped = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  return vec4f(clamp(mapped, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

/** Live WebGPU Milky-Way background; CSS fallback art when WebGPU is unavailable. */
export function Nebula({ className }: { className?: string }) {
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
        // FPS governor: the sidereal drift is 0.008 rad/s and meteors appear
        // every 13 s, so consecutive 60 fps frames are near-identical —
        // submit on a 15 fps budget instead and keep u.time continuous
        // (visually identical for slow motion, ~75% less GPU). The
        // adaptive-resolution EMA is rebased on the budget interval: vsync
        // quantization adds up to one display period on top of the budget,
        // so only sustained overruns beyond that mean the GPU cannot keep up
        // and resolution must shrink.
        const FPS = 15;
        const interval = 1 / FPS;
        const maxScale = Math.min(window.devicePixelRatio || 1, 1.5);
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

  if (failed) return <div className="neb-fallback" data-error={failed} aria-hidden="true" />;
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
