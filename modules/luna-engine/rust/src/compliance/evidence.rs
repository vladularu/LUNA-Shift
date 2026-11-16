use super::{
    issue::{IssueSpec, create_issue},
    model::{ComplianceError, ComplianceInterval, is_night_work, text},
};
use crate::credit::duty::duty_calendar_dates;
use serde_json::{Value, json};

pub fn special_duty_issues(shifts: &[Value], month: &str) -> Result<Vec<Value>, ComplianceError> {
    let mut duties = Vec::new();
    for shift in shifts {
        let duty = &shift["specialDuty"];
        if !shift.get("deletedAt").is_some_and(Value::is_null)
            || duty.is_null()
            || duty["kind"] == "SPLIT"
        {
            continue;
        }
        if let Some(date) = duty_calendar_dates(shift)?
            .into_iter()
            .find(|date| date.starts_with(month))
        {
            duties.push((shift, date));
        }
    }
    if duties.is_empty() {
        return Ok(Vec::new());
    }
    let ids = duties
        .iter()
        .map(|(shift, _)| text(shift, "id"))
        .collect::<Result<Vec<_>, _>>()?;
    let date = duties
        .iter()
        .map(|(_, date)| date.as_str())
        .min()
        .ok_or(ComplianceError::InvalidInput)?;
    let mut issues = vec![
        json!({"id":format!("SPECIAL_DUTY_REVIEW:{month}"),"severity":"info","kind":"LEGAL","rule":"SPECIAL_DUTY_REVIEW","title":"Prüfumfang Bereitschaften","description":"Besondere Voraussetzungen und Ausnahmen für Bereitschaften sind nicht abschließend geprüft.","relatedShiftIds":ids,"date":date}),
    ];
    for (shift, date) in duties {
        if shift["specialDuty"]["kind"] == "ON_CALL"
            && shift["specialDuty"]["calloutsComplete"] != true
        {
            let id = text(shift, "id")?;
            issues.push(json!({"id":format!("SPECIAL_DUTY_CALLOUTS_INCOMPLETE:{id}:{month}"),"severity":"warning","kind":"LEGAL","rule":"SPECIAL_DUTY_CALLOUTS_INCOMPLETE","title":"Rufbereitschaft: Einsatzzeiten ergänzen","description":"Bestätige, ob alle Einsätze erfasst sind. Auch eine Rufbereitschaft ohne Einsatz muss vollständig erfasst sein.","date":date,"relatedShiftIds":[id]}));
        }
    }
    Ok(issues)
}
pub fn check_evidence_completeness(
    month: &str,
    intervals: &[ComplianceInterval],
    options: &Value,
    rules: &Value,
) -> Result<Vec<Value>, ComplianceError> {
    let prefix = format!("{month}-");
    let month_intervals = intervals
        .iter()
        .filter(|item| {
            item.shift["date"]
                .as_str()
                .is_some_and(|date| date.starts_with(&prefix))
        })
        .collect::<Vec<_>>();
    let Some(first) = month_intervals.first() else {
        return Ok(Vec::new());
    };
    let mut issues = Vec::new();
    let spec = |rule, title, description| IssueSpec {
        severity: "warning",
        kind: "LEGAL",
        rule,
        title,
        description,
        date: None,
        facts: None,
    };
    if options["allEmploymentWorkRecorded"] != true {
        issues.push(create_issue(spec("ARBZG_DATA_ALL_EMPLOYMENT","Arbeitszeiten aus allen Jobs erfasst?","Für eine vollständige Prüfung müssen die Arbeitszeiten aus allen Jobs erfasst sein."),[first.shift.as_ref()])?);
    }
    if options
        .get("regularRotatingNightWork")
        .is_none_or(Value::is_null)
    {
        let mut night = false;
        for interval in &month_intervals {
            if is_night_work(interval, rules)? {
                night = true;
                break;
            }
        }
        if night {
            issues.push(create_issue(
                spec(
                    "ARBZG_6_NIGHT_STATUS_UNKNOWN",
                    "Regelmäßige Nacht- oder Wechselschichtarbeit?",
                    "Diese Angabe fehlt für die Nachtarbeitsprüfung.",
                ),
                [first.shift.as_ref()],
            )?);
        }
    }
    if options["holidayRegion"] == "UNKNOWN"
        && matches!(options["federalState"].as_str(), Some("BY" | "SN" | "TH"))
    {
        issues.push(create_issue(spec("HOLIDAY_REGION_UNKNOWN","Welche regionalen Feiertage gelten?","Fehlende Angaben können die Prüfung von Feiertagen und Ersatzruhetagen einschränken."),[first.shift.as_ref()])?);
    }
    Ok(issues)
}
