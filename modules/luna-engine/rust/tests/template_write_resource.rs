mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::OwnerIdentity,
    input::InputError,
    runtime::{
        SnapshotRegistry,
        write_resource::{
            CommittedCalendarChange, CommittedTemplateAction, NativeWriteContext, WriteContextKind,
            WriteContextStamp, WriteResourceError,
        },
    },
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
fn registry() -> SnapshotRegistry {
    let r = SnapshotRegistry::default();
    r.reset_for_owner(&OwnerIdentity::new("template-writer", 1).unwrap())
        .unwrap();
    r
}
fn stamp(changed: bool) -> WriteContextStamp {
    WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":if changed{"22222222222222222222222222222222"}else{"11111111111111111111111111111111"},"databaseSchemaVersion":35})).unwrap()
}
fn context(r: &SnapshotRegistry, input: &Value) -> NativeWriteContext {
    NativeWriteContext::from_raw(
        r.utility_owner_marker().unwrap(),
        stamp(false),
        WriteContextKind::Template,
        &serde_json::to_vec(&json!({"templateRows":input["rows"]})).unwrap(),
    )
    .unwrap()
}
fn error(e: &InputError) -> Value {
    use luna_engine::input::entry_editor_save::EntrySaveFailure;
    json!({"name":e.name(),"message":e.message(),"userFacing":matches!(EntrySaveFailure::from_input_error(e),EntrySaveFailure::UserFacing(_)),"code":null})
}
#[test]
fn genuine_template_domain_is_the_only_source_of_shared_writer_permits() {
    let data = value_pool::decode(include_str!("../../reference/template-write-golden.json"));
    let r = registry();
    let mut dumped = Vec::new();
    assert_eq!(data["cases"].as_array().unwrap().len(), 135);
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let expected = &case["expected"];
        let context = context(&r, input);
        let epochs = input["epochs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_f64().unwrap())
            .collect::<Vec<_>>();
        let result = context.prepare_template(
            serde_json::from_value(input["operation"].clone()).unwrap(),
            &input["payload"],
            &epochs,
            input["allocatedId"].as_str(),
        );
        match result {
            Err(WriteResourceError::Input(e)) => {
                common::assert_json_eq(
                    &error(&e),
                    &expected["result"]["error"],
                    case["id"].as_str().unwrap(),
                );
                assert_eq!(expected["rows"], input["rows"]);
                dumped.push(json!({"id":case["id"],"result":{"body":null,"returned":null,"error":error(&e),"postError":null}}));
            }
            Err(e) => panic!("{} unexpected source error {e:?}", case["id"]),
            Ok(permit) => {
                let taken = context.take(&permit).unwrap();
                let plan: Value = serde_json::from_str(&taken.body).unwrap();
                assert_eq!(taken.stamp, stamp(false));
                assert_eq!(plan["schemaVersion"], 1);
                let mutations = plan["mutations"].as_array().unwrap();
                if expected["result"]["error"]["code"] == "SQLITE_CONSTRAINT_NOTNULL" {
                    assert_eq!(case["id"], "field/sortOrder/null");
                    assert!(mutations[0]["row"]["sort_order"].is_null());
                    context.abort(&permit).unwrap();
                    assert!(context.acknowledge(&permit, stamp(true)).is_err());
                    dumped.push(json!({"id":case["id"],"result":{"body":plan,"returned":null,"error":null,"postError":null}}));
                    continue;
                }
                let mut rows = input["rows"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|r| (r["id"].as_str().unwrap().to_owned(), r.clone()))
                    .collect::<BTreeMap<_, _>>();
                for mutation in mutations {
                    let row = &mutation["row"];
                    rows.insert(row["id"].as_str().unwrap().to_owned(), row.clone());
                }
                common::assert_json_eq(
                    &json!(rows.into_values().collect::<Vec<_>>()),
                    &expected["rows"],
                    case["id"].as_str().unwrap(),
                );
                let mut committed = context
                    .acknowledge(&permit, stamp(!mutations.is_empty()))
                    .unwrap();
                let delta = context.take_calendar_delta(&mut committed).unwrap();
                assert_eq!(delta.stamp(), committed.stamp());
                assert!(matches!(
                    context.take_calendar_delta(&mut committed),
                    Err(WriteResourceError::AlreadyCompleted)
                ));
                let changes = delta
                    .consume_for_owner(&r.utility_owner_marker().unwrap())
                    .unwrap();
                if expected["result"]["ok"] == true {
                    assert_eq!(changes.len(), mutations.len());
                    let action = match input["operation"].as_str().unwrap() {
                        "SAVE" => CommittedTemplateAction::Save,
                        "DELETE" => CommittedTemplateAction::Delete,
                        "RESTORE" => CommittedTemplateAction::Restore,
                        _ => CommittedTemplateAction::Order,
                    };
                    for (change, mutation) in changes.into_iter().zip(mutations) {
                        let CommittedCalendarChange::Template {
                            action: actual,
                            row,
                        } = change
                        else {
                            panic!("template mutation")
                        };
                        assert_eq!(actual, action);
                        common::assert_json_eq(
                            &row,
                            &mutation["row"],
                            case["id"].as_str().unwrap(),
                        );
                    }
                    let returned = context.committed_template(committed).unwrap();
                    common::assert_json_eq(
                        &returned,
                        &expected["result"]["value"],
                        case["id"].as_str().unwrap(),
                    );
                    dumped.push(json!({"id":case["id"],"result":{"body":plan,"returned":returned,"error":null,"postError":null}}));
                } else {
                    assert!(
                        changes.is_empty(),
                        "committed mapped-read failure must not publish a template"
                    );
                    let Err(WriteResourceError::Input(failure)) =
                        context.committed_template(committed)
                    else {
                        panic!("original postwrite failure")
                    };
                    common::assert_json_eq(
                        &error(&failure),
                        &expected["result"]["error"],
                        case["id"].as_str().unwrap(),
                    );
                    dumped.push(json!({"id":case["id"],"result":{"body":plan,"returned":null,"error":null,"postError":error(&failure)}}));
                }
                assert!(context.take(&permit).is_err());
                assert!(context.acknowledge(&permit, stamp(true)).is_err());
            }
        }
    }
    if let Some(path) = std::env::var_os("LUNA_TEMPLATE_WRITE_NATIVE_DUMP") {
        use sha2::{Digest, Sha256};
        assert_eq!(dumped.len(), 135);
        let dump = json!({"schemaVersion":1,"producer":"ACTUAL_RUST_CONTEXT_TAKE_TEST","engineVersion":luna_engine::ENGINE_VERSION,"fixtureSha256":format!("{:x}",Sha256::digest(include_bytes!("../../reference/template-write-golden.json"))),"cases":dumped});
        let bytes = serde_json::to_vec(&dump).unwrap();
        assert!(bytes.len() <= 16_777_216);
        std::fs::write(path, bytes).unwrap();
    }
}

#[test]
fn calendar_delta_and_receipt_are_independent_single_use_native_capabilities() {
    let data = value_pool::decode(include_str!("../../reference/template-write-golden.json"));
    let input = &data["cases"][0]["input"];
    let r = registry();
    let context = context(&r, input);
    let epochs = input["epochs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_f64().unwrap())
        .collect::<Vec<_>>();
    let prepare = || {
        context
            .prepare_template(
                luna_engine::input::template_write::TemplateWriteOperation::Save,
                &input["payload"],
                &epochs,
                input["allocatedId"].as_str(),
            )
            .unwrap()
    };
    let permit = prepare();
    assert!(matches!(
        context.acknowledge(&permit, stamp(true)),
        Err(WriteResourceError::NotTaken)
    ));
    context.take(&permit).unwrap();
    let mut committed = context.acknowledge(&permit, stamp(true)).unwrap();
    let foreign_context = NativeWriteContext::from_raw(
        r.utility_owner_marker().unwrap(),
        stamp(false),
        WriteContextKind::Template,
        &serde_json::to_vec(&json!({"templateRows":input["rows"]})).unwrap(),
    )
    .unwrap();
    assert!(matches!(
        foreign_context.take_calendar_delta(&mut committed),
        Err(WriteResourceError::ForeignPermit)
    ));
    let delta = context.take_calendar_delta(&mut committed).unwrap();
    let foreign = registry();
    assert!(matches!(
        delta.consume_for_owner(&foreign.utility_owner_marker().unwrap()),
        Err(WriteResourceError::ForeignPermit)
    ));
    assert_eq!(
        context.committed_template(committed).unwrap(),
        data["cases"][0]["expected"]["result"]["value"]
    );
    let permit = prepare();
    context.take(&permit).unwrap();
    let mut committed = context.acknowledge(&permit, stamp(true)).unwrap();
    let delta = context.take_calendar_delta(&mut committed).unwrap();
    r.reset_for_owner(&OwnerIdentity::new("template-writer", 1).unwrap())
        .unwrap();
    assert!(matches!(
        delta.consume_for_owner(&r.utility_owner_marker().unwrap()),
        Err(WriteResourceError::OwnerChanged)
    ));
    assert!(matches!(
        context.committed_template(committed),
        Err(WriteResourceError::OwnerChanged)
    ));
}

#[test]
fn template_context_rejects_host_ready_fields_and_wrong_source_kinds() {
    let r = registry();
    for raw in [
        json!({}),
        json!({"templateRows":null}),
        json!({"templateRows":[],"ready":true}),
        json!({"templates":[]}),
        json!({"templateRows":[{}]}),
    ] {
        assert!(
            NativeWriteContext::from_raw(
                r.utility_owner_marker().unwrap(),
                stamp(false),
                WriteContextKind::Template,
                &serde_json::to_vec(&raw).unwrap()
            )
            .is_err()
        );
    }
    let context = NativeWriteContext::from_raw(
        r.utility_owner_marker().unwrap(),
        stamp(false),
        WriteContextKind::Payroll,
        &serde_json::to_vec(
            &json!({"netProfiles":[],"salaryPreference":null,"profileRows":[],"testMonths":[]}),
        )
        .unwrap(),
    )
    .unwrap();
    assert!(matches!(
        context.prepare_template(
            luna_engine::input::template_write::TemplateWriteOperation::Delete,
            &json!({"id":"x","revision":1}),
            &[0.0, 1.0],
            None
        ),
        Err(WriteResourceError::InvalidContext)
    ));
}
