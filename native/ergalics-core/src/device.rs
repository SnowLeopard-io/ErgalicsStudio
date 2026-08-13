//! WebGPU device management.
//!
//! Thin wrapper over the browser WebGPU API via web-sys. The JS host
//! supplies `navigator.gpu`; this module handles adapter acquisition,
//! device request, and capability reporting.

use js_sys::Promise;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;
use web_sys::{Gpu, GpuAdapter, GpuDevice};

/// Information about the current GPU adapter.
#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct GpuInfo {
    name: String,
    backend: String,
    #[wasm_bindgen(getter_with_clone)]
    pub adapter: Option<GpuAdapter>,
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
    pub async fn acquire(gpu: Gpu) -> Result<GpuDeviceManager, JsValue> {
        let adapter: GpuAdapter = JsFuture::from(gpu.request_adapter()?)
            .await?
            .unchecked_into();

        let name = adapter_info_name(&adapter);
        let backend = adapter_backend(&adapter);

        let device = JsFuture::from(
            adapter
                .request_device_with_defaults()
                .map_err(|e| JsValue::from(e))?,
        )
        .await?
        .unchecked_into();

        Ok(GpuDeviceManager {
            device,
            info: GpuInfo {
                name,
                backend,
                adapter: Some(adapter),
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

fn adapter_info_name(adapter: &GpuAdapter) -> String {
    match adapter.request_adapter_info() {
        Ok(info) => info
            .get("device")
            .and_then(|v| v.as_string())
            .unwrap_or_else(|| "Unknown".to_string()),
        Err(_) => "Unknown".to_string(),
    }
}

fn adapter_backend(adapter: &GpuAdapter) -> String {
    // `GpuAdapter` exposes no backend string in web-sys currently; report it
    // as best effort using the presence of experimental properties.
    match adapter.request_adapter_info() {
        Ok(info) => info
            .get("backend")
            .and_then(|v| v.as_string())
            .unwrap_or_else(|| "webgpu".to_string()),
        Err(_) => "webgpu".to_string(),
    }
}

/// Check whether WebGPU is available in the current navigator.
pub fn webgpu_available(navigator: &web_sys::Navigator) -> bool {
    js_sys::Reflect::get(navigator, &JsValue::from_str("gpu"))
        .ok()
        .map(|v| !v.is_undefined() && !v.is_null())
        .unwrap_or(false)
}

/// Small helper to flatten an `Option`-based future into `Result`.
#[allow(dead_code)]
async fn promise_into<T: wasm_bindgen::UnwrapThrowExt>(promise: Promise) -> Result<T, JsValue> {
    JsFuture::from(promise).await?.unchecked_into()
}
