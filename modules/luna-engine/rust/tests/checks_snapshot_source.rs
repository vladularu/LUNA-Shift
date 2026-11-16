mod common;
#[path = "support/snapshot.rs"]
mod snapshot;
use luna_engine::{
    contract::{self, ImmutableSnapshot, SourceKind, ValidatedRequest},
    runtime::{checks_source::ChecksSnapshotSource, facts::SnapshotFacts},
};
use serde_json::{Value, json};
fn ready(data: Value) -> Value {
    json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":data}})
}
fn value(data: Value) -> Value {
    ready(json!({"kind":"VALUE","value":data}))
}
fn set(raw: &mut Value, kind: SourceKind, state: Value) {
    let kind = serde_json::to_value(kind).unwrap();
    raw["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|g| g["kind"] == kind)
        .unwrap()["source"] = state;
}
fn parsed(mut raw: Value) -> ImmutableSnapshot {
    snapshot::seal(&mut raw);
    let envelope = json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"REGISTER_SNAPSHOT","snapshot":raw}});
    match contract::parse_request(&serde_json::to_vec(&envelope).unwrap()).unwrap() {
        ValidatedRequest::RegisterSnapshot(s) => s,
        _ => panic!("snapshot expected"),
    }
}
fn raw(input: &Value) -> Value {
    let mut out = snapshot::raw_snapshot(1, "checks", 1);
    out["referenceDate"] = input["referenceDate"].clone();
    set(
        &mut out,
        SourceKind::WorkProfile,
        value(input["profile"].clone()),
    );
    set(
        &mut out,
        SourceKind::RemunerationProfiles,
        value(input["historyRows"].clone()),
    );
    set(
        &mut out,
        SourceKind::WorkPatternSettings,
        value(input["patternRows"].clone()),
    );
    set(
        &mut out,
        SourceKind::CalendarEntries,
        value(
            json!({"shiftRows":input["shiftRows"],"appointmentRows":[],"platformCollationRanks":input["platformCollationRanks"]}),
        ),
    );
    let mut target = input["targetRow"].clone();
    if target.is_null() {
        set(
            &mut out,
            SourceKind::WorkingTimeTarget,
            ready(json!({"kind":"NULL"})),
        );
    } else {
        let text = target
            .as_object_mut()
            .unwrap()
            .remove("settings_json")
            .unwrap();
        target["settings_json_chunks"] = json!([text]);
        set(&mut out, SourceKind::WorkingTimeTarget, value(target));
    }
    set(
        &mut out,
        SourceKind::YouthPreference,
        value(json!({"value":if input["youthProtection"]==true{"true"}else{"false"}})),
    );
    if input["trainingRequested"] == true {
        set(
            &mut out,
            SourceKind::TrainingProfiles,
            value(input["trainingProfileRows"].clone()),
        );
        set(
            &mut out,
            SourceKind::TrainingShiftDetails,
            value(input["trainingDetailRows"].clone()),
        );
    }
    out["catalogs"]["current"]["selectedPackageIds"] = json!({"tariff":["tvoed-p-vka-legacy"],"legal":["de-arbzg-care-legacy"],"holiday":["de-holidays-legacy"]});
    for k in ["tariff", "legal", "holiday"] {
        out["catalogs"]["current"][k] = value(json!({"mode":"COMPILED_LEGACY"}));
    }
    out
}
fn corpus() -> Value {
    serde_json::from_str(include_str!("../../reference/checks-snapshot-golden.json")).unwrap()
}
#[test]
fn complete_raw_snapshot_month_and_year_checks_match_original_provider_pipeline() {
    let data = corpus();
    assert_eq!(data["cases"].as_array().unwrap().len(), 57);
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let facts = SnapshotFacts::new(parsed(raw(input)));
        common::assert_json_eq(
            facts.calculation_profile().unwrap().unwrap(),
            &case["profileExpected"],
            case["id"].as_str().unwrap(),
        );
        let source = ChecksSnapshotSource::from_facts(&facts).unwrap();
        let actual = if input["period"]["kind"] == "MONTH" {
            source.month(input["period"]["month"].as_str().unwrap())
        } else {
            source.year(input["period"]["year"].as_i64().unwrap() as i32)
        }
        .unwrap();
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
    }
}
#[test]
fn missing_loading_failed_and_null_core_sources_are_not_empty_ready_checks() {
    let seed = corpus()["cases"][0]["input"].clone();
    for kind in [
        SourceKind::WorkProfile,
        SourceKind::CalendarEntries,
        SourceKind::RemunerationProfiles,
        SourceKind::WorkingTimeTarget,
        SourceKind::WorkPatternSettings,
        SourceKind::YouthPreference,
    ] {
        for (state, code) in [
            (json!({"state":"NOT_REQUESTED"}), "SOURCE_NOT_REQUESTED"),
            (json!({"state":"LOADING"}), "SOURCE_LOADING"),
            (
                json!({"state":"FAILED","code":"READ_FAILED"}),
                "SOURCE_READ_FAILED",
            ),
            (ready(json!({"kind":"MISSING"})), "SOURCE_MISSING"),
        ] {
            let mut input = raw(&seed);
            set(&mut input, kind, state);
            let facts = SnapshotFacts::new(parsed(input));
            let issue = match ChecksSnapshotSource::from_facts(&facts) {
                Ok(_) => panic!("unavailable source became ready {kind:?}"),
                Err(e) => e,
            };
            assert_eq!(issue.code, code, "{kind:?}");
            assert_eq!(issue.source, Some(kind));
        }
    }
    let mut input = raw(&seed);
    set(
        &mut input,
        SourceKind::WorkProfile,
        ready(json!({"kind":"NULL"})),
    );
    let error = ChecksSnapshotSource::from_facts(&SnapshotFacts::new(parsed(input)))
        .err()
        .unwrap();
    assert_eq!(error.code, "PROFILE_MISSING");
}
#[test]
fn training_state_is_independent_and_keeps_source_identity() {
    let data = corpus();
    let seed = &data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            c["input"]["trainingRequested"] == true && c["input"]["period"]["kind"] == "MONTH"
        })
        .unwrap()["input"];
    for kind in [
        SourceKind::TrainingProfiles,
        SourceKind::TrainingShiftDetails,
    ] {
        for (state, code) in [
            (json!({"state":"LOADING"}), "SOURCE_LOADING"),
            (
                json!({"state":"FAILED","code":"READ_FAILED"}),
                "SOURCE_READ_FAILED",
            ),
            (ready(json!({"kind":"MISSING"})), "SOURCE_MISSING"),
            (ready(json!({"kind":"NULL"})), "SOURCE_NULL"),
        ] {
            let mut input = raw(seed);
            set(&mut input, kind, state);
            let facts = SnapshotFacts::new(parsed(input));
            let source = ChecksSnapshotSource::from_facts(&facts).unwrap();
            let month = source
                .month(seed["period"]["month"].as_str().unwrap())
                .unwrap();
            assert_eq!(month["compliance"]["ok"], true);
            assert_eq!(month["trainingState"]["state"], "UNAVAILABLE");
            assert_eq!(month["trainingState"]["reason"]["code"], code);
            assert_eq!(
                month["trainingState"]["reason"]["source"],
                serde_json::to_value(kind).unwrap()
            );
            if code == "SOURCE_LOADING" {
                assert!(month["training"].is_null());
            } else {
                assert_eq!(month["training"]["trainingComplete"], false);
            }
        }
    }
}

#[test]
fn native_result_cache_retains_owner_and_reuses_month_and_year_results() {
    let data = corpus();
    let case = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "month-p0-h0-plan5-trainingtrue")
        .unwrap();
    let facts = SnapshotFacts::new(parsed(raw(&case["input"])));
    let source = ChecksSnapshotSource::from_facts(&facts).unwrap();
    let month = case["input"]["period"]["month"].as_str().unwrap();
    let first = source.month_shared(month).unwrap();
    drop(facts);
    let second = source.month_shared(month).unwrap();
    assert!(std::sync::Arc::ptr_eq(&first, &second));
    let year = source.year_shared(2026).unwrap();
    assert!(std::sync::Arc::ptr_eq(
        &year,
        &source.year_shared(2026).unwrap()
    ));
    assert!(std::sync::Arc::ptr_eq(
        &first,
        &source.month_shared(month).unwrap()
    ));
    assert_eq!(source.year(1899).unwrap_err().code, "CHECKS_PERIOD_INVALID");
    assert_eq!(source.year(4100).unwrap_err().code, "CHECKS_PERIOD_INVALID");
    assert_eq!(
        source.month("2026-13").unwrap_err().code,
        "CHECKS_PERIOD_INVALID"
    );
}

#[test]
fn saved_own_work_pattern_does_not_acquire_unrelated_global_preference() {
    let data = corpus();
    let case = data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "month-own-pattern-overrides-global")
        .unwrap();
    for state in [
        json!({"state":"NOT_REQUESTED"}),
        json!({"state":"LOADING"}),
        json!({"state":"FAILED","code":"READ_FAILED"}),
    ] {
        let mut input = raw(&case["input"]);
        set(&mut input, SourceKind::WorkPatternSettings, state);
        let facts = SnapshotFacts::new(parsed(input));
        common::assert_json_eq(
            facts.calculation_profile().unwrap().unwrap(),
            &case["profileExpected"],
            "own answers win",
        );
        let source = ChecksSnapshotSource::from_facts(&facts).unwrap();
        common::assert_json_eq(
            &source.month("2026-07").unwrap(),
            &case["expected"],
            "global IO does not overwrite own answers",
        );
    }
}

#[test]
fn every_atomic_catalog_io_state_keeps_catalog_identity() {
    let data = corpus();
    for kind in ["tariff", "legal", "holiday"] {
        for (state, code) in [
            (json!({"state":"NOT_REQUESTED"}), "SOURCE_NOT_REQUESTED"),
            (json!({"state":"LOADING"}), "SOURCE_LOADING"),
            (
                json!({"state":"FAILED","code":"READ_FAILED"}),
                "SOURCE_READ_FAILED",
            ),
            (ready(json!({"kind":"MISSING"})), "SOURCE_MISSING"),
            (ready(json!({"kind":"NULL"})), "SOURCE_NULL"),
        ] {
            let mut input = raw(&data["cases"][0]["input"]);
            input["catalogs"]["current"][kind] = state;
            let facts = SnapshotFacts::new(parsed(input));
            let issue = ChecksSnapshotSource::from_facts(&facts).err().unwrap();
            assert_eq!(issue.code, code);
            assert_eq!(
                serde_json::to_value(issue.catalog).unwrap(),
                json!(kind.to_uppercase())
            );
        }
    }
}
