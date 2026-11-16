use super::evidence::{self, Evidence, minute};
use crate::calendar::parse_date;
use crate::compliance::{
    average::add_days,
    issue::{IssueSpec, create_issue},
    model::{ComplianceError, js_round, text},
    policy,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
fn duration(minutes: i64) -> String {
    format!("{}:{:02} h", minutes / 60, minutes % 60)
}
fn explanation(count: usize, minimum: bool, status: &str, rest: Option<i64>) -> String {
    let series = format!(
        "{}{count} Nächte in Folge.",
        if minimum { "Mindestens " } else { "" }
    );
    let rest = rest.map(duration).unwrap_or_default();
    match status {
        "under24" => format!(
            "{series} Laut deinen Einträgen liegen danach {rest} ohne Arbeitseinsatz. Prüfe, ob mindestens 24 Stunden, möglichst 48 Stunden, zur Erholung möglich sind."
        ),
        "under48" => format!(
            "{series} Laut deinen Einträgen liegen danach {rest} ohne Arbeitseinsatz. 24 Stunden sind erreicht; möglichst 48 Stunden werden empfohlen."
        ),
        "atLeast48" => format!(
            "{series} Laut deinen Einträgen liegen danach {rest} ohne Arbeitseinsatz. Prüfe, ob sich die Nachtserie verkürzen lässt."
        ),
        "open" => format!(
            "{series} Prüfe, ob sich die Nachtserie verkürzen lässt. Die anschließende Erholungszeit ist noch offen."
        ),
        _ => format!(
            "{series} Prüfe, ob sich die Nachtserie verkürzen lässt. Die anschließende Erholungszeit ist mit den vorhandenen Angaben nicht beurteilbar."
        ),
    }
}
pub(super) fn assess(
    evidence: &mut Evidence<'_>,
    original: &[Value],
    options: &Value,
) -> Result<Vec<Value>, ComplianceError> {
    let mut issues = vec![];
    for block in &evidence.blocks {
        let count = block.len();
        if count < policy::MINIMUM_SERIES_FOR_RECOVERY {
            continue;
        }
        let coverage_start = text(options, "coverageStart")?;
        let coverage_end = text(options, "coverageEnd")?;
        let first = &block[0];
        let last = block.last().ok_or(ComplianceError::InvalidInput)?;
        let mut last_index = *last.work.first().ok_or(ComplianceError::InvalidInput)?;
        for i in &last.work[1..] {
            if minute(&evidence.work[*i].end) > minute(&evidence.work[last_index].end) {
                last_index = *i;
            }
        }
        let last_work = evidence.work[last_index];
        let next = evidence
            .work
            .iter()
            .find(|item| minute(&item.start) >= minute(&last_work.end))
            .copied();
        let following = add_days(parse_date(&last.date)?, 1)?.to_string();
        let preceding = add_days(parse_date(&first.date)?, -1)?.to_string();
        let next_end = next
            .map(|n| n.end.date().to_string())
            .unwrap_or_else(|| following.clone());
        let ambiguous = evidence.ambiguous.iter().any(|i| {
            evidence.work[*i].start.date().to_string() <= next_end
                && evidence.work[*i].end.date().to_string() >= last.date
        });
        let next_start = next
            .map(|n| n.start.date().to_string())
            .unwrap_or_else(|| following.clone());
        let from = evidence.windows.get(&first.date)?.0;
        let through = next
            .map(|n| minute(&n.end))
            .unwrap_or_else(|| minute(&last_work.end));
        let unknown = options.get("allEmploymentWorkRecorded") != Some(&Value::Bool(true))
            || evidence.uncertain.contains(&following)
            || ambiguous
            || following.as_str() >= coverage_end
            || evidence::unresolved(original, &last.date, &next_start)?
            || evidence::has_overlap(&evidence.work, from, through);
        let mut status = "open";
        let mut rest = None;
        if unknown {
            status = "unknown";
        } else if let Some(next) = next {
            let value = js_round(minute(&next.start) - minute(&last_work.end))?;
            if value < 0.0 || value > 9_007_199_254_740_991.0 {
                return Err(ComplianceError::InvalidInput);
            }
            let value = value as i64;
            rest = Some(value);
            status = if value < policy::MINIMUM_RECOVERY_MINUTES {
                "under24"
            } else if value < policy::PREFERRED_RECOVERY_MINUTES {
                "under48"
            } else {
                "atLeast48"
            };
        }
        let minimum = preceding.as_str() < coverage_start
            || evidence.uncertain.contains(&preceding)
            || evidence::unresolved(original, &preceding, &first.date)?;
        let long = count >= policy::FIRST_NIGHT_HINT;
        let short = matches!(status, "under24" | "under48");
        if !long && !short {
            continue;
        }
        let rule = if long {
            "PLANNING_NIGHT_SERIES"
        } else {
            "PLANNING_NIGHT_RECOVERY"
        };
        let sequence = json!({"policyVersion":policy::NIGHT_POLICY_VERSION,"firstNight":first.date,"lastNight":last.date,"countIsMinimum":minimum,"recoveryStatus":status,"restMinutes":rest,"lastShiftId":text(&last_work.shift,"id")?,"nextShiftId":next.map(|n|text(&n.shift,"id")).transpose()?});
        let mut related: Vec<&Value> = vec![];
        let mut positions = BTreeMap::<&str, usize>::new();
        let work = &evidence.work;
        for item in block
            .iter()
            .flat_map(|night| night.work.iter().map(move |i| work[*i]))
            .chain(next)
        {
            let id = text(&item.shift, "id")?;
            if let Some(index) = positions.get(id) {
                related[*index] = item.shift.as_ref();
            } else {
                positions.insert(id, related.len());
                related.push(item.shift.as_ref());
            }
        }
        let date = if long {
            &block[policy::FIRST_NIGHT_HINT - 1].date
        } else {
            &last.date
        };
        let title = if long {
            format!(
                "{}{count} Nächte in Folge mit Nachtarbeit",
                if minimum { "Mindestens " } else { "" }
            )
        } else {
            format!(
                "Unter {} Stunden arbeitsfreie Zeit nach der Nachtserie",
                if status == "under24" { 24 } else { 48 }
            )
        };
        let description = explanation(count, minimum, status, rest);
        let facts = json!({"rule":rule,"count":count,"nightSequence":sequence});
        issues.push(create_issue(
            IssueSpec::new("warning", "PLANNING", rule, &title, &description)
                .on_date(date)
                .with_facts(&facts),
            related,
        )?);
    }
    Ok(issues)
}
