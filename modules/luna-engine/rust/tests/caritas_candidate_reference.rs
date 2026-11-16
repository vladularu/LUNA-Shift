mod common;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    remuneration::{
        caritas::{
            candidate::{self, AnnualClaims, CandidateSnapshot},
            overtime_payout::{self, OvertimePayoutInput},
        },
        context::model::FullNativePackageValidator,
        tariff_annual::saved::validate_saved_tariff_annual_claims,
    },
    rules::RuleResolver,
};
use serde_json::{Value, json};
fn array<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value[key].as_array().unwrap().as_slice()
}
#[test]
fn caritas_complete_overtime_and_snapshot_candidates_match_original() {
    let data = value_pool::decode(include_str!(
        "../../reference/caritas-candidate-golden.json"
    ));
    let bundled = RuleResolver::bundled().unwrap();
    let full = RuleResolver::new(
        serde_json::from_value(data["resolverData"]["catalog"].clone()).unwrap(),
        serde_json::from_value(data["resolverData"]["packageIds"].clone()).unwrap(),
        Some(serde_json::from_value(data["resolverData"]["historical"].clone()).unwrap()),
    )
    .unwrap();
    let empty = RuleResolver::new(
        serde_json::from_value(json!({"tariff":[],"legal":[],"holiday":[]})).unwrap(),
        bundled.default_package_ids().clone(),
        None,
    )
    .unwrap();
    let preview = RuleResolver::new(
        serde_json::from_value(data["previewCatalog"].clone()).unwrap(),
        serde_json::from_value(data["resolverData"]["packageIds"].clone()).unwrap(),
        Some(serde_json::from_value(data["resolverData"]["historical"].clone()).unwrap()),
    )
    .unwrap();
    let cases = data["cases"].as_array().unwrap();
    let equal_custom = RuleResolver::new(
        serde_json::from_value(data["previewCatalog"].clone()).unwrap(),
        serde_json::from_value(data["resolverData"]["packageIds"].clone()).unwrap(),
        Some(serde_json::from_value(data["resolverData"]["historical"].clone()).unwrap()),
    )
    .unwrap();
    assert_eq!(cases.len(), 1143);
    for case in cases {
        let input = &case["input"];
        let resolver = match input["resolverRef"].as_str() {
            Some("empty") => &empty,
            Some("preview") => &preview,
            Some("equalCustom") => &equal_custom,
            Some("bundled") => &bundled,
            _ => &full,
        };
        let result = if case["operation"] == "overtime" {
            overtime_payout::calculate(
                &OvertimePayoutInput {
                    month: input["month"].as_str().unwrap(),
                    time_zone: input["timeZone"].as_str().unwrap(),
                    history_complete: input["historyComplete"].as_bool().unwrap(),
                    shifts: array(input, "shifts"),
                    allocations: array(input, "allocations"),
                    confirmations: array(input, "confirmations"),
                    profiles: array(input, "profiles"),
                },
                resolver,
                &FullNativePackageValidator,
            )
            .map_err(candidate::CandidateError::from)
        } else {
            let s = &input["snapshot"];
            candidate::calculate(
                &CandidateSnapshot {
                    profile: s.get("profile").filter(|v| !v.is_null()),
                    shifts: array(s, "shifts"),
                    pause_details: array(s, "pauseDetails"),
                    remuneration_profiles: array(s, "remunerationProfiles"),
                    allowance_decisions: array(s, "allowanceDecisions"),
                    overtime_allocations: array(s, "overtimeAllocations"),
                    overtime_confirmations: array(s, "overtimeConfirmations"),
                    month_facts: array(s, "monthFacts"),
                    work_day_confirmations: array(s, "workDayConfirmations"),
                    annual_claims: AnnualClaims::Raw(&s["tariffAnnualClaims"]),
                    entries_complete: s["entriesComplete"].as_bool().unwrap(),
                    history_complete: s["historyComplete"].as_bool().unwrap(),
                },
                input["month"].as_str().unwrap(),
                resolver,
                &FullNativePackageValidator,
            )
        };
        let actual = match result {
            Ok(v) => json!({"value":v}),
            Err(e) => json!({"$error":e.to_string(),"name":e.name()}),
        };
        common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
        if case["operation"] == "candidate" {
            let s = &input["snapshot"];
            if let Ok(claims) = validate_saved_tariff_annual_claims(&s["tariffAnnualClaims"]) {
                let checked = candidate::calculate(
                    &CandidateSnapshot {
                        profile: s.get("profile").filter(|v| !v.is_null()),
                        shifts: array(s, "shifts"),
                        pause_details: array(s, "pauseDetails"),
                        remuneration_profiles: array(s, "remunerationProfiles"),
                        allowance_decisions: array(s, "allowanceDecisions"),
                        overtime_allocations: array(s, "overtimeAllocations"),
                        overtime_confirmations: array(s, "overtimeConfirmations"),
                        month_facts: array(s, "monthFacts"),
                        work_day_confirmations: array(s, "workDayConfirmations"),
                        annual_claims: AnnualClaims::Checked(&claims),
                        entries_complete: s["entriesComplete"].as_bool().unwrap(),
                        history_complete: s["historyComplete"].as_bool().unwrap(),
                    },
                    input["month"].as_str().unwrap(),
                    resolver,
                    &FullNativePackageValidator,
                );
                let actual = match checked {
                    Ok(v) => json!({"value":v}),
                    Err(e) => json!({"$error":e.to_string(),"name":e.name()}),
                };
                common::assert_json_eq(&actual, &case["expected"], case["id"].as_str().unwrap());
            }
        }
    }
}
