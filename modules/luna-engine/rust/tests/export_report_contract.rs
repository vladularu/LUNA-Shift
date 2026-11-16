use luna_engine::contract::{self, CalculationRequest, ValidatedRequest};
use serde_json::{Value, json};
fn request() -> Value {
    json!({"guard":{"snapshot":{"ownerScope":"export-owner","ownerEpoch":1,"snapshotId":"snapshot","snapshotRevision":1,"inputDigest":"a".repeat(64),"catalogDigest":"b".repeat(64)},"requestId":"export","requestRevision":1},"periods":[{"kind":"MONTH","month":"2026-07"}],"sections":{"time":false,"gross":false,"net":false,"checks":false},"perspective":"PAYOUT","priority":"INTERACTIVE","exportReport":{"format":"PDF","layout":"standard","includeSalary":true,"profileRole":"CALCULATION","observedEpochMilliseconds":1793552400000i64,"records":{"kind":"RECORDED_ENTRIES","entries":[]},"ranks":{},"netSettingsRows":[],"salaryPreferenceRow":null}})
}
fn parse(raw: Value) -> Result<CalculationRequest, contract::ContractError> {
    match contract::parse_request(&serde_json::to_vec(&json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"CALCULATE","request":raw}})).unwrap())?{ValidatedRequest::Calculate(r) => Ok(*r),_=>panic!("calculation")}
}
#[test]
fn exclusive_month_or_year_artifacts_roundtrip_and_share_their_raw_records_on_clone() {
    for period in [
        json!({"kind":"MONTH","month":"2026-07"}),
        json!({"kind":"YEAR","year":2026}),
    ] {
        for format in ["PDF", "CSV"] {
            let mut raw = request();
            raw["periods"] = json!([period]);
            raw["exportReport"]["format"] = json!(format);
            let parsed = parse(raw.clone()).unwrap();
            assert_eq!(serde_json::to_value(&parsed).unwrap(), raw);
            let copy = parsed.clone();
            assert!(std::sync::Arc::ptr_eq(
                parsed.export_report().unwrap().entries(),
                copy.export_report().unwrap().entries()
            ));
        }
    }
    let mut old = request();
    old.as_object_mut().unwrap().remove("exportReport");
    old["sections"]["gross"] = json!(true);
    assert_eq!(
        serde_json::to_string(&parse(old.clone()).unwrap()).unwrap(),
        serde_json::to_string(&old).unwrap()
    );
}
#[test]
fn malformed_or_mixed_exports_never_start_unrequested_standard_work() {
    for mutation in 0..19 {
        let mut raw = request();
        match mutation {
            0 => raw["exportReport"] = Value::Null,
            1 => raw["exportReport"]["ready"] = json!(true),
            2 => raw["exportReport"]["records"]["profile"] = json!({"ready":true}),
            3 => raw["exportReport"]["records"]["entries"] = json!(0),
            4 => raw["exportReport"]["format"] = json!("HTML"),
            5 => raw["exportReport"]["layout"] = json!("STANDARD"),
            6 => raw["exportReport"]["profileRole"] = json!("READY"),
            7 => raw["exportReport"]["observedEpochMilliseconds"] = json!(8_640_000_000_000_001i64),
            8 => raw["exportReport"]["ranks"] = json!({"a":-1}),
            9 => raw["sections"]["time"] = json!(true),
            10 => raw["sections"]["gross"] = json!(true),
            11 => raw["sections"]["net"] = json!(true),
            12 => raw["sections"]["checks"] = json!(true),
            13 => raw["perspective"] = json!("EARNED"),
            14 => raw["payrollPage"] = json!(true),
            15 => raw["payrollPanel"] = json!("BASIS"),
            16 => raw["periods"]
                .as_array_mut()
                .unwrap()
                .push(json!({"kind":"YEAR","year":2027})),
            17 => raw["exportReport"]["records"]["entries"] = json!(vec![json!({}); 50_001]),
            _ => {
                raw["exportReport"].as_object_mut().unwrap().remove("ranks");
            }
        };
        assert!(parse(raw).is_err(), "mutation {mutation}");
    }
}
