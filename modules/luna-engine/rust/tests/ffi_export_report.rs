mod common;
#[path = "support/snapshot.rs"]
mod snapshot;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    contract::{self, SourceKind},
    ffi::*,
    input::{
        employment::RawEmploymentHistory, profile_clock::prepare_profile_clock,
        stored_profile::checked_stored_work_profile,
    },
};
use serde_json::{Value, json};
use std::sync::Arc;
fn take(buffer: EngineBuffer) -> Value {
    assert!(!buffer.bytes.is_null());
    // SAFETY: the live native buffer is readable until its matching release.
    let result =
        serde_json::from_slice(unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) })
            .unwrap();
    if buffer.handle != 0 {
        assert!(luna_engine_release_buffer(buffer.handle));
    }
    result
}
fn envelope(command: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":command})).unwrap()
}
fn execute(command: Value) -> Value {
    let bytes = envelope(command);
    take(unsafe { luna_engine_execute(bytes.as_ptr(), bytes.len()) })
}
fn ready(value: Value) -> Value {
    let data = if value.is_null() {
        json!({"kind":"NULL"})
    } else {
        json!({"kind":"VALUE","value":value})
    };
    json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":data}})
}

fn set(raw: &mut Value, kind: SourceKind, value: Value) {
    let kind = serde_json::to_value(kind).unwrap();
    raw["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|g| g["kind"] == kind)
        .unwrap()["source"] = ready(value);
}
fn register(input: &Value, epoch: u64) -> Value {
    let owner = serde_json::to_vec(&json!({"ownerScope":"ffi-export","ownerEpoch":epoch})).unwrap();
    assert_eq!(
        take(unsafe { luna_engine_bind_owner(owner.as_ptr(), owner.len()) })["ok"],
        true
    );
    let mut raw = snapshot::raw_snapshot(1, "ffi-export", epoch);
    let work = &input["profile"];
    let stored = checked_stored_work_profile(
        Arc::new(work["profileRow"].clone()),
        Arc::new(work["salaryRows"].as_array().unwrap().clone()),
    )
    .unwrap();
    let history = RawEmploymentHistory::try_from_rows(Arc::new(
        input["historyRows"].as_array().unwrap().clone(),
    ))
    .unwrap();
    let clock = prepare_profile_clock(
        Some(&stored),
        Some(&history),
        input["epoch"].as_i64().unwrap(),
    )
    .unwrap();
    raw["clockContext"] = json!({"observedEpochMilliseconds":input["epoch"]});
    raw["referenceDate"] = clock.clock_metadata()["referenceDate"].clone();
    for (kind, value) in [
        (SourceKind::WorkProfile, work.clone()),
        (
            SourceKind::RemunerationProfiles,
            input["historyRows"].clone(),
        ),
        (
            SourceKind::WorkPatternSettings,
            input["patternRows"].clone(),
        ),
        (SourceKind::CalendarEntries, input["calendar"].clone()),
        (SourceKind::WorkingTimeTarget, input["targetRow"].clone()),
        (
            SourceKind::YouthPreference,
            input["youthPreference"].clone(),
        ),
        (SourceKind::LegacyTariffDecisions, json!([])),
        (SourceKind::TestMonths, json!([])),
    ] {
        set(&mut raw, kind, value);
    }
    raw["catalogs"]["current"]["selectedPackageIds"] =
        json!({"tariff":["tvoed-vka-bt-k"],"legal":["de-arbzg-care"],"holiday":["de-holidays"]});
    for key in ["tariff", "legal", "holiday"] {
        raw["catalogs"]["current"][key] = ready(json!({"mode":"COMPILED_PREVIEW"}));
    }
    snapshot::seal(&mut raw);
    let parsed = contract::parse_request(&envelope(
        json!({"kind":"REGISTER_SNAPSHOT","snapshot":raw}),
    ))
    .unwrap();
    let contract::ValidatedRequest::RegisterSnapshot(parsed) = parsed else {
        panic!("raw snapshot")
    };
    let facts = luna_engine::runtime::facts::SnapshotFacts::new(parsed);
    assert!(
        facts.work_pattern().is_ok(),
        "pattern: {:?}",
        facts.work_pattern().err()
    );
    assert!(
        facts.tariff_decisions().is_ok(),
        "decisions: {:?}",
        facts.tariff_decisions().err()
    );
    assert!(
        facts.test_months().is_ok(),
        "test months: {:?}",
        facts.test_months().err()
    );
    let source = luna_engine::runtime::export_report::NativeTimeExportSource::from_facts(&facts);
    assert!(source.is_ok(), "native profile source: {:?}", source.err());
    let result = execute(json!({"kind":"REGISTER_SNAPSHOT","snapshot":raw}));
    assert_eq!(result["state"], "REGISTERED", "{result}");
    raw["identity"].clone()
}
#[test]
fn actual_provider_records_and_sql_profiles_cross_the_real_export_finance_writer() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/export-direct-runtime-golden.json"
    ));
    let supplement = value_pool::decode(include_str!(
        "../../reference/export-large-admit-golden.json"
    ));
    let original = fixture["cases"].as_array().unwrap();
    let mut artifacts = Vec::new();
    for (index, case) in original
        .iter()
        .chain(supplement["cases"].as_array().unwrap())
        .enumerate()
    {
        let identity = register(&case["raw"], index as u64 + 1);
        let request_input = &case["request"];
        let period = if request_input["period"].as_str().unwrap().len() == 4 {
            json!({"kind":"YEAR","year":2026})
        } else {
            json!({"kind":"MONTH","month":request_input["period"]})
        };
        let mut intent = request_input.clone();
        intent.as_object_mut().unwrap().remove("period");
        let request = json!({"guard":{"snapshot":identity,"requestId":format!("export-{index}"),"requestRevision":1},"periods":[period],"sections":{"time":false,"gross":false,"net":false,"checks":false},"perspective":"PAYOUT","priority":"INTERACTIVE","exportReport":intent});
        let bytes = envelope(json!({"kind":"CALCULATE","request":request}));
        if index >= original.len() {
            assert!(
                bytes.len() > 8192,
                "The genuine original long-note request must cross the old C cap"
            );
            let mut ordinary = request.clone();
            ordinary.as_object_mut().unwrap().remove("exportReport");
            ordinary["sections"]["gross"] = json!(true);
            let mut oversized = envelope(json!({"kind":"CALCULATE","request":ordinary}));
            oversized.extend(std::iter::repeat_n(b' ', 8193));
            // SAFETY: valid ordinary request plus whitespace remains readable;
            // its original 8KiB cap remains closed on the Finance lane.
            assert_eq!(
                take(unsafe { luna_engine_admit(oversized.as_ptr(), oversized.len(), 0) })["code"],
                "INPUT_TOO_LARGE"
            );
        }
        assert_eq!(
            take(unsafe { luna_engine_admit(bytes.as_ptr(), bytes.len(), 1) })["ok"],
            false,
            "Checks must not run export"
        );
        let admitted = take(unsafe { luna_engine_admit(bytes.as_ptr(), bytes.len(), 0) });
        assert_eq!(admitted["state"], "QUEUED", "{admitted}");
        let completed = take(luna_engine_run_next(0));
        assert_eq!(completed["state"], "COMPLETED", "{completed}");
        let report = &completed["result"]["reports"][0];
        for key in ["time", "gross", "net", "checks"] {
            assert_eq!(report["sections"][key]["state"], "NOT_REQUESTED");
        }
        assert!(
            report["views"]
                .as_object()
                .unwrap()
                .values()
                .all(|v| v["state"] == "NOT_REQUESTED")
        );
        let output = &report["sections"]["exportReport"];
        assert_eq!(output["state"], "READY", "{}: {output}", case["id"]);
        let echo = &completed["result"]["request"]["exportReport"];
        assert_eq!(echo.as_object().unwrap().len(), 5);
        for key in ["records", "ranks", "netSettingsRows", "salaryPreferenceRow"] {
            assert!(echo.get(key).is_none());
        }
        if output["value"]["format"] == "CSV" {
            common::assert_json_eq(
                &output["value"]["text"],
                &case["expectedCsv"],
                case["id"].as_str().unwrap(),
            );
        }
        if index < original.len() {
            artifacts.push(
            json!({"id":case["id"],"artifact":output["value"],"expectedHtml":case["expectedHtml"]}),
        );
        }
    }
    if let Ok(path) = std::env::var("LUNA_EXPORT_RUNTIME_DUMP") {
        std::fs::write(path,serde_json::to_vec(&json!({"schemaVersion":1,"engineVersion":luna_engine::ENGINE_VERSION,"cases":artifacts})).unwrap()).unwrap();
    }
    take(luna_engine_reset());
}
