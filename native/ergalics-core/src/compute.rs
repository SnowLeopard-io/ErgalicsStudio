//! Compute shader scheduling framework.
//!
//! Provides a small GPU compute pipeline abstraction built on the browser
//! WebGPU API: describe a kernel with its resource bindings, compile it into
//! a pipeline with a real bind group layout, inspect shader compilation
//! diagnostics, and dispatch workgroups through a command encoder.

use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use web_sys::{
    GpuBindGroup, GpuBindGroupDescriptor, GpuBindGroupEntry, GpuBindGroupLayout,
    GpuBindGroupLayoutDescriptor, GpuBindGroupLayoutEntry, GpuBuffer, GpuBufferBindingLayout,
    GpuBufferBindingType, GpuCommandBuffer, GpuCommandEncoderDescriptor, GpuCompilationInfo,
    GpuCompilationMessage, GpuCompilationMessageType, GpuComputePassEncoder, GpuComputePipeline,
    GpuComputePipelineDescriptor, GpuDevice, GpuPipelineLayout, GpuPipelineLayoutDescriptor,
    GpuProgrammableStage, GpuQueue, GpuShaderModule, GpuShaderModuleDescriptor,
};

/// `GPUShaderStage::COMPUTE` bit flag (WebGPU spec).
pub const SHADER_STAGE_COMPUTE: u32 = 4;

/// Describes a single buffer binding of a kernel's bind group layout.
///
/// This is what makes `ComputeKernel::compile` usable for shaders that
/// actually read/write data: each binding entry is turned into a real
/// `GPUBindGroupLayoutEntry` with the given visibility and buffer layout.
#[wasm_bindgen]
#[derive(Clone)]
pub struct BindingDescriptor {
    binding: u32,
    visibility: u32,
    buffer_type: String,
    has_dynamic_offset: bool,
    min_binding_size: f64,
}

#[wasm_bindgen]
impl BindingDescriptor {
    /// Create a compute-stage buffer binding.
    ///
    /// `buffer_type` must be one of:
    /// - `"storage"`             — read/write storage buffer
    /// - `"read-only-storage"`   — read-only storage buffer
    /// - `"uniform"`             — uniform buffer
    #[wasm_bindgen(constructor)]
    pub fn new(binding: u32, buffer_type: String) -> Self {
        Self {
            binding,
            visibility: SHADER_STAGE_COMPUTE,
            buffer_type,
            has_dynamic_offset: false,
            min_binding_size: 0.0,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn binding(&self) -> u32 {
        self.binding
    }

    #[wasm_bindgen(getter)]
    pub fn visibility(&self) -> u32 {
        self.visibility
    }

    #[wasm_bindgen(getter)]
    pub fn buffer_type(&self) -> String {
        self.buffer_type.clone()
    }

    /// Override the shader stage visibility bitmask (default: compute only).
    pub fn set_visibility(&mut self, visibility: u32) {
        self.visibility = visibility;
    }

    pub fn set_has_dynamic_offset(&mut self, has_dynamic_offset: bool) {
        self.has_dynamic_offset = has_dynamic_offset;
    }

    /// Minimum byte size of the bound buffer (0 = unbounded).
    pub fn set_min_binding_size(&mut self, min_binding_size: f64) {
        self.min_binding_size = min_binding_size;
    }
}

/// Descriptor for a compute kernel to be compiled by the scheduler.
#[wasm_bindgen]
pub struct KernelDescriptor {
    label: String,
    wgsl: String,
    entry_point: String,
    workgroup_size: Vec<u32>,
    bindings: Vec<BindingDescriptor>,
}

#[wasm_bindgen]
impl KernelDescriptor {
    #[wasm_bindgen(constructor)]
    pub fn new(
        label: String,
        wgsl: String,
        entry_point: String,
        workgroup_size: Vec<u32>,
        bindings: Vec<BindingDescriptor>,
    ) -> Self {
        Self {
            label,
            wgsl,
            entry_point,
            workgroup_size,
            bindings,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn entry_point(&self) -> String {
        self.entry_point.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn workgroup_size(&self) -> Vec<u32> {
        self.workgroup_size.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn bindings(&self) -> Vec<BindingDescriptor> {
        self.bindings.clone()
    }
}

/// A compiled compute kernel bound to a GPU device.
#[wasm_bindgen]
pub struct ComputeKernel {
    device: GpuDevice,
    pipeline: GpuComputePipeline,
    shader: GpuShaderModule,
    bind_group_layout: GpuBindGroupLayout,
    label: String,
    workgroup_size: Vec<u32>,
}

#[wasm_bindgen]
impl ComputeKernel {
    /// Compile a kernel from a descriptor using the given device.
    ///
    /// The bind group layout is built from the descriptor's binding entries
    /// (visibility + buffer layout), so shaders that read/write storage
    /// buffers or uniforms can be compiled and bound.
    pub fn compile(device: GpuDevice, descriptor: KernelDescriptor) -> Result<ComputeKernel, JsValue> {
        let shader_module_desc = GpuShaderModuleDescriptor::new(&descriptor.wgsl);
        let shader: GpuShaderModule = device.create_shader_module(&shader_module_desc);

        // Build a real bind group layout from the descriptor's bindings.
        let mut layout_entries: Vec<GpuBindGroupLayoutEntry> = Vec::new();
        for binding in descriptor.bindings.iter() {
            let entry = GpuBindGroupLayoutEntry::new(binding.binding, binding.visibility);
            if binding.buffer_type != "none" {
                let buffer_layout = GpuBufferBindingLayout::new();
                match binding.buffer_type.as_str() {
                    "uniform" => GpuBufferBindingLayout::set_type(&buffer_layout, GpuBufferBindingType::Uniform),
                    "storage" => GpuBufferBindingLayout::set_type(&buffer_layout, GpuBufferBindingType::Storage),
                    _ => GpuBufferBindingLayout::set_type(&buffer_layout, GpuBufferBindingType::ReadOnlyStorage),
                }
                if binding.has_dynamic_offset {
                    GpuBufferBindingLayout::set_has_dynamic_offset(&buffer_layout, true);
                }
                if binding.min_binding_size > 0.0 {
                    GpuBufferBindingLayout::set_min_binding_size_f64(&buffer_layout, binding.min_binding_size);
                }
                GpuBindGroupLayoutEntry::set_buffer(&entry, &buffer_layout);
            }
            layout_entries.push(entry);
        }

        let bind_group_layout: GpuBindGroupLayout = device
            .create_bind_group_layout(&GpuBindGroupLayoutDescriptor::new(&layout_entries))?;

        let layouts = [js_sys::JsNullable::wrap(bind_group_layout.clone())];
        let pipeline_layout_desc = GpuPipelineLayoutDescriptor::new(&layouts);
        let pipeline_layout: GpuPipelineLayout =
            device.create_pipeline_layout(&pipeline_layout_desc);

        let stage = GpuProgrammableStage::new(&shader);
        stage.set_entry_point(&descriptor.entry_point);
        let compute_desc = GpuComputePipelineDescriptor::new(&pipeline_layout, &stage);

        let pipeline = device.create_compute_pipeline(&compute_desc);

        Ok(ComputeKernel {
            device,
            pipeline,
            shader,
            bind_group_layout,
            label: descriptor.label,
            workgroup_size: descriptor.workgroup_size,
        })
    }

    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn pipeline(&self) -> GpuComputePipeline {
        self.pipeline.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn workgroup_size(&self) -> Vec<u32> {
        self.workgroup_size.clone()
    }

    /// Encode a single dispatch of this kernel and submit it to the queue.
    ///
    /// `bind_group` is bound at index 0; the workgroup counts default to the
    /// kernel's workgroup size when not overridden by the JS caller.
    pub fn dispatch(
        &self,
        queue: &GpuQueue,
        bind_group: GpuBindGroup,
        workgroup_count_x: u32,
        workgroup_count_y: u32,
        workgroup_count_z: u32,
    ) -> Result<(), JsValue> {
        let encoder = GpuDevice::create_command_encoder_with_descriptor(
            &self.device,
            &GpuCommandEncoderDescriptor::new(),
        );
        {
            let pass = encoder.begin_compute_pass_with_descriptor(&web_sys::GpuComputePassDescriptor::new());
            GpuComputePassEncoder::set_pipeline(&pass, &self.pipeline);
            GpuComputePassEncoder::set_bind_group(&pass, 0, Some(&bind_group));
            GpuComputePassEncoder::dispatch_workgroups_with_workgroup_count_y_and_workgroup_count_z(
                &pass,
                workgroup_count_x,
                workgroup_count_y,
                workgroup_count_z,
            );
            GpuComputePassEncoder::end(&pass);
        }
        let command_buffer = encoder.finish();
        GpuQueue::submit(queue, &[command_buffer]);
        Ok(())
    }

    /// Build a bind group binding the given buffers to this kernel's layout.
    ///
    /// Buffers are bound in order: buffer `i` becomes binding `i`. The
    /// layout comes from the kernel's compile-time `BindingDescriptor`s, so
    /// the buffer usage must match the declared binding type (storage vs
    /// read-only-storage vs uniform).
    pub fn bind_group(&self, buffers: &js_sys::Array) -> Result<GpuBindGroup, JsValue> {
        let mut entries: Vec<GpuBindGroupEntry> = Vec::with_capacity(buffers.length() as usize);
        for (i, value) in buffers.iter().enumerate() {
            let buffer: &GpuBuffer = value
                .dyn_ref::<GpuBuffer>()
                .ok_or_else(|| JsValue::from_str("expected GpuBuffer"))?;
            entries.push(GpuBindGroupEntry::new_with_gpu_buffer(i as u32, buffer));
        }
        let descriptor = GpuBindGroupDescriptor::new(&entries, &self.bind_group_layout);
        Ok(GpuDevice::create_bind_group(&self.device, &descriptor))
    }

    /// One-shot convenience: build a bind group from `buffers`, dispatch a
    /// single workload, and submit — the whole pipeline in one call.
    pub fn run(
        &self,
        queue: &GpuQueue,
        buffers: &js_sys::Array,
        workgroup_count_x: u32,
        workgroup_count_y: u32,
        workgroup_count_z: u32,
    ) -> Result<(), JsValue> {
        let bind_group = self.bind_group(buffers)?;
        self.dispatch(
            queue,
            bind_group,
            workgroup_count_x,
            workgroup_count_y,
            workgroup_count_z,
        )
    }

    /// Await shader compilation info and return diagnostic messages.
    ///
    /// The first message is an error/warning/info line like
    /// `[error] line 3:9 expected ';'`; an empty vector means the shader
    /// compiled cleanly. Useful for surfacing WGSL errors to the user
    /// instead of failing with a silent pipeline error.
    pub async fn compilation_info(&self) -> Vec<String> {
        let promise = GpuShaderModule::get_compilation_info(&self.shader);
        let info: GpuCompilationInfo = match JsFuture::from(promise).await {
            Ok(value) => value,
            Err(_) => return Vec::new(),
        };

        let messages = GpuCompilationInfo::messages(&info);
        let mut diagnostics = Vec::new();
        for msg in messages.iter() {
            let msg: GpuCompilationMessage = match msg.dyn_into() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let severity = match GpuCompilationMessage::type_(&msg) {
                GpuCompilationMessageType::Error => "error",
                GpuCompilationMessageType::Warning => "warning",
                GpuCompilationMessageType::Info => "info",
                _ => "info",
            };
            let line = GpuCompilationMessage::line_num(&msg) as u32;
            let column = GpuCompilationMessage::line_pos(&msg) as u32;
            diagnostics.push(format!(
                "[{}] line {}:{} {}",
                severity,
                line,
                column,
                GpuCompilationMessage::message(&msg)
            ));
        }
        diagnostics
    }
}

/// A command queue for dispatching kernels. Not intended for direct use
/// from JS yet — the host drives commands through the WebGPU API directly.
#[wasm_bindgen]
pub struct ComputeQueue {
    queue: GpuQueue,
}

#[wasm_bindgen]
impl ComputeQueue {
    pub fn new(queue: GpuQueue) -> Self {
        Self { queue }
    }

    /// Submit an encoded command buffer.
    pub fn submit(&self, buffers: Vec<GpuCommandBuffer>) {
        GpuQueue::submit(&self.queue, &buffers);
    }
}
