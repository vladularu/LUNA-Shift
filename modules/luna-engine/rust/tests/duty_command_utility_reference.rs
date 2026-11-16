mod common;
use luna_engine::{
    contract::{self, utility::parse_utility_request},
    runtime::utility,
};
use serde_json::{Value, json};
fn fixtures() -> Vec<(Value, Value)> {
    let clocks: Value =
        serde_json::from_str(include_str!("../../reference/duty-clock-golden.json")).unwrap();
    let drafts: Value =
        serde_json::from_str(include_str!("../../reference/duty-draft-golden.json")).unwrap();
    let inline: Value =
        serde_json::from_str(include_str!("../../reference/duty-inline-golden.json")).unwrap();
    clocks["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|case| {
            (
                json!({"kind":"CLOCK","operation":case["operation"],"input":case["input"]}),
                case["expected"].clone(),
            )
        })
        .chain(drafts["cases"].as_array().unwrap().iter().map(|case| {
            (
                json!({"kind":"DRAFT","input":case["input"]}),
                case["expected"].clone(),
            )
        }))
        .chain(inline["cases"].as_array().unwrap().iter().map(|case| {
            (
                json!({"kind":"INLINE","input":case["input"]}),
                case["expected"].clone(),
            )
        }))
        .collect()
}
fn envelope(command: Value, revision: usize) -> Value {
    json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"duty-command","ownerEpoch":1,"requestId":"duty","draftRevision":revision},"operation":{"kind":"DUTY_FORM_COMMAND","command":command}})
}
#[test]
fn every_original_clock_and_component_action_crosses_public_utility_parser() {
    let cases = fixtures();
    assert_eq!(cases.len(), 4318);
    for (index, (command, expected)) in cases.into_iter().enumerate() {
        let request =
            parse_utility_request(&serde_json::to_vec(&envelope(command, index + 1)).unwrap())
                .unwrap();
        let actual = serde_json::to_value(utility::calculate(request.operation())).unwrap();
        assert_eq!(actual["state"], "VALUE");
        common::assert_json_eq(&actual["value"], &expected, &format!("{index}"));
    }
}
#[test]
fn every_original_command_crosses_owned_c_buffers_and_foreign_controls_fail() {
    use luna_engine::ffi::*;
    fn take(buffer: EngineBuffer) -> Value {
        // SAFETY: this live engine buffer is copied before its one release.
        let value = serde_json::from_slice(unsafe {
            std::slice::from_raw_parts(buffer.bytes, buffer.length)
        })
        .unwrap();
        assert!(luna_engine_release_buffer(buffer.handle));
        value
    }
    take(luna_engine_reset());
    let owner = br#"{"ownerScope":"duty-command","ownerEpoch":1}"#;
    // SAFETY: borrowed immutable bytes remain live throughout the native call.
    assert_eq!(
        take(unsafe { luna_engine_bind_owner(owner.as_ptr(), owner.len()) })["ok"],
        true
    );
    for (index, (command, expected)) in fixtures().into_iter().enumerate() {
        let bytes = serde_json::to_vec(&envelope(command, index + 1)).unwrap();
        // SAFETY: borrowed immutable bytes remain live throughout the native call.
        let actual = take(unsafe { luna_engine_utility(bytes.as_ptr(), bytes.len()) });
        assert_eq!(actual["state"], "COMPLETED", "{index}:{actual}");
        common::assert_json_eq(&actual["result"]["value"], &expected, &format!("{index}"));
    }
    take(luna_engine_reset());
}
#[test]
fn closed_commands_reject_fabricated_ready_fields() {
    let mut command = fixtures()[0].0.clone();
    command["ready"] = json!(true);
    assert!(parse_utility_request(&serde_json::to_vec(&envelope(command, 1)).unwrap()).is_err());
    let command = json!({"kind":"CLOCK","operation":"READY_DUTY","input":{}});
    assert!(parse_utility_request(&serde_json::to_vec(&envelope(command, 1)).unwrap()).is_err());
}
