//! WebGPU device management.
//!
//! Thin wrapper over the browser WebGPU API via web-sys. The JS host
//! supplies `navigator.gpu`; this module handles adapter acquisition,
//! device request, and capability reporting.

use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use web_sys::{
    Gpu, GpuAdapter, GpuAdapterInfo, GpuDevice, GpuPowerPreference,
    GpuRequestAdapterOptions,
};

/// Information about the current GPU adapter.
#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct GpuInfo {
    name: String,
    backend: String,
    adapter: Option<GpuAdapter>,
}

#[wasm_bindgen]
impl GpuInfo {
    #[wasm_bindgen(getter)]
    pub fn name(&self) -> String {
        self.name.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn backend(&self) -> String {
        self.backend.clone()
    }
}

/// Manages the lifetime of the WebGPU device.
#[wasm_bindgen]
pub struct GpuDeviceManager {
    device: GpuDevice,
    info: GpuInfo,
}

#[wasm_bindgen]
impl GpuDeviceManager {
    /// Request an adapter then a device from `navigator.gpu`.
    /// `force_cpu_fallback` maps to `forceFallbackAdapter`.
    pub async fn acquire(gpu: Gpu, force_cpu_fallback: bool) -> Result<GpuDeviceManager, JsValue> {
        let options = GpuRequestAdapterOptions::new();
        options.set_power_preference(GpuPowerPreference::HighPerformance);
        options.set_force_fallback_adapter(force_cpu_fallback);

        let adapter_nullable = JsFuture::from(gpu.request_adapter_with_options(&options))
            .await?
            .into_option()
            .ok_or_else(|| JsValue::from_str("no GPU adapter found"))?;

        let device: GpuDevice = JsFuture::from(adapter_nullable.request_device()).await?;

        let info = adapter_nullable.info();
        let name = adapter_name(&info);

        Ok(GpuDeviceManager {
            device,
            info: GpuInfo {
                name,
                backend: "webgpu".to_string(),
                adapter: Some(adapter_nullable),
            },
        })
    }

    /// The underlying `GpuDevice`.
    #[wasm_bindgen(getter)]
    pub fn device(&self) -> GpuDevice {
        self.device.clone()
    }

    /// Adapter information snapshot.
    #[wasm_bindgen(getter)]
    pub fn info(&self) -> GpuInfo {
        self.info.clone()
    }
}

fn adapter_name(info: &GpuAdapterInfo) -> String {
    let device = info.device();
    if !device.is_empty() {
        device
    } else {
        let vendor = info.vendor();
        let architecture = info.architecture();
        let mut name = String::new();
        if !vendor.is_empty() {
            name.push_str(&vendor);
        }
        if !architecture.is_empty() {
            if !name.is_empty() {
                name.push(' ');
            }
            name.push_str(&architecture);
        }
        if name.is_empty() {
            "Unknown".to_string()
        } else {
            name
        }
    }
}

/// Check whether WebGPU is available in the current navigator.
pub fn webgpu_available(navigator: &web_sys::Navigator) -> bool {
    js_sys::Reflect::get(navigator, &JsValue::from_str("gpu"))
        .ok()
        .map(|v| !v.is_undefined() && !v.is_null())
        .unwrap_or(false)
}
