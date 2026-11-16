use luna_engine::contract::{self, ValidatedRequest};
use serde_json::{Value, json};
fn request() -> Value {
    json!({"guard":{"snapshot":{"ownerScope":"details-owner","ownerEpoch":1,"snapshotId":"snapshot","snapshotRevision":1,"inputDigest":"a".repeat(64),"catalogDigest":"b".repeat(64)},"requestId":"salary","requestRevision":1},"periods":[{"kind":"MONTH","month":"2026-07"}],"sections":{"time":false,"gross":false,"net":false,"checks":false},"perspective":"EARNED","priority":"INTERACTIVE","financialDetails":{"filter":null,"includeSpecialDutyPay":false,"collation":{"token":1,"digest":"c".repeat(64),"localeKey":"de-DE"}}})
}
fn parse(
    request: Value,
) -> Result<luna_engine::contract::CalculationRequest, contract::ContractError> {
    let input = json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":{"kind":"CALCULATE","request":request}});
    match contract::parse_request(&serde_json::to_vec(&input).unwrap())? {
        ValidatedRequest::Calculate(r) => Ok(*r),
        _ => panic!("request"),
    }
}
#[test]
fn explicit_financial_details_accept_one_month_with_only_small_native_locators() {
    let raw = request();
    let parsed = parse(raw.clone()).expect("explicit details request");
    assert_eq!(serde_json::to_value(parsed).unwrap(), raw);
}
#[test]
fn old_requests_serialize_exactly_and_details_reject_years_checks_or_ready_payloads() {
    let mut old = request();
    old.as_object_mut().unwrap().remove("financialDetails");
    old["sections"]["gross"] = json!(true);
    assert_eq!(
        serde_json::to_string(&parse(old.clone()).unwrap()).unwrap(),
        serde_json::to_string(&old).unwrap()
    );
    for mutation in 0..9 {
        let mut raw = request();
        match mutation {
            0 => raw["periods"] = json!([{"kind":"YEAR","year":2026}]),
            1 => raw["periods"]
                .as_array_mut()
                .unwrap()
                .push(json!({"kind":"MONTH","month":"2026-08"})),
            2 => raw["sections"]["checks"] = json!(true),
            3 => {
                raw["financialDetails"]
                    .as_object_mut()
                    .unwrap()
                    .remove("filter");
            }
            4 => raw["financialDetails"]["collation"]["ready"] = json!(true),
            5 => raw["financialDetails"]["collation"]["token"] = json!(0),
            6 => raw["financialDetails"]["filter"] = json!("x".repeat(129)),
            7 => raw["financialDetails"]["collation"]["ranks"] = json!({}),
            _ => raw["financialDetails"] = Value::Null,
        };
        assert!(parse(raw).is_err(), "mutation {mutation}");
    }
}
