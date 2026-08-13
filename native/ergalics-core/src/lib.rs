//! Ergalics Core — native WASM layer for Ergalics Studio.
//!
//! Provides:
//! - WebGPU device management (adapter / device acquisition)
//! - Compute shader scheduling framework
//! - Miscellaneous native utilities
//!
//! All logic is reachable from JS/TS through wasm-bindgen exports.

mod compute;
mod device;
mod utils;

use wasm_bindgen::prelude::*;

pub use compute::{ComputeKernel, ComputeQueue, KernelDescriptor};
pub use device::{GpuDeviceManager, GpuInfo};
pub use utils::detect_file_kind;

/// Initialize the WASM module. Sets up panic hook so Rust panics
/// surface as console errors instead of silent corruption.
#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
    #[cfg(feature = "console")]
    utils::log("Ergalics Core WASM module initialized.");
}

/// Version of the native core.
#[wasm_bindgen]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
