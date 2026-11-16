mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::{OwnerIdentity, assembly::SnapshotAssembly},
    input::{entry_editor_delete::RawDeletePreparation, entry_editor_save::EntrySaveFailure},
    runtime::{
        SnapshotRegistry,
        day_editor_source::{DayEntryReadState, NativeDayEditorSource, RawDayEntrySource},
        profile_editor_source::LightProfileContext,
        write_resource::WriteContextStamp,
    },
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::sync::Arc;
fn stamp() -> WriteContextStamp {
    WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35})).unwrap()
}
fn source(registry: &SnapshotRegistry, input: &Value, index: usize) -> Arc<NativeDayEditorSource> {
    let mut assembly=SnapshotAssembly::begin(&serde_json::to_vec(&json!({"ownerScope":"delete-source","ownerEpoch":1,"snapshotId":format!("delete-{index}"),"snapshotRevision":1,"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}})).unwrap()).unwrap();
    for group in input["profileSources"].as_array().unwrap() {
        assembly.source(&serde_json::to_vec(&json!({"kind":group["kind"],"source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":group["presence"]}}}})).unwrap(),group["body"].as_str().unwrap().as_bytes()).unwrap();
    }
    let light = LightProfileContext::prepare(
        registry.utility_owner_marker().unwrap(),
        stamp(),
        assembly,
        input["observedEpochMilliseconds"].as_i64().unwrap(),
    )
    .unwrap();
    let rows = input["entrySources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|group| RawDayEntrySource {
            kind: serde_json::from_value(group["kind"].clone()).unwrap(),
            state: if group["state"] == "FAILED" {
                DayEntryReadState::Failed
            } else if group["presence"] == "NULL" {
                DayEntryReadState::Null
            } else {
                DayEntryReadState::Value
            },
            body: group["body"].as_str().unwrap().as_bytes(),
        })
        .collect::<Vec<_>>();
    Arc::new(
        NativeDayEditorSource::from_light(
            light,
            &stamp(),
            serde_json::from_value(input["request"].clone()).unwrap(),
            &rows,
        )
        .unwrap(),
    )
}
#[test]
fn complete_original_delete_traces_cross_a_real_private_source_and_deferred_write_boundary() {
    let raw = include_str!("../../reference/day-editor-source-golden.json");
    let inputs = value_pool::decode(raw);
    let data = value_pool::decode(include_str!("../../reference/day-delete-golden.json"));
    assert_eq!(
        data["sourceFixtureSha256"],
        format!("{:x}", Sha256::digest(raw))
    );
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("delete-source", 1).unwrap())
        .unwrap();
    let mut sources = std::collections::BTreeMap::new();
    let mut checked = 0;
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let i = input["sourceIndex"].as_u64().unwrap() as usize;
        let source = sources
            .entry(i)
            .or_insert_with(|| source(&registry, &inputs["cases"][i]["input"], i));
        let prepared =
            RawDeletePreparation::prepare(source.initial(), input["busy"].as_bool().unwrap());
        let begin = prepared.begin();
        for key in ["events", "writes", "saving", "savingRef"] {
            common::assert_json_eq(
                &begin[key],
                &case["expected"]["begin"][key],
                case["id"].as_str().unwrap(),
            );
        }
        let failure = match input["failureKind"].as_str().unwrap() {
            "SUCCESS" => None,
            "USER_FACING" => Some(EntrySaveFailure::UserFacing(
                input["message"].as_str().unwrap().into(),
            )),
            "CONCURRENCY" => Some(EntrySaveFailure::UserFacing(
                "Der Eintrag wurde zwischenzeitlich geändert. Bitte neu laden.".into(),
            )),
            _ => Some(EntrySaveFailure::Internal),
        };
        let done = prepared.finish(failure.as_ref());
        for key in ["events", "saving", "savingRef"] {
            common::assert_json_eq(
                &done[key],
                &case["expected"]["completion"][key],
                case["id"].as_str().unwrap(),
            );
        }
        checked += 1;
    }
    assert_eq!(checked, 2520);
}
