use bigdecimal::BigDecimal;
use luna_engine::{
    calendar::recurrence::CollationRanks,
    compliance::{
        evidence, issue,
        model::{self, ComplianceError},
        preparation, result, sequences, split, window,
    },
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, str::FromStr, sync::Arc};
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
    if c["operation"] == "compliance.germanQuantity" {
        return issue::german_quantity(
            i["value"].as_f64().unwrap(),
            i["capitalize"].as_bool().unwrap(),
        )
        .map(Value::String);
    }
    if c["operation"] == "compliance.issue" {
        return issue::create_issue(
            issue::IssueSpec::from_json(i)?,
            i["related"].as_array().unwrap(),
        );
    }
    if c["operation"] == "compliance.finish" {
        let mut issues = Vec::new();
        for spec in i["specs"].as_array().unwrap() {
            let mut record = spec.clone();
            record["title"] = json!("Titel");
            record["description"] = json!("Beschreibung");
            let mut value = issue::create_issue(
                issue::IssueSpec::from_json(&record)?,
                i["related"].as_array().unwrap(),
            )?;
            if let Some(ranges) = spec.get("assessmentRanges") {
                value["assessmentRanges"] = ranges.clone();
            }
            issues.push(value);
        }
        return result::finish_monthly_compliance(
            i["month"].as_str().unwrap(),
            &issues,
            i["from"].as_str().unwrap(),
            i["until"].as_str().unwrap(),
        );
    }
    let month = i["month"].as_str().unwrap();
    let shifts = i["shifts"].as_array().unwrap();
    if c["operation"] == "compliance.specialDutyIssues" {
        return evidence::special_duty_issues(shifts, month).map(Value::Array);
    }
    if c["operation"] == "compliance.window" {
        let w = window::legal_calculation_window(&format!("{month}-01"), resolver)?;
        let last = luna_engine::calendar::month_range(month)?
            .end
            .parse()
            .unwrap();
        return Ok(
            json!({"window":w,"end":window::calculation_end(last,&w)?.to_string(),"weekendStart":window::planning_weekend_coverage_start(month)?}),
        );
    }
    let ranks = serde_json::from_value::<CollationRanks>(i["collationRanks"].clone()).unwrap();
    if c["operation"] == "compliance.prepareMonths" {
        let input =
            preparation::PreparedShifts::new(shifts, i["timeZone"].as_str().unwrap(), &ranks)?;
        return i["months"]
            .as_array()
            .unwrap()
            .iter()
            .map(|month| {
                preparation::prepare_calendar_from_input(
                    month.as_str().unwrap(),
                    &input,
                    &i["options"],
                    "2026-07-15",
                    resolver,
                )
                .map(|value| value.to_json())
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array);
    }
    let prepared = preparation::prepare_calendar(
        month,
        shifts,
        i["timeZone"].as_str().unwrap(),
        &i["options"],
        "2026-07-15",
        resolver,
        &ranks,
    )?;
    match c["operation"].as_str().unwrap() {
        "compliance.prepare" => Ok(prepared.to_json()),
        "compliance.restPeriods" => Ok(json!(
            sequences::rest_periods(&prepared.intervals)?
                .iter()
                .map(sequences::RestPeriod::to_json)
                .collect::<Vec<_>>()
        )),
        "compliance.compensatedShortRestIndexes" => {
            let rests = sequences::rest_periods(&prepared.intervals)?;
            let rules = prepared.legal_package.rules();
            let deviation: Option<sequences::RestDeviation> = rules["restPeriod"]["deviations"]
                .as_array()
                .unwrap()
                .first()
                .map(|v| serde_json::from_value(v.clone()).unwrap());
            Ok(json!(
                sequences::compensated_short_rest_indexes(
                    &rests,
                    deviation.as_ref(),
                    rules["restPeriod"]["defaultMinutes"].as_i64().unwrap()
                )?
                .into_iter()
                .collect::<Vec<_>>()
            ))
        }
        "compliance.consecutiveDateStreaks" => {
            let streaks = sequences::consecutive_date_streaks(&prepared.shifts)?;
            Ok(json!(
                streaks
                    .iter()
                    .map(|rows| rows.iter().map(Arc::as_ref).collect::<Vec<_>>())
                    .collect::<Vec<_>>()
            ))
        }
        "compliance.splitBreaks" => {
            let check = split::SplitDutyBreakCheck::new(shifts)?;
            let groups = split::work_groups_by_recorded_date(&prepared.intervals)?;
            let mut values = Vec::new();
            for group in groups {
                values.push(json!({"items":group.iter().map(|item|item.to_json()).collect::<Vec<_>>(),"interruption":split::interruption_minutes(&group,prepared.legal_package.rules()["breaks"]["minimumSegmentMinutes"].as_i64().unwrap(),&check,&prepared.intervals)?}));
            }
            let mut pairs = Vec::new();
            for (left, before) in prepared.intervals.iter().enumerate() {
                for (right, after) in prepared.intervals.iter().enumerate() {
                    if check.is_planned(before, after)? {
                        pairs.push(vec![left, right]);
                    }
                }
            }
            Ok(json!({"groups":values,"plannedPairs":pairs}))
        }
        "compliance.evidence" => evidence::check_evidence_completeness(
            month,
            &prepared.intervals,
            &i["options"],
            prepared.legal_package.rules(),
        )
        .map(Value::Array),
        "compliance.nightClassification" => prepared
            .intervals
            .iter()
            .map(|interval| {
                model::is_night_work(interval, prepared.legal_package.rules())
                    .map(|night| json!({"shiftId":interval.shift["id"],"night":night}))
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        operation => panic!("Unknown reference operation {operation}"),
    }
}
#[test]
fn raw_compliance_preparation_sequences_and_evidence_match_frozen_source() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../reference/compliance-foundation-golden.json"
    ))
    .unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 344);
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
    for c in cases {
        let resolver = resolvers
            .get(
                c["input"]
                    .get("catalogRef")
                    .and_then(Value::as_str)
                    .unwrap_or("bundled"),
            )
            .unwrap();
        let actual = match run(c, resolver) {
            Ok(v) => v,
            Err(e) => json!({"$error":{"name":e.source_error_name(),"message":e.to_string()}}),
        };
        assert!(
            same_value(&actual, &c["expected"]),
            "{}\nactual {actual}\nexpected {}",
            c["id"],
            c["expected"]
        );
    }
}

#[test]
fn immutable_raw_shift_preparation_is_shared_between_months() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../reference/compliance-foundation-golden.json"
    ))
    .unwrap();
    let input = &fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["id"] == "prepare-native-request-reuse")
        .unwrap()["input"];
    let resolver = RuleResolver::bundled().unwrap();
    let ranks: CollationRanks = serde_json::from_value(input["collationRanks"].clone()).unwrap();
    let prepared = preparation::PreparedShifts::new(
        input["shifts"].as_array().unwrap(),
        input["timeZone"].as_str().unwrap(),
        &ranks,
    )
    .unwrap();
    let july = preparation::prepare_calendar_from_input(
        "2026-07",
        &prepared,
        &input["options"],
        "2026-07-15",
        &resolver,
    )
    .unwrap();
    let august = preparation::prepare_calendar_from_input(
        "2026-08",
        &prepared,
        &input["options"],
        "2026-07-15",
        &resolver,
    )
    .unwrap();
    assert!(Arc::ptr_eq(&july.shifts, &august.shifts));
    assert!(Arc::ptr_eq(
        &july.intervals[0].shift,
        &august.intervals[0].shift
    ));
}
