use crate::codec::encode_json;
use serde::Serialize;
use std::mem;

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
    let json = encode_json(value);
    return_json(&json)
}

fn return_json(json: &str) -> u64 {
    let bytes = json.as_bytes().to_vec();
    let len = bytes.len();
    let ptr = bytes.as_ptr() as usize;
    mem::forget(bytes);
    ((ptr as u64) << 32) | (len as u64)
}
