//! GPU buffer management.
//!
//! The missing half of the native compute foundation: buffers. Kernels are
//! useless without data to chew on, so this module provides `GpuBuffer` —
//! create buffers with an explicit usage mask, upload bytes from JS, and
//! read results back asynchronously via `mapAsync`.

use js_sys::Uint8Array;
use wasm_bindgen::prelude::*;
use web_sys::{
    gpu_buffer_usage, gpu_map_mode, GpuBuffer as WgpuBuffer, GpuBufferDescriptor,
    GpuCommandEncoder, GpuCommandEncoderDescriptor, GpuDevice, GpuQueue,
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
    ///
    /// `COPY_SRC` is included so results can be copied into a separate
    /// `MAP_READ | COPY_DST` readback buffer (WebGPU forbids combining
    /// `MAP_READ` with `STORAGE`).
    pub fn create_storage(device: GpuDevice, size: u32) -> Result<GpuBuffer, JsValue> {
        Self::new(
            device,
            "storage".to_string(),
            size,
            gpu_buffer_usage::STORAGE
                | gpu_buffer_usage::COPY_DST
                | gpu_buffer_usage::COPY_SRC,
        )
    }

    /// Storage buffer that can also be read back (results are copied into a
    /// separate readback buffer on `read`).
    pub fn create_readable_storage(device: GpuDevice, size: u32) -> Result<GpuBuffer, JsValue> {
        Self::new(
            device,
            "readable-storage".to_string(),
            size,
            gpu_buffer_usage::STORAGE
                | gpu_buffer_usage::COPY_DST
                | gpu_buffer_usage::COPY_SRC,
        )
    }

    /// Uniform buffer for per-dispatch parameters (16-byte aligned structs).
    ///
    /// `COPY_DST` is included so `write` (which goes through
    /// `queue.writeBuffer`) can upload the parameter bytes; `writeBuffer`
    /// validation requires the destination buffer to expose `COPY_DST`.
    pub fn create_uniform(device: GpuDevice, size: u32) -> Result<GpuBuffer, JsValue> {
        Self::new(
            device,
            "uniform".to_string(),
            size,
            gpu_buffer_usage::UNIFORM | gpu_buffer_usage::COPY_DST,
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

    /// Asynchronously read the buffer's contents.
    ///
    /// WebGPU only allows `MAP_READ` to be combined with `COPY_DST`, so the
    /// buffer itself cannot be mapped when it is used as compute storage.
    /// This copies the buffer into a temporary `MAP_READ | COPY_DST` readback
    /// buffer, maps that, and returns the bytes.
    pub async fn read(&self) -> Result<Vec<u8>, JsValue> {
        let descriptor = GpuBufferDescriptor::new(self.size, gpu_buffer_usage::MAP_READ | gpu_buffer_usage::COPY_DST);
        descriptor.set_label("readback");
        let readback = GpuDevice::create_buffer(&self.device, &descriptor)?;
        let encoder = GpuDevice::create_command_encoder_with_descriptor(
            &self.device,
            &GpuCommandEncoderDescriptor::new(),
        );
        GpuCommandEncoder::copy_buffer_to_buffer_with_u32_and_u32_and_u32(
            &encoder,
            &self.buffer,
            0,
            &readback,
            0,
            self.size,
        )?;
        let command_buffer = encoder.finish();
        GpuQueue::submit(&self.device.queue(), &[command_buffer]);
        let promise = readback.map_async(gpu_map_mode::READ);
        promise.await?;
        let range = readback
            .get_mapped_range()
            .map_err(|_| JsValue::from_str("GPU buffer getMappedRange failed"))?;
        let out = Uint8Array::new(&range).to_vec();
        readback.unmap();
        Ok(out)
    }
}
