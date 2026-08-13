//! Compute shader scheduling framework.
//!
//! Provides a small GPU compute pipeline abstraction built on the browser
//! WebGPU API: compile a WGSL kernel, wire up bind groups, and dispatch
//! work from the JS host.

use js_sys::Array;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use web_sys::{
    GpuBuffer, GpuComputePipeline, GpuDevice, GpuQueue,
    GpuShaderModule, GpuBindGroup, GpuBindGroupLayout, GpuPipelineLayout,
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
    shader: GpuShaderModule,
    pipeline: GpuComputePipeline,
    label: String,
    workgroup_size: Vec<u32>,
}

#[wasm_bindgen]
impl ComputeKernel {
    /// Compile a kernel from a descriptor using the given device.
    pub fn compile(device: GpuDevice, descriptor: KernelDescriptor) -> Result<ComputeKernel, JsValue> {
        let shader = device
            .create_shader_module_with_source(descriptor.wgsl.clone())
            .map_err(|e| JsValue::from(e))?;

        let bind_group_layout = device
            .create_bind_group_layout_with_descriptor(
                &web_sys::GpuBindGroupLayoutDescriptor::new(
                    Array::new().into(),
                ),
            )
            .map_err(|e| JsValue::from(e))?;

        let pipeline_layout = device
            .create_pipeline_layout_with_descriptor(
                &web_sys::GpuPipelineLayoutDescriptor::new(Some(&bind_group_layout)),
            )
            .map_err(|e| JsValue::from(e))?;

        let layout = web_sys::GpuComputePipelineDescriptor::new(
            descriptor.entry_point.clone(),
            Some(&shader),
        );
        layout.set_label(&descriptor.label);

        let pipeline = device
            .create_compute_pipeline(&layout)
            .map_err(|e| JsValue::from(e))?;

        Ok(ComputeKernel {
            device,
            shader,
            pipeline,
            label: descriptor.label,
            workgroup_size: descriptor.workgroup_size,
        })
    }

    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
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
    pub fn submit(&self, buffers: Vec<web_sys::GpuCommandBuffer>) {
        let array = js_sys::Array::new();
        for b in buffers {
            array.push(&b.unchecked_into());
        }
        self.queue.submit(&array);
    }
}

/// Unused-but-public surface types re-exported so the module compiles
/// consistently across web-sys feature sets.
#[allow(dead_code)]
fn _keep_types_used(_b: GpuBuffer, _g: GpuBindGroup, _l: GpuBindGroupLayout, _p: GpuPipelineLayout) {}
