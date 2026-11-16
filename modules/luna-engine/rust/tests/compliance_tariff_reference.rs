use luna_engine::compliance::{
    model::ComplianceError,
    tariff::{self, context, work_dates},
};
use serde_json::{Value, json};
fn run(c: &Value) -> Result<Value, ComplianceError> {
    let i = &c["input"];
    match c["operation"].as_str().unwrap() {
        "compliance.tariffContext" => {
            let p: Value = serde_json::from_str(i["profileJson"].as_str().unwrap()).unwrap();
            Ok(context::tariff_context_at(&p, i["date"].as_str().unwrap())?
                .map(|c| c.to_json())
                .unwrap_or(Value::Null))
        }
        "compliance.tariffWorkingTime" => {
            let mut o = i["options"].clone();
            if let Some(s) = i["profileJson"].as_str() {
                o["employmentProfile"] = serde_json::from_str(s).unwrap();
            }
            tariff::check_tariff_working_time(
                i["month"].as_str().unwrap(),
                i["shifts"].as_array().unwrap(),
                i["timeZone"].as_str().unwrap(),
                &o,
                "2026-09-20",
            )
            .map(Value::Array)
        }
        "compliance.recordedWorkDates" => Ok(json!(work_dates::recorded_work_dates(
            &i["shift"],
            i["timeZone"].as_str().unwrap()
        ))),
        "compliance.salaryBasisCount" => Ok(json!(context::salary_basis_count_value(i))),
        op => panic!("Unknown {op}"),
    }
}
#[test]
fn tariff_scope_context_recorded_dates_and_full_month_findings_match_frozen_source() {
    let g: Value = serde_json::from_str(include_str!(
        "../../reference/compliance-tariff-golden.json"
    ))
    .unwrap();
    assert_eq!(
        g["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = g["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 444);
    for c in cases {
        let actual = match run(c) {
            Ok(v) => v,
            Err(e) => json!({"$error":{"name":e.source_error_name(),"message":e.to_string()}}),
        };
        assert_eq!(actual, c["expected"], "{}", c["id"]);
    }
}
