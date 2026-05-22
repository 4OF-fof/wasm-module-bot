use crate::codec::encode_json;
use crate::types::PluginError;
use serde::Serialize;
use std::mem;

const SERIALIZE_FALLBACK_JSON: &str = r#"{"status":"err","error":{"code":"serialize_failed","message":"failed to serialize plugin API response"}}"#;

pub fn alloc_buffer(size: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(size);
    let ptr = buffer.as_mut_ptr();
    mem::forget(buffer);
    ptr
}

/// # Safety
///
/// `ptr` and `len` must describe a buffer previously returned by `alloc_buffer`.
pub unsafe fn dealloc_buffer(ptr: *mut u8, len: usize) {
    let _ = Vec::from_raw_parts(ptr, 0, len);
}

pub fn return_value<T>(value: &T) -> u64
where
    T: Serialize,
{
    let json = encode_json(value).unwrap_or_else(|error| error_json(&error));
    return_json(&json)
}

fn error_json(error: &PluginError) -> String {
    serde_json::json!({
        "status": "err",
        "error": {
            "code": error.code,
            "message": error.message,
        }
    })
    .to_string()
}

/// Returns a packed pointer/length pair for the host ABI.
///
/// The high 32 bits contain the pointer and the low 32 bits contain the byte length.
/// This is intended for wasm32 modules where linear-memory pointers fit in 32 bits.
fn return_json(json: &str) -> u64 {
    let bytes = json.as_bytes().to_vec();
    let len = bytes.len();
    if len > u32::MAX as usize {
        return return_json(SERIALIZE_FALLBACK_JSON);
    }
    let ptr = bytes.as_ptr() as usize;
    mem::forget(bytes);
    ((ptr as u64) << 32) | (len as u64)
}
