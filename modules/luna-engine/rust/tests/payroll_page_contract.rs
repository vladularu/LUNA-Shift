use luna_engine::contract::{self, CalculationRequest, ValidatedRequest};
use serde_json::{Value, json};
fn request() -> Value {
    json!({"guard":{"snapshot":{"ownerScope":"payroll-owner","ownerEpoch":1,"snapshotId":"snapshot","snapshotRevision":1,"inputDigest":"a".repeat(64),"catalogDigest":"b".repeat(64)},"requestId":"payroll","requestRevision":1},"periods":[{"kind":"MONTH","month":"2026-07"}],"sections":{"time":false,"gross":false,"net":false,"checks":false},"perspective":"PAYOUT","priority":"INTERACTIVE","payrollPage":true})
}
fn parse(value: Value) -> Result<CalculationRequest, contract::ContractError> {
    let input = json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"CALCULATE","request":value}});
    match contract::parse_request(&serde_json::to_vec(&input).unwrap())? {
        ValidatedRequest::Calculate(r) => Ok(*r),
        _ => panic!("request"),
    }
}
#[test]
fn explicit_payroll_page_is_a_small_exclusive_one_month_finance_view() {
    let raw = request();
    let parsed = parse(raw.clone()).expect("native payroll view intent");
    assert_eq!(serde_json::to_value(parsed).unwrap(), raw);
}
#[test]
fn absent_intent_keeps_old_request_bytes_and_malformed_intent_never_becomes_false() {
    let mut old = request();
    old.as_object_mut().unwrap().remove("payrollPage");
    old["sections"]["gross"] = json!(true);
    assert_eq!(
        serde_json::to_string(&parse(old.clone()).unwrap()).unwrap(),
        serde_json::to_string(&old).unwrap()
    );
    for mutation in 0..15 {
        let mut raw = request();
        match mutation {
            0 => raw["payrollPage"] = Value::Null,
            1 => raw["payrollPage"] = json!(false),
            2 => raw["payrollPage"] = json!(1),
            3 => raw["payrollPage"] = json!("true"),
            4 => raw["payrollPage"] = json!({"ready":true}),
            5 => raw["perspective"] = json!("EARNED"),
            6 => raw["periods"] = json!([{"kind":"YEAR","year":2026}]),
            7 => raw["periods"]
                .as_array_mut()
                .unwrap()
                .push(json!({"kind":"MONTH","month":"2026-08"})),
            8 => raw["sections"]["time"] = json!(true),
            9 => raw["sections"]["gross"] = json!(true),
            10 => raw["sections"]["net"] = json!(true),
            11 => raw["sections"]["checks"] = json!(true),
            12 => {
                raw["financialDetails"] = json!({"filter":null,"includeSpecialDutyPay":false,"collation":{"token":1,"digest":"c".repeat(64),"localeKey":"de-DE"}})
            }
            13 => raw["payrollPage"] = json!([]),
            _ => raw["periods"] = json!([]),
        };
        assert!(parse(raw).is_err(), "mutation {mutation}");
    }
    let mut duplicate = serde_json::to_string(&request()).unwrap();
    duplicate.pop();
    duplicate.push_str(",\"payrollPage\":true}");
    let command = format!(
        "{{\"wireSchemaVersion\":1,\"expectedEngineVersion\":\"{}\",\"calculationContractVersion\":\"{}\",\"command\":{{\"kind\":\"CALCULATE\",\"request\":{duplicate}}}}}",
        luna_engine::ENGINE_VERSION,
        contract::CONTRACT_VERSION
    );
    assert!(contract::parse_request(command.as_bytes()).is_err());
}
