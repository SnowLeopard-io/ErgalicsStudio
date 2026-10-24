//! Miscellaneous native utilities.

use wasm_bindgen::prelude::*;

/// Result of a file-kind detection.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    /// Detected by its magic-number header.
    Magic,
    /// Detected only by its file extension.
    Extension,
    /// Could not be identified.
    Unknown,
}

/// Detect whether a byte prefix matches a known magic number.
///
/// Returns the detected kind. A `None` means no known header matched;
/// callers may then fall back to extension-based detection.
#[wasm_bindgen]
pub fn detect_file_kind(prefix: &[u8]) -> Option<FileKind> {
    if prefix.len() < 4 {
        return Some(FileKind::Unknown);
    }

    // PK\x03\x04 — ZIP archives (cspkg, office formats, etc.)
    if prefix[0] == 0x50 && prefix[1] == 0x4b && prefix[2] == 0x03 && prefix[3] == 0x04 {
        return Some(FileKind::Magic);
    }

    // JSON / text based — UTF-8 JSON starts with '{'
    if prefix[0] == b'{' {
        return Some(FileKind::Magic);
    }

    Some(FileKind::Unknown)
}

/// Log helper writing through to the browser console.
#[wasm_bindgen]
pub fn log(message: &str) {
    web_sys::console::log_1(&JsValue::from_str(message));
}
