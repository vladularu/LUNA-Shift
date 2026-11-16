use luna_engine::tax::{Decimal, Pap2026Input, calculate_pap_2026};
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Golden {
    xml_sha256: String,
    outputs: Vec<String>,
    cases: Vec<Case>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    id: String,
    input: Pap2026Input,
    expected: BTreeMap<String, String>,
    official_frozen_reference: bool,
}

#[test]
fn all_raw_pap_outputs_match_frozen_ts_and_offline_bmf_cases() {
    let golden: Golden = serde_json::from_str(include_str!("../../reference/pap-2026-golden.json"))
        .expect("frozen local fixture");
    assert_eq!(
        golden.xml_sha256,
        "63d8981646d139eba2f4dd990c13b43c4fb3883b402a5a40cddf253aa7aa96b4"
    );
    assert_eq!(golden.outputs.len(), 12);
    assert_eq!(golden.cases.len(), 581);
    assert_eq!(
        golden
            .cases
            .iter()
            .filter(|c| c.official_frozen_reference)
            .count(),
        38
    );
    for case in golden.cases {
        let output = calculate_pap_2026(case.input).expect(&case.id);
        let actual = serde_json::to_value(output).expect("PAP JSON output");
        let actual = actual.as_object().expect("PAP output object");
        assert_eq!(actual.len(), case.expected.len(), "{}", case.id);
        for (field, expected) in case.expected {
            let actual = actual
                .get(&field)
                .and_then(|v| v.as_str())
                .expect("exact decimal text");
            assert_eq!(
                Decimal::parse(actual).expect("actual decimal"),
                Decimal::parse(&expected).expect("expected decimal"),
                "{} / {}",
                case.id,
                field
            );
        }
    }
}
