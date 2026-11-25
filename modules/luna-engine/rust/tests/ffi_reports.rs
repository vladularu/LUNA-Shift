//! Actual C admission/worker/buffer path, with independently frozen SQL outputs.
mod common;
#[path = "support/snapshot.rs"]
mod snapshot;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    contract::{self, SourceKind},
    ffi::*,
};
use serde_json::{Value, json};
fn take(buffer: EngineBuffer) -> Value {
    assert!(!buffer.bytes.is_null());
    // SAFETY: the live C descriptor owns these bytes until release below.
    let value =
        serde_json::from_slice(unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) })
            .unwrap();
    if buffer.handle != 0 {
        assert!(luna_engine_release_buffer(buffer.handle));
    }
    value
}
fn envelope(command: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":command})).unwrap()
}
fn execute(command: Value) -> Value {
    let bytes = envelope(command);
    // SAFETY: the immutable vector remains readable for this call.
    take(unsafe { luna_engine_execute(bytes.as_ptr(), bytes.len()) })
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
        .find(|group| group["kind"] == kind)
        .unwrap()["source"] = state;
}
#[test]
fn original_raw_sql_gross_and_net_cross_the_real_c_scheduler_and_owned_buffers() {
    let golden = value_pool::decode(include_str!(
        "../../reference/financial-snapshot-report-golden.json"
    ));
    let cases = golden["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 54);
    let mut summaries = 0;
    for (index, case) in cases.iter().enumerate() {
        let epoch = index as u64 + 1;
        let binding =
            serde_json::to_vec(&json!({"ownerScope":"ffi-raw-finance","ownerEpoch":epoch}))
                .unwrap();
        // SAFETY: binding is readable for this synchronous C entrypoint.
        assert_eq!(
            take(unsafe { luna_engine_bind_owner(binding.as_ptr(), binding.len()) })["ok"],
            true
        );
        let input = &case["input"];
        let mut raw = snapshot::raw_snapshot(1, "ffi-raw-finance", epoch);
        set(
            &mut raw,
            SourceKind::WorkProfile,
            ready(input["work"].clone()),
        );
        set(
            &mut raw,
            SourceKind::CalendarEntries,
            ready(
                json!({"shiftRows":input["shiftRows"],"appointmentRows":input["appointmentRows"],"platformCollationRanks":input["platformCollationRanks"]}),
            ),
        );
        for kind in [
            SourceKind::RemunerationProfiles,
            SourceKind::WorkPatternSettings,
            SourceKind::LegacyTariffDecisions,
            SourceKind::TestMonths,
            SourceKind::ActualAnnualPayments,
            SourceKind::TariffAnnualClaims,
        ] {
            set(&mut raw, kind, ready(json!([])));
        }
        let timeline=input["timeline"].as_array().unwrap().iter().map(|saved|json!({"month":saved["settings"]["month"],"settings_json":serde_json::to_string(&saved["settings"]).unwrap(),"revision":saved["revision"],"created_at":saved["createdAt"],"updated_at":saved["updatedAt"]})).collect::<Vec<_>>();
        set(
            &mut raw,
            SourceKind::NetPaySettingsTimeline,
            ready(json!(timeline)),
        );
        set(
            &mut raw,
            SourceKind::SalaryPaymentPreferences,
            ready(json!({"value":serde_json::to_string(&input["preferences"]).unwrap()})),
        );
        raw["catalogs"]["current"]["selectedPackageIds"] = json!({"tariff":["tvoed-vka-bt-k"],"legal":["de-arbzg-care"],"holiday":["de-holidays"]});
        for kind in ["tariff", "legal", "holiday"] {
            raw["catalogs"]["current"][kind] = ready(json!({"mode":"COMPILED_PREVIEW"}));
        }
        snapshot::seal(&mut raw);
        assert_eq!(
            execute(json!({"kind":"REGISTER_SNAPSHOT","snapshot":raw}))["state"],
            "REGISTERED"
        );
        let request = json!({"guard":{"snapshot":raw["identity"],"requestId":format!("ffi-case-{index}"),"requestRevision":1},"periods":[case["period"]],"sections":{"time":false,"gross":true,"net":true,"checks":false},"perspective":case["perspective"],"priority":"INTERACTIVE"});
        assert_eq!(
            execute(json!({"kind":"CALCULATE","request":request}))["code"],
            "QUEUED_CALCULATION_REQUIRED"
        );
        let bytes = envelope(json!({"kind":"CALCULATE","request":request}));
        // SAFETY: the request vector remains readable for admission.
        let admitted = take(unsafe { luna_engine_admit(bytes.as_ptr(), bytes.len(), 0) });
        assert_eq!(admitted["state"], "QUEUED", "{admitted}");
        let result = take(luna_engine_run_next(0));
        assert_eq!(result["state"], "COMPLETED", "{result}");
        assert_eq!(result["jobId"], admitted["jobId"]);
        assert_eq!(result["result"]["request"], request);
        assert_eq!(
            result["result"]["engineVersion"],
            luna_engine::ENGINE_VERSION
        );
        let sections = &result["result"]["reports"][0]["sections"];
        assert_eq!(
            sections["gross"]["state"], "READY",
            "{}: {sections}",
            case["id"]
        );
        assert_eq!(
            sections["net"]["state"], "READY",
            "{}: {sections}",
            case["id"]
        );
        assert_eq!(sections["time"]["state"], "NOT_REQUESTED");
        assert_eq!(sections["checks"]["state"], "NOT_REQUESTED");
        common::assert_json_eq(
            &sections["gross"]["value"]["legacy"]["value"],
            &case["expected"]["legacy"]["value"],
            case["id"].as_str().unwrap(),
        );
        common::assert_json_eq(
            &sections["net"]["value"],
            &case["expected"]["net"]["value"],
            case["id"].as_str().unwrap(),
        );
        if case["period"]["kind"] == "YEAR" && case["perspective"] == "EARNED" {
            let mut summary = request.clone();
            summary["guard"]["requestId"] = json!(format!("ffi-summary-{index}"));
            summary["guard"]["requestRevision"] = json!(2);
            summary["sections"]["net"] = json!(false);
            summary["annualGrossSummary"] = json!(true);

            let mut invalid = summary.clone();
            invalid["sections"]["net"] = json!(true);
            assert!(
                contract::parse_request(&envelope(json!({"kind":"CALCULATE","request":invalid})))
                    .is_err()
            );

            let bytes = envelope(json!({"kind":"CALCULATE","request":summary}));
            // SAFETY: the serialized request remains readable during synchronous admission.
            let admitted = take(unsafe { luna_engine_admit(bytes.as_ptr(), bytes.len(), 0) });
            assert_eq!(admitted["state"], "QUEUED", "{admitted}");
            let buffer = luna_engine_run_next(0);
            let size = buffer.length;
            let result = take(buffer);
            assert_eq!(result["state"], "COMPLETED", "{result}");
            assert!(size < 8192, "annual summary was {size} bytes");
            let report = &result["result"]["reports"][0];
            assert_eq!(report["views"]["gross"]["state"], "NOT_REQUESTED");
            let gross = &report["sections"]["gross"]["value"];
            assert_eq!(gross.as_object().unwrap().len(), 1);
            common::assert_json_eq(
                &gross["legacy"]["value"],
                &case["expected"]["legacy"]["value"],
                case["id"].as_str().unwrap(),
            );
            summaries += 1;
        }
        assert_eq!(take(luna_engine_run_next(0))["state"], "IDLE");
    }
    assert!(summaries > 0);
    assert_eq!(take(luna_engine_reset())["ok"], true);
    assert_eq!(take(luna_engine_collect_retired())["ok"], true);
}
