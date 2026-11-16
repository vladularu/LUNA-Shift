use luna_engine::{
    ffi::*,
    runtime::form_resource::{MAX_FORM_BODY_BYTES, MAX_FORM_HEADER_BYTES},
};
use serde_json::{Value, json};
fn take(buffer: EngineBuffer) -> Value {
    assert!(!buffer.bytes.is_null());
    assert!(buffer.length <= 33_554_432);
    // SAFETY: the matching library returned this live descriptor.
    let value =
        serde_json::from_slice(unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) })
            .unwrap();
    if buffer.handle != 0 {
        assert!(luna_engine_release_buffer(buffer.handle));
        assert!(!luna_engine_release_buffer(buffer.handle));
    }
    value
}
#[test]
fn form_bounds_precede_pointer_reads_and_null_input_never_echoes_user_data() {
    for (header_len, body_len) in [(MAX_FORM_HEADER_BYTES + 1, 0), (0, MAX_FORM_BODY_BYTES + 1)] {
        // SAFETY: oversized ranges must be rejected without reading null.
        let reply = take(unsafe {
            luna_engine_form_resource(std::ptr::null(), header_len, std::ptr::null(), body_len)
        });
        assert_eq!(reply["code"], "INPUT_TOO_LARGE");
    }
    let owner =
        serde_json::to_vec(&json!({"ownerScope":"form-c-boundary","ownerEpoch":1})).unwrap();
    // SAFETY: the owner vector is retained for the complete synchronous call.
    assert_eq!(
        take(unsafe { luna_engine_bind_owner(owner.as_ptr(), owner.len()) })["ok"],
        true
    );
    // SAFETY: null/nonempty is explicitly invalid and checked before dereference.
    let reply =
        take(unsafe { luna_engine_form_resource(std::ptr::null(), 1, std::ptr::null(), 0) });
    assert_eq!(reply["ok"], false);
    assert_eq!(reply["code"], "INVALID_JSON");
    let header = b"private malformed identifier";
    // SAFETY: this fixed byte array remains readable until return.
    let reply = take(unsafe {
        luna_engine_form_resource(header.as_ptr(), header.len(), std::ptr::null(), 0)
    });
    assert_eq!(reply["ok"], false);
    assert!(!reply.to_string().contains("private"));
}
