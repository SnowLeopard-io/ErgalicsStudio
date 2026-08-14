# Native Core & WebGPU

The Rust crate `native/ergalics-core` is the native layer of the platform,
compiled to `wasm32-unknown-unknown` and bound to JS with wasm-bindgen. The
generated bindings live in `src/native/`.

## API surface

| Export                  | Purpose                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `core_version()`        | crate version string                                                |
| `detect_file_kind(buf)` | magic-number file detection (used by the format loader)             |
| `GpuDeviceManager`      | adapter/device acquisition, with `forceFallbackAdapter` support     |
| `GpuInfo`               | adapter name/backend snapshot                                       |
| `GpuBuffer`             | GPU buffer: `new(device, label, size, usage)`, `create_storage`, `create_readable_storage`, `create_uniform`; `write(queue, bytes, offset)` upload, `read()` maps back (requires `MAP_READ`) |
| `KernelDescriptor`      | label, WGSL source, entry point, workgroup size, bindings           |
| `BindingDescriptor`     | one buffer binding: binding index, visibility, buffer type, dynamic offset, min size |
| `ComputeKernel`         | `compile(device, descriptor)`, `bind_group(buffers)`, `run(queue, buffers, x, y, z)`, `dispatch(queue, bindGroup, x, y, z)`, `compilation_info()` |
| `ComputeQueue`          | thin submit wrapper                                                 |

`ComputeKernel::compile` builds a **real** `GPUBindGroupLayout` from the
binding descriptors before compiling the pipeline — shaders that read/write
storage buffers or uniforms can be compiled and dispatched. The kernel keeps
its layout, so `bind_group(buffers)` materializes a bind group with buffer
*i* bound at index *i*, and `run()` does bind-group + dispatch + submit in a
single call — the whole accelerated path (upload → run → read back) is now
native.

`compilation_info()` returns shader diagnostics (severity + line/column +
message) asynchronously, so WGSL errors can be surfaced to the user instead
of failing silently.

`GpuBuffer::read()` maps the underlying buffer with `mapAsync` and copies the
bytes back as a `Uint8Array`; callers must create the buffer with `MAP_READ`
usage (the `create_readable_storage` convenience does this for compute
targets).

## web-sys calling conventions

These quirks cost real time when working on the crate — write them down:

- The GPU APIs require the unstable feature gate:
  `--cfg=web_sys_unstable_apis` (already set in `native/.cargo/config.toml`).
- web-sys 0.3 methods are **receiver-style free functions**:
  `GpuDevice::create_compute_pipeline(&device, &desc)`.
- Dictionary types use static setters:
  `GpuBindGroupLayoutEntry::set_buffer(&entry, &layout)`.
- Descriptor constructors take slices, not JS arrays:
  `GpuBindGroupLayoutDescriptor::new(&entries)`.
- wasm-bindgen parameters cannot be `Option<&T>`; use owned values
  (`bind_group: GpuBindGroup`).
- `GpuProgrammableStage::entry_point` is deprecated — use `set_entry_point`.

## Rebuilding

```bash
npm run build:wasm
```

Requirements: the `wasm32-unknown-unknown` target and `wasm-bindgen-cli`
(installed automatically if missing). The script regenerates
`src/native/ergalics_core.{js,wasm,d.ts}`. The `.js`/`.wasm` artifacts are
git-ignored; the `.d.ts` files are tracked so typechecking works on clean
clones.

## Host-side GPU service

`src/core/gpu.ts` owns the adapter/device lifecycle on the JS side:

- requests a high-performance adapter, with a `cpu-fallback` mode;
- listens for `uncapturederror` and flags out-of-memory;
- exposes `getGpuBackend()` / `subscribeGpu()` for the UI;
- reports GPU time to the perf panel via `api.reportGpuTime()`.

## Compute service & plugin surface

`src/core/compute.ts` is the plugin-facing GPU compute service
(`PluginApi.gpu`). It resolves a backend device from `gpu.ts` and routes
through the **Rust/WASM core** (`GpuBuffer` + `ComputeKernel`) when the
module is loaded, otherwise through the **raw WebGPU API** (dev mode). Both
paths expose the same primitives:

- `createBuffer(size, usage, label)` → upload via `write(data, offset)`,
  read back via `read()`;
- `compileKernel({ wgsl, workgroupSize, bindings, ... })` → WGSL kernel
  handle with `compilationInfo()` diagnostics;
- `run(kernel, buffers, x, y, z)` → bind group + dispatch + submit.

Plugins reach it as `api.gpu` and must check `available` — when WebGPU is
absent, `api.gpu` is `undefined` and plugins fall back to CPU. Reusable WGSL
templates live in `src/core/wgsl.ts` (particle integration, plus host-side
pack/unpack helpers that mirror the kernel math for the CPU fallback).

The example Particles plugin exercises the full path: it uploads an
interleaved `[x, y, vx, vy]` storage buffer plus a uniform params buffer,
dispatches the WGSL integration kernel, reads the result back, and reports
real GPU time. See [Roadmap](roadmap).
