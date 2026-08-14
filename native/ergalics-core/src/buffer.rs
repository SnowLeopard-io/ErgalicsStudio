//! GPU buffer management.
//!
//! The missing half of the native compute foundation: buffers. Kernels are
//! useless without data to chew on, so this module provides `GpuBuffer` —
//! create buffers with an explicit usage mask, upload bytes from JS, and
//! read results back asynchronously via `mapAsync`.

use js_sys::Uint8Array;
use wasm_bindgen::prelude::*;
use web_sys::{
    gpu_buffer_usage, gpu_map_mode, GpuBuffer as WgpuBuffer, GpuBufferDescriptor, GpuDevice,
    GpuQueue,
};

/// A WebGPU buffer owned by the native core.
///
/// Holds the underlying `GPUBuffer` plus the usage flags it was created
/// with. `write` uploads a byte slice through the queue; `read` maps the
/// buffer (requiring `MAP_READ` usage) and copies the bytes back to a
/// `Uint8Array`.
#[wasm_bindgen]
pub struct GpuBuffer {
    device: GpuDevice,
    buffer: WgpuBuffer,
    size: u32,
    usage: u32,
}

#[wasm_bindgen]
impl GpuBuffer {
    /// Create a buffer of `size` bytes with an explicit usage mask.
    #[wasm_bindgen(constructor)]
    pub fn new(device: GpuDevice, label: String, size: u32, usage: u32) -> Result<GpuBuffer, JsValue> {
        let descriptor = GpuBufferDescriptor::new(size, usage);
        descriptor.set_label(&label);
        let buffer = GpuDevice::create_buffer(&device, &descriptor)?;
        Ok(GpuBuffer {
            device,
            buffer,
            size,
            usage,
        })
    }

    /// Storage buffer usable as a compute shader read/write target.
    pub fn create_storage(device: GpuDevice, size: u32) -> Result<GpuBuffer, JsValue> {
        Self::new(
            device,
            "storage".to_string(),
            size,
            gpu_buffer_usage::STORAGE | gpu_buffer_usage::COPY_DST,
        )
    }

    /// Storage buffer that can also be mapped back for reading results.
    pub fn create_readable_storage(device: GpuDevice, size: u32) -> Result<GpuBuffer, JsValue> {
        Self::new(
            device,
            "readable-storage".to_string(),
            size,
            gpu_buffer_usage::STORAGE | gpu_buffer_usage::COPY_DST | gpu_buffer_usage::MAP_READ,
        )
    }

    /// Uniform buffer for per-dispatch parameters (16-byte aligned structs).
    pub fn create_uniform(device: GpuDevice, size: u32) -> Result<GpuBuffer, JsValue> {
        Self::new(
            device,
            "uniform".to_string(),
            size,
            gpu_buffer_usage::UNIFORM,
        )
    }

    #[wasm_bindgen(getter)]
    pub fn size(&self) -> u32 {
        self.size
    }

    #[wasm_bindgen(getter)]
    pub fn usage(&self) -> u32 {
        self.usage
    }

    /// The underlying `GPUBuffer` (for use with host-managed command encoders).
    #[wasm_bindgen(getter)]
    pub fn buffer(&self) -> WgpuBuffer {
        self.buffer.clone()
    }

    /// Upload `data` into the buffer starting at `offset` bytes.
    pub fn write(&self, queue: &GpuQueue, data: &[u8], offset: u32) -> Result<(), JsValue> {
        GpuQueue::write_buffer_with_u32_and_u8_slice(queue, &self.buffer, offset, data)
    }

    /// Asynchronously map the buffer (`MAP_READ` usage required) and copy
    /// its contents back into a `Uint8Array`.
    pub async fn read(&self) -> Result<Vec<u8>, JsValue> {
        let promise = self.buffer.map_async(gpu_map_mode::READ);
        promise.await?;
        let range = self
            .buffer
            .get_mapped_range()
            .map_err(|_| JsValue::from_str("GPU buffer getMappedRange failed"))?;
        let out = Uint8Array::new(&range).to_vec();
        self.buffer.unmap();
        Ok(out)
    }
}
