use bigdecimal::BigDecimal;
use luna_engine::{
    calendar::recurrence::CollationRanks,
    compliance::{
        adult,
        model::{self, ComplianceError},
        planning_series, policy, preparation, split,
    },
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, str::FromStr};
fn same_value(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            BigDecimal::from_str(&a.to_string()).unwrap()
                == BigDecimal::from_str(&b.to_string()).unwrap()
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same_value(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(key, value)| b.get(key).is_some_and(|b| same_value(value, b)))
        }
        _ => a == b,
    }
}
fn run(c: &Value, resolver: &RuleResolver) -> Result<Value, ComplianceError> {
    let i = &c["input"];
    let shifts = i["shifts"].as_array().unwrap();
    let ranks: CollationRanks = serde_json::from_value(i["collationRanks"].clone()).unwrap();
    let prepared = preparation::prepare_calendar(
        i["month"].as_str().unwrap(),
        shifts,
        i["timeZone"].as_str().unwrap(),
        &i["options"],
        "2026-07-15",
        resolver,
        &ranks,
    )?;
    let rules = prepared.legal_package.rules();
    let version = i
        .get("contractVersion")
        .and_then(Value::as_u64)
        .map(|version| u32::try_from(version).unwrap())
        .unwrap_or(prepared.legal_package.engine_contract_version);
    match c["operation"].as_str().unwrap() {
        "compliance.checkDuplicates" => {
            adult::check_duplicates(&prepared.intervals).map(Value::Array)
        }
        "compliance.checkOverlaps" => adult::check_overlaps(&prepared.intervals).map(Value::Array),
        "compliance.checkWorkingTime" => {
            let night = model::qualify_as_night_worker(
                &prepared.intervals,
                rules,
                version,
                prepared.first.year(),
                &i["options"],
            )?;
            let check = split::SplitDutyBreakCheck::new(shifts)?;
            adult::check_working_time(&prepared.intervals, rules, version, night, &check)
                .map(Value::Array)
        }
        "compliance.checkRestAndSequence" => adult::check_rest_and_sequence(
            &prepared.intervals,
            prepared.reference_date,
            rules,
            i["options"]
                .get("sectorId")
                .and_then(Value::as_str)
                .unwrap_or("care"),
        )
        .map(Value::Array),
        "compliance.checkPlanningSeries" => planning_series::check_planning_series(
            &prepared.intervals,
            rules,
            i["includeLegacyNightSeries"].as_bool().unwrap(),
        )
        .map(Value::Array),
        "compliance.qualifyNightWorker" => model::qualify_as_night_worker(
            &prepared.intervals,
            rules,
            version,
            prepared.first.year(),
            &i["options"],
        )
        .map(Value::Bool),
        operation => panic!("Unknown operation {operation}"),
    }
}
#[test]
fn all_adult_local_findings_and_night_qualification_match_frozen_private_helpers() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../reference/compliance-adult-golden.json")).unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    assert_eq!(
        fixture["oracle"]["sourceSha256"],
        "26f49b6e37fd1e780c424c4860690b7c321eedf973833ffa9ece234693c8f95c"
    );
    assert_eq!(fixture["oracle"]["typescriptVersion"], "6.0.3");
    assert_eq!(
        fixture["guidance"]["work"]["firstWorkSeriesHint"],
        policy::FIRST_WORK_SERIES_HINT
    );
    assert_eq!(
        fixture["guidance"]["night"]["firstNightHint"],
        policy::FIRST_NIGHT_HINT
    );
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 686);
    let mut resolvers = BTreeMap::new();
    for catalog in fixture["catalogs"].as_array().unwrap() {
        let id = catalog["id"].as_str().unwrap();
        let resolver = if id == "bundled" {
            RuleResolver::bundled().unwrap()
        } else {
            RuleResolver::from_catalog_json(
                catalog["packages"].clone(),
                serde_json::from_value(catalog["selections"].clone()).unwrap(),
                None,
            )
            .unwrap()
        };
        resolvers.insert(id, resolver);
    }
    for case in cases {
        let resolver = resolvers
            .get(case["input"]["catalogRef"].as_str().unwrap())
            .unwrap();
        let actual = match run(case, resolver) {
            Ok(value) => value,
            Err(error) => {
                json!({"$error":{"name":error.source_error_name(),"message":error.to_string()}})
            }
        };
        assert!(
            same_value(&actual, &case["expected"]),
            "{}\nactual {actual}\nexpected {}",
            case["id"],
            case["expected"]
        );
    }
}
