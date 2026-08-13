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
| `KernelDescriptor`      | label, WGSL source, entry point, workgroup size, bindings           |
| `BindingDescriptor`     | one buffer binding: binding index, visibility, buffer type, dynamic offset, min size |
| `ComputeKernel`         | `compile(device, descriptor)`, `dispatch(queue, bindGroup, x, y, z)`, `compilation_info()` |
| `ComputeQueue`          | thin submit wrapper                                                 |

`ComputeKernel::compile` builds a **real** `GPUBindGroupLayout` from the
binding descriptors before compiling the pipeline — shaders that read/write
storage buffers or uniforms can be compiled and dispatched.

`compilation_info()` returns shader diagnostics (severity + line/column +
message) asynchronously, so WGSL errors can be surfaced to the user instead
of failing silently.

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

The example plugins currently simulate compute with `setTimeout` progress;
wiring real WGSL kernels into them is the next milestone (see
[Roadmap](roadmap)).
