//! Compute shader scheduling framework.
//!
//! Provides a small GPU compute pipeline abstraction built on the browser
//! WebGPU API: compile a WGSL kernel, wire up bind groups, and expose the
//! pipeline for dispatch from the JS host.

use wasm_bindgen::prelude::*;
use web_sys::{
    GpuBindGroupLayout, GpuComputePipeline, GpuComputePipelineDescriptor,
    GpuDevice, GpuPipelineLayout, GpuPipelineLayoutDescriptor,
    GpuProgrammableStage, GpuShaderModule, GpuShaderModuleDescriptor,
};

/// Descriptor for a compute kernel to be compiled by the scheduler.
#[wasm_bindgen]
pub struct KernelDescriptor {
    label: String,
    wgsl: String,
    entry_point: String,
    workgroup_size: Vec<u32>,
}

#[wasm_bindgen]
impl KernelDescriptor {
    #[wasm_bindgen(constructor)]
    pub fn new(label: String, wgsl: String, entry_point: String, workgroup_size: Vec<u32>) -> Self {
        Self {
            label,
            wgsl,
            entry_point,
            workgroup_size,
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
}

/// A compiled compute kernel bound to a GPU device.
#[wasm_bindgen]
pub struct ComputeKernel {
    device: GpuDevice,
    pipeline: GpuComputePipeline,
    label: String,
    workgroup_size: Vec<u32>,
}

#[wasm_bindgen]
impl ComputeKernel {
    /// Compile a kernel from a descriptor using the given device.
    pub fn compile(device: GpuDevice, descriptor: KernelDescriptor) -> Result<ComputeKernel, JsValue> {
        let shader_module_desc = GpuShaderModuleDescriptor::new(&descriptor.wgsl);
        let shader: GpuShaderModule = device.create_shader_module(&shader_module_desc);

        // Minimal bind group layout (empty for a kernel with no resources).
        let bind_group_layout: GpuBindGroupLayout = device.create_bind_group_layout(
            &web_sys::GpuBindGroupLayoutDescriptor::new(&[]),
        )?;

        let layouts = [js_sys::JsNullable::wrap(bind_group_layout)];
        let pipeline_layout_desc = GpuPipelineLayoutDescriptor::new(&layouts);
        let pipeline_layout: GpuPipelineLayout =
            device.create_pipeline_layout(&pipeline_layout_desc);

        let mut stage = GpuProgrammableStage::new(&shader);
        stage.entry_point(&descriptor.entry_point);
        let compute_desc = GpuComputePipelineDescriptor::new(&pipeline_layout, &stage);

        let pipeline = device.create_compute_pipeline(&compute_desc);

        Ok(ComputeKernel {
            device,
            pipeline,
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
}

/// A command queue for dispatching kernels. Not intended for direct use
/// from JS yet — the host drives commands through the WebGPU API directly.
#[wasm_bindgen]
pub struct ComputeQueue {
    queue: web_sys::GpuQueue,
}

#[wasm_bindgen]
impl ComputeQueue {
    pub fn new(queue: web_sys::GpuQueue) -> Self {
        Self { queue }
    }

    /// Submit an encoded command buffer.
    pub fn submit(&self, buffers: Vec<web_sys::GpuCommandBuffer>) {
        self.queue.submit(&buffers);
    }
}