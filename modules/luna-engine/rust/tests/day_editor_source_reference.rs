mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::{OwnerIdentity, assembly::SnapshotAssembly},
    runtime::{
        SnapshotRegistry,
        day_editor_source::{
            DayEditorSourceError, DayEntryReadState, NativeDayEditorSource, RawDayEntrySource,
        },
        profile_editor_source::LightProfileContext,
        write_resource::WriteContextStamp,
    },
};
use serde_json::{Value, json};
fn stamp() -> WriteContextStamp {
    WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35})).unwrap()
}
fn registry() -> SnapshotRegistry {
    let r = SnapshotRegistry::default();
    r.reset_for_owner(&OwnerIdentity::new("day-source", 1).unwrap())
        .unwrap();
    r
}
fn light(r: &SnapshotRegistry, input: &Value, index: usize) -> LightProfileContext {
    let mut assembly=SnapshotAssembly::begin(&serde_json::to_vec(&json!({"ownerScope":"day-source","ownerEpoch":1,"snapshotId":format!("day-{index}"),"snapshotRevision":1,"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}})).unwrap()).unwrap();
    for group in input["profileSources"].as_array().unwrap() {
        assert_eq!(group["state"], "READY");
        let header = json!({"kind":group["kind"],"source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":group["presence"]}}}});
        assembly
            .source(
                &serde_json::to_vec(&header).unwrap(),
                group["body"].as_str().unwrap().as_bytes(),
            )
            .unwrap();
    }
    LightProfileContext::prepare(
        r.utility_owner_marker().unwrap(),
        stamp(),
        assembly,
        input["observedEpochMilliseconds"].as_i64().unwrap(),
    )
    .unwrap()
}
fn rows(input: &Value) -> Vec<RawDayEntrySource<'_>> {
    input["entrySources"]
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
        .collect()
}
#[test]
fn real_original_sql_lists_and_hook_initialization_match_joined_and_unjoined_roles() {
    let data = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    assert_eq!(data["cases"].as_array().unwrap().len(), 211);
    assert_eq!(data["excluded"].as_array().unwrap().len(), 10);
    let r = registry();
    for (index, case) in data["cases"].as_array().unwrap().iter().enumerate() {
        let input = &case["input"];
        let marker = r.preparation_marker().unwrap();
        let result = NativeDayEditorSource::from_light(
            light(&r, input, index),
            &stamp(),
            serde_json::from_value(input["request"].clone()).unwrap(),
            &rows(input),
        );
        if case["expected"]["state"] == "MISSING" {
            assert!(
                matches!(result, Err(DayEditorSourceError::MissingEntry)),
                "{}",
                case["id"]
            );
            continue;
        }
        let source = result.unwrap();
        assert!(marker.is_current().unwrap());
        assert!(source.is_current().unwrap());
        common::assert_json_eq(
            &serde_json::to_value(source.mode()).unwrap(),
            &case["expected"]["mode"],
            case["id"].as_str().unwrap(),
        );
        common::assert_json_eq(
            source.initial().unwrap_or(&Value::Null),
            &case["expected"]["initial"],
            case["id"].as_str().unwrap(),
        );
        common::assert_json_eq(
            source.unjoined().unwrap_or(&Value::Null),
            &case["expected"]["unjoined"],
            case["id"].as_str().unwrap(),
        );
        if case["expected"]["mode"] == "SHIFT" {
            common::assert_json_eq(
                &serde_json::to_value(source.templates().unwrap()).unwrap(),
                &case["expected"]["templates"],
                case["id"].as_str().unwrap(),
            );
        } else {
            assert!(source.templates().is_none());
        }
        let draft = source
            .new_draft(input["defaultShiftColor"].as_str().unwrap())
            .unwrap();
        let view = draft.view().unwrap();
        common::assert_json_eq(
            &view["fields"],
            &case["expected"]["draft"]["fields"],
            case["id"].as_str().unwrap(),
        );
        assert_eq!(
            view["hasChanges"], case["expected"]["draft"]["hasChanges"],
            "{}",
            case["id"]
        );
        assert_eq!(
            draft.initial_signature(),
            case["expected"]["draft"]["initialSignature"]
                .as_str()
                .unwrap(),
            "original nested object insertion order {}",
            case["id"]
        );
    }
}

#[test]
fn source_and_draft_are_sticky_owner_bound_and_sql_stamp_must_match_raw3() {
    let data = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    let input = &data["cases"][0]["input"];
    let r = registry();
    let different=WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"22222222222222222222222222222222","databaseSchemaVersion":35})).unwrap();
    assert!(matches!(
        NativeDayEditorSource::from_light(
            light(&r, input, 900),
            &different,
            serde_json::from_value(input["request"].clone()).unwrap(),
            &rows(input)
        ),
        Err(DayEditorSourceError::StampChanged)
    ));
    let marker = r.preparation_marker().unwrap();
    let source = NativeDayEditorSource::from_light(
        light(&r, input, 901),
        &stamp(),
        serde_json::from_value(input["request"].clone()).unwrap(),
        &rows(input),
    )
    .unwrap();
    assert!(marker.is_current().unwrap());
    r.reset_for_owner(&OwnerIdentity::new("day-source", 1).unwrap())
        .unwrap();
    assert!(!source.is_current().unwrap());
    assert!(matches!(
        source.new_draft("#ABCDEF"),
        Err(DayEditorSourceError::OwnerChanged)
    ));
}

#[test]
fn failed_missing_duplicate_oversized_and_ui_cache_sources_never_become_open_editors() {
    use luna_engine::runtime::day_editor_source::DayEntrySourceKind;
    let data = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    let initial = &data["cases"][0]["input"];
    let r = registry();
    let mut failed = initial.clone();
    failed["entrySources"][0]["state"] = json!("FAILED");
    failed["entrySources"][0]["body"] = json!("");
    assert!(matches!(
        NativeDayEditorSource::from_light(
            light(&r, &failed, 910),
            &stamp(),
            serde_json::from_value(failed["request"].clone()).unwrap(),
            &rows(&failed)
        ),
        Err(DayEditorSourceError::SourceFailed)
    ));
    let mut fake = initial.clone();
    fake["entrySources"][0]["body"] =
        json!("{\"state\":\"OPEN\",\"fields\":{\"hasChanges\":false}}");
    assert!(matches!(
        NativeDayEditorSource::from_light(
            light(&r, &fake, 911),
            &stamp(),
            serde_json::from_value(fake["request"].clone()).unwrap(),
            &rows(&fake)
        ),
        Err(DayEditorSourceError::InvalidSource)
    ));
    let mut duplicate = rows(initial);
    duplicate.push(RawDayEntrySource {
        kind: DayEntrySourceKind::EntryShift,
        state: DayEntryReadState::Null,
        body: b"",
    });
    assert!(matches!(
        NativeDayEditorSource::from_light(
            light(&r, initial, 912),
            &stamp(),
            serde_json::from_value(initial["request"].clone()).unwrap(),
            &duplicate
        ),
        Err(DayEditorSourceError::InvalidSource)
    ));
    assert!(matches!(
        NativeDayEditorSource::from_light(
            light(&r, initial, 913),
            &stamp(),
            serde_json::from_value(initial["request"].clone()).unwrap(),
            &[]
        ),
        Err(DayEditorSourceError::InvalidSource)
    ));
    let oversized = vec![b' '; 16_777_216];
    let raw = [RawDayEntrySource {
        kind: DayEntrySourceKind::EntryShift,
        state: DayEntryReadState::Value,
        body: &oversized,
    }];
    assert!(matches!(
        NativeDayEditorSource::from_light(
            light(&r, initial, 914),
            &stamp(),
            serde_json::from_value(initial["request"].clone()).unwrap(),
            &raw
        ),
        Err(DayEditorSourceError::InvalidSource)
    ));
}
