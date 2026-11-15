# 原生核心与 WebGPU

Rust crate `native/ergalics-core` 是平台的原生层，编译目标为 `wasm32-unknown-unknown`，并通过 wasm-bindgen 绑定到 JS。生成的绑定位于 `src/native/`。

## API 接口

| 导出项 | 用途 |
| --- | --- |
| `core_version()` | crate 版本字符串 |
| `detect_file_kind(buf)` | 通过魔数检测文件类型（供格式加载器使用） |
| `GpuDeviceManager` | 获取适配器和设备，支持 `forceFallbackAdapter` |
| `GpuInfo` | 适配器名称及后端快照 |
| `GpuBuffer` | GPU 缓冲区：`new(device, label, size, usage)`、`create_storage`、`create_readable_storage`、`create_uniform`；通过 `write(queue, bytes, offset)` 上传，`read()` 通过专用回读缓冲区复制回结果 |
| `KernelDescriptor` | 标签、WGSL 源码、入口点、工作组大小、绑定项 |
| `BindingDescriptor` | 单个缓冲区绑定：绑定索引、可见性、缓冲区类型、动态偏移、最小大小 |
| `ComputeKernel` | `compile(device, descriptor)`、`bind_group(gpuBuffers)`、`run(queue, gpuBuffers, x, y, z)`、`dispatch(queue, bindGroup, x, y, z)`、`compilation_info()` |
| `ComputeQueue` | 轻量的提交封装 |

`ComputeKernel::compile` 在编译管线之前，根据绑定描述符构建**真正的** `GPUBindGroupLayout`，因此可以编译和调度读写存储缓冲区或 uniform 的着色器。内核保留其布局，因此 `bind_group(buffers)` 会创建一个绑定组，将第 *i* 个缓冲区绑定到索引 *i*；`run()` 在一次调用中完成绑定组创建、调度和提交——整个加速路径（上传 → 运行 → 回读）现在都是原生实现。

`compilation_info()` 异步返回着色器诊断信息（严重程度 + 行/列 + 消息），因此可以向用户显示 WGSL 错误，而不是静默失败。

`GpuBuffer::read()` 将缓冲区字节作为 `Uint8Array` 返回。WebGPU 禁止将 `MAP_READ` 与 `STORAGE` 组合，因此缓冲区本身不会被映射：`read()` 将内容复制到单独的 `MAP_READ | COPY_DST` 回读缓冲区（通过命令编码器调用 `copyBufferToBuffer`），映射该缓冲区并返回字节。因此存储缓冲区使用 `STORAGE | COPY_DST | COPY_SRC`（可由 JS 写入且可复制出数据），而不是 `MAP_READ`——`create_storage` 和 `create_readable_storage` 都如此处理。

## web-sys 调用约定

这些细节在开发该 crate 时曾耗费不少时间，记录如下：

| 特性 | 约定 |
| --- | --- |
| 不稳定功能开关 | GPU API 需要 `--cfg=web_sys_unstable_apis`（已在 `native/.cargo/config.toml` 中设置）。 |
| 接收者式自由函数 | web-sys 0.3 方法：`GpuDevice::create_compute_pipeline(&device, &desc)`。 |
| 字典类型使用静态 setter | `GpuBindGroupLayoutEntry::set_buffer(&entry, &layout)`。 |
| 描述符构造函数接收切片而非 JS 数组 | `GpuBindGroupLayoutDescriptor::new(&entries)`。 |
| 不支持 `Option<&T>` 参数 | wasm-bindgen 参数不能为 `Option<&T>`；使用拥有所有权的值（`bind_group: GpuBindGroup`）。 |
| **wasm-bindgen 类的 `Vec<T>` 会消耗原对象** | 将 `Vec<GpuBuffer>` 传入方法会转移所有权，并对每个 JS 包装对象调用 `__destroy_into_raw()`，因此第二次使用同一组缓冲区调用时会抛出“array contains a value of the wrong type”。重复运行的方法必须接收引用或 `&js_sys::Array`，并使用 `dyn_ref` 转换元素（例如 `run`/`bind_group` 接收原始 `GPUBuffer` 数组）。 |
| 已弃用的入口点方法 | `GpuProgrammableStage::entry_point` 已弃用——请使用 `set_entry_point`。 |

## 重新构建

```bash
npm run build:wasm
```

要求：`wasm32-unknown-unknown` 目标和 `wasm-bindgen-cli`（缺少时自动安装）。脚本会重新生成 `src/native/ergalics_core.{js,wasm,d.ts}`。`.js`/`.wasm` 产物被 git 忽略；`.d.ts` 文件受版本控制，以便在全新克隆的仓库中进行类型检查。

## 宿主侧 GPU 服务

`src/core/gpu.ts` 负责 JS 侧的适配器和设备生命周期：

- 请求高性能适配器，提供 `cpu-fallback` 模式；
- 监听 `uncapturederror` 并标记内存不足；
- 为 UI 暴露 `getGpuBackend()` / `subscribeGpu()`；
- 不自行测量计算时间——插件通过 `api.reportGpuTime()` 报告实际内核耗时，由性能面板使用。

## 计算服务与插件接口

`src/core/compute.ts` 是面向插件的 GPU 计算服务（`PluginApi.gpu`）。它从 `gpu.ts` 解析后端设备，在模块已加载时通过 **Rust/WASM 核心**（`GpuBuffer` + `ComputeKernel`）运行，否则使用**原生 WebGPU API**（开发模式）。两条路径提供相同的基本操作：

| 基本操作 | 行为 |
| --- | --- |
| `createBuffer(size, usage, label)` | 通过 `write(data, offset)` 上传，通过 `read()` 回读。 |
| `compileKernel({ wgsl, workgroupSize, bindings, ... })` | 提供 `compilationInfo()` 诊断信息的 WGSL 内核句柄。 |
| `run(kernel, buffers, x, y, z)` | 绑定组 + 调度 + 提交。 |

插件通过 `api.gpu` 访问该服务，且必须检查 `available`——没有 WebGPU 时，`api.gpu` 为 `undefined`，插件回退到 CPU。可复用的 WGSL 模板位于 `src/core/wgsl.ts`（粒子积分、三维全对全 N 体引力、直方图、热力图、点云投影、格子玻尔兹曼碰撞/迁移、波动方程蛙跳、矩阵乘法、FFT 和 k-means 内核；每个内核都带有宿主侧打包/解包辅助函数，供 CPU 回退路径复现内核的数学计算）。

示例 Particles 插件使用单缓冲区路径：上传交错排列的 `[x, y, vx, vy]` 存储缓冲区和 uniform 参数缓冲区，调度 WGSL 积分内核，回读结果并报告实际 GPU 耗时。N-Body 插件使用计算量更大的全对全路径：`[x, y, z, vx, vy, vz, mass]` 布局、`read-only-storage` 源缓冲区和 `storage` 目标缓冲区，以及**乒乓缓冲区**，使每个积分步骤都留在设备上，无须逐步回读。参见[路线图](roadmap)。
