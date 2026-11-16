use luna_engine::contract::{self, CalculationRequest, ValidatedRequest};
use serde_json::{Value, json};
fn request(panel: &str) -> Value {
    json!({"guard":{"snapshot":{"ownerScope":"panel-owner","ownerEpoch":1,"snapshotId":"snapshot","snapshotRevision":1,"inputDigest":"a".repeat(64),"catalogDigest":"b".repeat(64)},"requestId":"payroll-panel","requestRevision":1},"periods":[{"kind":"MONTH","month":"2026-07"}],"sections":{"time":false,"gross":false,"net":false,"checks":false},"perspective":"PAYOUT","priority":"INTERACTIVE","payrollPanel":panel})
}
fn parse(raw: Value) -> Result<CalculationRequest, contract::ContractError> {
    match contract::parse_request(&serde_json::to_vec(&json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"CALCULATE","request":raw}})).unwrap())?{ValidatedRequest::Calculate(r) => Ok(*r),_=>panic!("expected calculation")}
}
#[test]
fn panels_are_closed_exclusive_single_month_payout_intents() {
    for panel in ["COMPONENTS", "BASIS", "SPECIAL_DUTIES", "TARIFF_ASSESSMENT"] {
        let raw = request(panel);
        assert_eq!(
            serde_json::to_value(parse(raw.clone()).expect("native panel intent")).unwrap(),
            raw
        )
    }
}
#[test]
fn malformed_panel_intents_never_become_a_default_view() {
    for mutation in 0..18 {
        let mut raw = request("COMPONENTS");
        match mutation {
            0 => raw["payrollPanel"] = Value::Null,
            1 => raw["payrollPanel"] = json!(false),
            2 => raw["payrollPanel"] = json!(1),
            3 => raw["payrollPanel"] = json!("components"),
            4 => raw["payrollPanel"] = json!({"kind":"BASIS","ready":true}),
            5 => raw["payrollPage"] = json!(true),
            6 => raw["sections"]["time"] = json!(true),
            7 => raw["sections"]["gross"] = json!(true),
            8 => raw["sections"]["net"] = json!(true),
            9 => raw["sections"]["checks"] = json!(true),
            10 => raw["perspective"] = json!("EARNED"),
            11 => raw["periods"] = json!([{"kind":"YEAR","year":2026}]),
            12 => raw["periods"]
                .as_array_mut()
                .unwrap()
                .push(json!({"kind":"MONTH","month":"2026-08"})),
            13 => raw["periods"] = json!([]),
            14 => {
                raw["financialDetails"] = json!({"filter":null,"includeSpecialDutyPay":false,"collation":{"token":1,"digest":"c".repeat(64),"localeKey":"de-DE"}})
            }
            15 => raw["payrollPanel"] = json!("SALARY"),
            16 => raw["payrollPanel"] = json!([]),
            _ => {
                raw.as_object_mut().unwrap().remove("payrollPanel");
            }
        };
        assert!(parse(raw).is_err(), "mutation {mutation}")
    }
}
#[test]
fn absent_intent_preserves_old_standard_request_bytes() {
    let mut old = request("BASIS");
    old.as_object_mut().unwrap().remove("payrollPanel");
    old["sections"]["gross"] = json!(true);
    assert_eq!(
        serde_json::to_string(&parse(old.clone()).unwrap()).unwrap(),
        serde_json::to_string(&old).unwrap()
    );
}
