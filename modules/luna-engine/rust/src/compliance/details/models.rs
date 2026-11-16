//! Stateless glue for the existing, original-checked groups and duty models.
//! Monthly checks are never executed here. Locale strings cross the existing
//! platform rank boundary; complete union ranks are supplied on the final pass.
use crate::{
    calendar::recurrence::CollationRanks,
    compliance::presentation::{
        self,
        context::DetailSource,
        groups::{self, GroupDraft},
    },
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    action: Action,
    result: Value,
    shifts: Vec<Value>,
    time_zone: String,
    #[serde(default)]
    ranks: Option<CollationRanks>,
    #[serde(default)]
    regular_rest_minutes: BTreeMap<String, Option<i64>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum Action {
    BaseCandidates,
    Candidates,
    Finish,
}
fn night(issue: &Value) -> bool {
    matches!(
        issue["rule"].as_str(),
        Some("PLANNING_NIGHT_SERIES" | "PLANNING_NIGHT_RECOVERY")
    )
}
fn rest(issue: &Value, model: &Value, regular: Option<i64>) -> Value {
    let Some(facts) =
        presentation::valid_facts(&issue["facts"], issue["rule"].as_str().unwrap_or(""))
    else {
        return Value::Null;
    };
    if issue["kind"] != "LEGAL"
        || !issue["tariff"].is_null()
        || facts["rule"] != "ARBZG_5_REST_10H"
        || model["missing"] != false
    {
        return Value::Null;
    }
    let r = &model["rest"];
    let Some((minutes, minimum)) = r["minutes"]
        .as_f64()
        .zip(facts["minimumRestMinutes"].as_f64())
    else {
        return Value::Null;
    };
    if facts["restMinutes"].as_f64() != Some(minutes) || minimum <= 0.0 || minutes >= minimum {
        return Value::Null;
    }
    json!({"rest":r,"minimumMinutes":minimum,"regularMinutes":regular,"differenceMinutes":minimum-minutes})
}
pub fn execute(raw: &[u8]) -> Result<Value, &'static str> {
    let input: Input = serde_json::from_value(
        crate::contract::bounded_json(raw).map_err(|_| "INVALID_CHECKS_MODELS")?,
    )
    .map_err(|_| "INVALID_CHECKS_MODELS")?;
    if input.shifts.len() > 50_000 {
        return Err("CHECKS_MODELS_LIMIT");
    }
    let visible = crate::compliance::checks::select_visible_compliance(&input.result, true)
        .map_err(|_| "INVALID_CHECKS_MODELS")?;
    let visible_legal = crate::compliance::checks::select_visible_compliance(&input.result, false)
        .map_err(|_| "INVALID_CHECKS_MODELS")?;
    let projection = groups::projection(&visible).map_err(|_| "INVALID_CHECKS_MODELS")?;
    let issues = projection["issues"]
        .as_array()
        .ok_or("INVALID_CHECKS_MODELS")?;
    let mut candidates =
        groups::base_collation_candidates(issues).map_err(|_| "INVALID_CHECKS_MODELS")?;
    candidates.extend(
        presentation::timeline::collation_candidates(&input.shifts)
            .map_err(|_| "INVALID_CHECKS_MODELS")?,
    );
    if matches!(input.action, Action::BaseCandidates) {
        return Ok(json!({"candidates":candidates}));
    }
    let ranks = input.ranks.as_ref().ok_or("INVALID_CHECKS_MODELS")?;
    let legal = issues
        .iter()
        .filter(|i| i["kind"] != "PLANNING")
        .cloned()
        .collect::<Vec<_>>();
    let nights = issues
        .iter()
        .filter(|i| i["kind"] == "PLANNING" && night(i))
        .cloned()
        .collect::<Vec<_>>();
    let legal = GroupDraft::prepare(&legal, &input.shifts, Some(&input.time_zone), ranks)
        .map_err(|_| "INVALID_CHECKS_MODELS")?;
    let nights = GroupDraft::prepare(&nights, &input.shifts, None, ranks)
        .map_err(|_| "INVALID_CHECKS_MODELS")?;
    candidates.extend(
        legal
            .collation_candidates()
            .map_err(|_| "INVALID_CHECKS_MODELS")?,
    );
    candidates.extend(
        nights
            .collation_candidates()
            .map_err(|_| "INVALID_CHECKS_MODELS")?,
    );
    if candidates.len() > 100_000 {
        return Err("CHECKS_MODELS_LIMIT");
    }
    if matches!(input.action, Action::Candidates) {
        return Ok(json!({"candidates":candidates}));
    }
    let mut groups = legal
        .finish(ranks)
        .map_err(|_| "INVALID_CHECKS_MODELS")?
        .as_array()
        .ok_or("INVALID_CHECKS_MODELS")?
        .clone();
    let planning =
        groups::planning(issues, &input.shifts, ranks).map_err(|_| "INVALID_CHECKS_MODELS")?;
    groups.extend(
        planning
            .as_array()
            .ok_or("INVALID_CHECKS_MODELS")?
            .iter()
            .cloned(),
    );
    let source = DetailSource::new(&input.shifts);
    let mut contexts = Vec::new();
    for group in &groups {
        let primary = &group["primary"];
        let related = group["relatedIssues"]
            .as_array()
            .ok_or("INVALID_CHECKS_MODELS")?;
        let mut context = source
            .prepare(primary, related, &input.time_zone, ranks)
            .map_err(|_| "INVALID_CHECKS_MODELS")?;
        for member in context["members"]
            .as_array_mut()
            .ok_or("INVALID_CHECKS_MODELS")?
        {
            let issue = &member["issue"];
            let regular = issue["date"]
                .as_str()
                .and_then(|date| input.regular_rest_minutes.get(date))
                .copied()
                .flatten();
            member["restDetail"] = rest(issue, &member["model"], regular);
            let period = member["hint"].get("weekendPeriod");
            let affected = member["model"]["related"]
                .as_array()
                .ok_or("INVALID_CHECKS_MODELS")?
                .iter()
                .filter(|shift| {
                    if let Some(period) = period {
                        let date = shift["date"].as_str().unwrap_or("");
                        date >= period["from"].as_str().unwrap_or("")
                            && date <= period["until"].as_str().unwrap_or("")
                            && date
                                .parse::<jiff::civil::Date>()
                                .is_ok_and(|date| date.weekday().to_monday_one_offset() >= 6)
                    } else {
                        true
                    }
                })
                .cloned()
                .collect::<Vec<_>>();
            let dates = affected
                .iter()
                .filter_map(|s| s["date"].as_str())
                .collect::<BTreeSet<_>>();
            member["affectedDates"] = json!(dates);
            member["affectedShifts"] = json!(affected);
        }
        contexts.push(json!({"groupId":group["id"],"primaryId":primary["id"],"context":context}));
    }
    let mut periods = serde_json::Map::new();
    for issue in issues.iter().chain(
        projection["prerequisites"]
            .as_array()
            .ok_or("INVALID_CHECKS_MODELS")?,
    ) {
        if let Some(id) = issue["id"].as_str() {
            periods.insert(id.to_owned(), tariff_dates(&issue["tariff"]));
        }
    }
    Ok(
        json!({"visible":visible,"visibleLegal":visible_legal,"projection":projection,"groups":groups,"planningGroups":planning,"contexts":contexts,"tariffPeriods":periods}),
    )
}
fn tariff_dates(evidence: &Value) -> Value {
    use jiff::ToSpan;
    let fallback = Value::Null;
    let Some((from, until)) = evidence["period"]["from"]
        .as_str()
        .and_then(|v| v.parse::<jiff::civil::Date>().ok())
        .zip(
            evidence["period"]["until"]
                .as_str()
                .and_then(|v| v.parse::<jiff::civil::Date>().ok()),
        )
    else {
        return fallback;
    };
    let Some(recorded) = evidence["recordedDates"].as_array() else {
        return fallback;
    };
    let dates = recorded
        .iter()
        .filter_map(Value::as_str)
        .collect::<BTreeSet<_>>();
    if dates.is_empty()
        || evidence["count"].as_u64() != Some(dates.len() as u64)
        || dates
            .iter()
            .any(|&date| date < from.to_string().as_str() || date > until.to_string().as_str())
    {
        return fallback;
    }
    if evidence["ruleId"] == "TARIFF_FREE_SUNDAY" {
        if dates.len() != 2
            || dates.iter().any(|date| {
                !date
                    .parse::<jiff::civil::Date>()
                    .is_ok_and(|date| date.weekday().to_monday_one_offset() == 7)
            })
        {
            return fallback;
        }
        return json!({"dates":dates,"compact":false});
    }
    let Ok(span) = until.since(from) else {
        return fallback;
    };
    let count = span.get_days() + 1;
    if from.weekday().to_monday_one_offset() != 1 || !matches!(count, 7 | 14) {
        return fallback;
    }
    let dates = (0..count)
        .map(|n| from.checked_add(n.days()).map(|v| v.to_string()))
        .collect::<Result<Vec<_>, _>>();
    dates.map_or(fallback, |dates| json!({"dates":dates,"compact":true}))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn complete_original_details_groups_contexts_rest_and_tariff_dates_match() {
        let fixture = crate::test_value_pool::decode(include_str!(
            "../../../../reference/compliance-details-models-golden.json"
        ));
        for case in fixture["cases"].as_array().unwrap() {
            let mut input = case["input"].clone();
            for action in ["BASE_CANDIDATES", "CANDIDATES"] {
                input["action"] = json!(action);
                let output = execute(&serde_json::to_vec(&input).unwrap()).unwrap();
                for candidate in output["candidates"].as_array().unwrap() {
                    assert!(
                        case["input"]["ranks"]
                            .get(candidate.as_str().unwrap())
                            .is_some(),
                        "{}:{candidate}",
                        case["id"]
                    );
                }
            }
            input["action"] = json!("FINISH");
            let actual = execute(&serde_json::to_vec(&input).unwrap())
                .unwrap_or_else(|e| panic!("{}: {e}", case["id"]));
            assert_eq!(actual, case["expected"], "{}", case["id"]);
        }
    }
}
