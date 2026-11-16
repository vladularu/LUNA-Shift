mod common;
#[path = "support/snapshot.rs"]
mod snapshot_fixture;
#[path = "support/value_pool.rs"]
mod value_pool;
use jiff::ToSpan;
use luna_engine::{
    contract::{self, ImmutableSnapshot, SourceKind, ValidatedRequest},
    rules::RuleResolver,
    runtime::{facts::SnapshotFacts, report::SectionOutput, target_ui},
    target::{self, InputStatus, PreparedTargetSource, TargetError},
};
use serde_json::{Value, json};
use std::sync::Arc;
#[test]
fn dedicated_original_screen_inputs_and_month_titles_have_complete_native_outputs() {
    let fixture = value_pool::decode(include_str!("../../reference/target-ui-views-golden.json"));
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 23);
    let resolver = RuleResolver::bundled().unwrap();
    let mut output = Vec::new();
    for case in fixture["cases"].as_array().unwrap() {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let mut actual = evaluate(&input, &resolver).unwrap();
        actual["monthTitle"] =
            json!(target_ui::month_title(input["month"].as_str().unwrap()).unwrap());
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        output.push(json!({"id":case["id"],"value":actual}));
    }
    for item in fixture["monthTitles"].as_array().unwrap() {
        assert_eq!(
            target_ui::month_title(item["month"].as_str().unwrap()).unwrap(),
            item["title"]
        );
    }
    if let Some(path) = std::env::var_os("LUNA_TARGET_UI_DUMP") {
        use sha2::{Digest, Sha256};
        let bytes = include_bytes!("../../reference/target-ui-views-golden.json");
        let dump = json!({"schemaVersion":1,"sourceDigest":fixture["sourceDigest"],"engineVersion":luna_engine::ENGINE_VERSION,"inputFixtureSha256":format!("{:x}",Sha256::digest(bytes)),"cases":output});
        let bytes = serde_json::to_vec_pretty(&dump).unwrap();
        assert!(bytes.len() < 16 * 1024 * 1024);
        std::fs::write(path, bytes).unwrap();
    }
}
fn evaluate(input: &Value, resolver: &RuleResolver) -> Result<Value, TargetError> {
    if input["kind"] == "SNAPSHOT" {
        return match target_ui::overview(
            &facts(raw_snapshot(input)),
            input["month"].as_str().unwrap(),
        ) {
            SectionOutput::Ready { value } => Ok(value),
            other => panic!("native source not ready: {other:?}"),
        };
    }
    let source = PreparedTargetSource::new(Arc::new(profile(input)?));
    target::presentation::overview(
        input["month"].as_str().unwrap(),
        &source,
        &input["displayProfile"],
        resolver,
    )
}
fn profile(input: &Value) -> Result<Value, TargetError> {
    if input["kind"] == "CREATE_PROFILE" {
        target::profile::create_working_time_calculation_profile(
            &input["profile"],
            input.get("snapshot").filter(|v| !v.is_null()),
            input["history"].as_array().unwrap(),
            serde_json::from_value::<InputStatus>(input["status"].clone()).unwrap(),
            input["youthProtection"].as_bool(),
            serde_json::from_value::<InputStatus>(input["youthProtectionStatus"].clone()).unwrap(),
        )
    } else {
        let mut profile = input["profile"].clone();
        if input["kind"] == "LARGE_PROFILE" {
            let start = input["dayRange"]["start"]
                .as_str()
                .unwrap()
                .parse::<jiff::civil::Date>()
                .unwrap();
            profile["workingTimeTarget"]["context"]["days"]=Value::Array((0..input["dayRange"]["count"].as_i64().unwrap()).map(|index|json!({"date":start.checked_add(index.days()).unwrap().to_string(),"rosterStatus":"FINAL","disposition":"ROSTER_FREE"})).collect());
        }
        Ok(profile)
    }
}
#[test]
fn complete_original_target_overview_computations_and_ui_policies_match() {
    let fixture = value_pool::decode(include_str!("../../reference/target-ui-golden.json"));
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 550);
    let resolver = RuleResolver::bundled().unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let result = evaluate(&input, &resolver);
        if case["id"] == "profile-profile-invalid-history-date" {
            assert!(matches!(result, Err(TargetError::InvalidInput)));
            continue;
        }
        let actual = match result {
            Ok(value) => json!({"value":value}),
            Err(error) => {
                json!({"error":{"name":"WorkingTimeTargetError","message":error.to_string()}})
            }
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
#[test]
fn fifty_thousand_raw_target_days_are_prepared_once_and_never_returned_as_ui_metadata() {
    let fixture = value_pool::decode(include_str!("../../reference/target-ui-golden.json"));
    let case = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "large-50000-forecast-days")
        .unwrap();
    let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
    let original = Arc::new(profile(&input).unwrap());
    let source = PreparedTargetSource::new(Arc::clone(&original));
    let resolver = RuleResolver::bundled().unwrap();
    for _ in 0..3 {
        let actual = target::presentation::overview(
            input["month"].as_str().unwrap(),
            &source,
            &input["displayProfile"],
            &resolver,
        )
        .unwrap();
        common::assert_json_eq(
            &actual,
            &case["expected"]["value"],
            "large-original-overview",
        );
        assert!(serde_json::to_vec(&actual).unwrap().len() < 64 * 1024);
        assert!(std::ptr::eq(source.profile(), original.as_ref()));
    }
    assert_eq!(source.stats().input_parses, 1);
    assert_eq!(source.stats().context_preparations, 1);
}
fn ready(value: Value) -> Value {
    json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":value}}})
}
fn set(raw: &mut Value, kind: SourceKind, state: Value) {
    let kind = serde_json::to_value(kind).unwrap();
    raw["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|s| s["kind"] == kind)
        .unwrap()["source"] = state;
}
fn raw_snapshot(input: &Value) -> Value {
    let mut raw = snapshot_fixture::raw_snapshot(1, "target-ui", 1);
    raw["referenceDate"] = input["referenceDate"].clone();
    raw["clockContext"] = json!({"observedEpochMilliseconds":input["observedEpochMilliseconds"]});
    for (kind, key) in [
        (SourceKind::WorkProfile, "profile"),
        (SourceKind::RemunerationProfiles, "historyRows"),
        (SourceKind::WorkPatternSettings, "patternRows"),
    ] {
        set(&mut raw, kind, ready(input[key].clone()));
    }
    set(
        &mut raw,
        SourceKind::CalendarEntries,
        ready(
            json!({"shiftRows":[],"appointmentRows":[],"templateRows":[],"platformCollationRanks":{}}),
        ),
    );
    let mut target = input["targetRow"].clone();
    if target.is_null() {
        set(
            &mut raw,
            SourceKind::WorkingTimeTarget,
            json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"NULL"}}}),
        );
    } else {
        let serialized = target
            .as_object_mut()
            .unwrap()
            .remove("settings_json")
            .unwrap();
        target["settings_json_chunks"] = json!([serialized]);
        set(&mut raw, SourceKind::WorkingTimeTarget, ready(target));
    }
    set(
        &mut raw,
        SourceKind::YouthPreference,
        ready(json!({"value":"false"})),
    );
    raw["catalogs"]["current"]["selectedPackageIds"] = json!({"tariff":["tvoed-p-vka-legacy"],"legal":["de-arbzg-care-legacy"],"holiday":["de-holidays-legacy"]});
    for kind in ["tariff", "legal", "holiday"] {
        raw["catalogs"]["current"][kind] = ready(json!({"mode":"COMPILED_LEGACY"}));
    }
    raw
}
fn facts(mut raw: Value) -> SnapshotFacts {
    snapshot_fixture::seal(&mut raw);
    let envelope = json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}});
    let snapshot: ImmutableSnapshot =
        match contract::parse_request(&serde_json::to_vec(&envelope).unwrap()).unwrap() {
            ValidatedRequest::RegisterSnapshot(snapshot) => snapshot,
            _ => panic!("snapshot"),
        };
    SnapshotFacts::new(snapshot)
}
#[test]
fn target_ui_uses_checked_sources_and_one_shared_typed_context_without_salary_readiness() {
    let fixture = value_pool::decode(include_str!("../../reference/target-ui-golden.json"));
    let case = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "snapshot-three-zone-2026-11-12T23:30:00Z-saved")
        .unwrap();
    let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
    let raw = raw_snapshot(&input);
    let owner = facts(raw.clone());
    for _ in 0..3 {
        let SectionOutput::Ready { value } = target_ui::overview(&owner, "2026-12") else {
            panic!("ready target view")
        };
        common::assert_json_eq(
            &value,
            &case["expected"]["value"],
            "snapshot-native-current-base",
        );
    }
    let stats = owner.prepared_targets().unwrap().unwrap().stats();
    assert_eq!(stats.input_parses, 1);
    assert_eq!(stats.context_preparations, 1);
    for (kind, state, code) in [
        (
            SourceKind::WorkingTimeTarget,
            json!({"state":"LOADING"}),
            "SOURCE_LOADING",
        ),
        (
            SourceKind::RemunerationProfiles,
            json!({"state":"FAILED","code":"READ_FAILED"}),
            "SOURCE_READ_FAILED",
        ),
    ] {
        let mut bad = raw.clone();
        set(&mut bad, kind, state);
        let SectionOutput::Unavailable { reason } = target_ui::overview(&facts(bad), "2026-12")
        else {
            panic!("typed unavailable")
        };
        assert_eq!(reason.code, code);
        assert_eq!(reason.source, Some(kind));
    }
    let mut no_clock = raw;
    no_clock.as_object_mut().unwrap().remove("clockContext");
    let SectionOutput::Unavailable { reason } = target_ui::overview(&facts(no_clock), "2026-12")
    else {
        panic!("missing clock")
    };
    assert_eq!(reason.code, "PROFILE_CLOCK_REQUIRED");
}

#[test]
fn time_month_keeps_its_primary_readiness_and_transports_an_independent_target_frame() {
    use luna_engine::{
        contract::ReportPeriod,
        runtime::{report::ReportIssue, view_composition::ViewCompositionSource},
    };
    let fixture = value_pool::decode(include_str!("../../reference/target-ui-golden.json"));
    let case = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "snapshot-three-zone-2026-11-12T23:30:00Z-saved")
        .unwrap();
    let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
    let owner = facts(raw_snapshot(&input));
    let view = ViewCompositionSource::from_facts(&owner).time(&ReportPeriod::Month {
        month: "2026-12".into(),
    });
    let SectionOutput::Ready { value } = view.overlay else {
        panic!("time overlay")
    };
    assert!(value.get("monthlyAnalysis").is_some());
    assert_eq!(value["targetOverview"]["state"], "READY");
    let target = target_ui::time_presentation(&owner, "2026-12");
    let mixed = target_ui::with_time_overlay(
        SectionOutput::Unavailable {
            reason: ReportIssue::new("SOURCE_LOADING"),
        },
        target,
    );
    let SectionOutput::Ready { value } = mixed else {
        panic!("supplemental target")
    };
    assert!(value.get("monthlyAnalysis").is_none());
    assert_eq!(value["legacyState"]["state"], "UNAVAILABLE");
    assert_eq!(value["targetOverview"]["state"], "READY");
}
