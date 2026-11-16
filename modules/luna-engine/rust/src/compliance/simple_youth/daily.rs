use super::days::{YouthDay, elapsed};
use crate::compliance::{
    issue::{IssueSpec, create_issue},
    model::{ComplianceError, ComplianceInterval, text},
    sequences::rest_periods,
};
use bigdecimal::{BigDecimal, RoundingMode};
use serde_json::{Value, json};
use std::{collections::BTreeMap, str::FromStr};
pub(super) fn label(value: f64) -> Result<String, ComplianceError> {
    if !value.is_finite() {
        return Err(ComplianceError::InvalidInput);
    }
    if value == 0.0 {
        return Ok("0".into());
    }
    if value.abs() >= 1e21 || value.abs() < 1e-6 {
        let s = format!("{value:e}");
        let (a, b) = s.split_once('e').ok_or(ComplianceError::InvalidInput)?;
        let exponent = b
            .parse::<i32>()
            .map_err(|_| ComplianceError::InvalidInput)?;
        Ok(format!(
            "{a}e{}{exponent}",
            if exponent >= 0 { "+" } else { "" }
        ))
    } else {
        Ok(value.to_string())
    }
}
fn amount(minutes: f64) -> Result<String, ComplianceError> {
    // Intl de-DE maximumFractionDigits=2 rounds the decimal representation of
    // the actual f64 quotient; this is display formatting, never cash arithmetic.
    let value = BigDecimal::from_str(&label(minutes / 60.0)?)
        .map_err(|_| ComplianceError::InvalidInput)?
        .with_scale_round(2, RoundingMode::HalfUp)
        .to_plain_string();
    let (integer, fraction) = value.split_once('.').unwrap_or((&value, ""));
    let mut grouped = String::new();
    for (n, c) in integer.chars().rev().enumerate() {
        if n > 0 && n % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(c);
    }
    let grouped = grouped.chars().rev().collect::<String>();
    let fraction = fraction.trim_end_matches('0');
    Ok(if fraction.is_empty() {
        grouped
    } else {
        format!("{grouped},{fraction}")
    })
}
pub(super) fn daily_findings(days: &[YouthDay<'_>]) -> Result<Vec<Value>, ComplianceError> {
    let mut findings = Vec::new();
    for day in days {
        let related = || day.intervals.iter().map(|v| v.shift.as_ref());
        if day.work > 480.0 {
            findings.push(create_issue(IssueSpec::new(if day.work>510.0{"warning"}else{"info"},"LEGAL","JARBSCHG_8_DAILY",if day.work>510.0{"Arbeitszeit für Jugendliche zu lang"}else{"Arbeitszeit über 8 Stunden prüfen"},&format!("{} Stunden erfasste Arbeit. Regulär sind höchstens 8 Stunden erlaubt. Bis 8,5 Stunden können bei verkürzten anderen Arbeitstagen derselben Woche zulässig sein; für Feiertagsbrücken gelten besondere Ausgleichsregeln (§ 8).",amount(day.work)?)).on_date(&day.date),related())?);
        }
        let required = if day.work > 360.0 {
            60
        } else if day.work > 270.0 {
            30
        } else {
            0
        };
        if day.pauses < f64::from(required) {
            findings.push(create_issue(IssueSpec::new(if day.has_gap{"info"}else{"warning"},"LEGAL","JARBSCHG_11_BREAK_DURATION",if day.has_gap{"Pausen zwischen Diensten prüfen"}else{"Mehr Pause für Jugendliche nötig"},&format!("Bei der erfassten Arbeitszeit sind mindestens {required} Minuten Pause nötig. Eingetragen: {} Minuten. Eine Unterbrechung zwischen Diensten zählt nur als tatsächliche Ruhepause (§ 11).",label(day.pauses)?)).on_date(&day.date),related())?);
        }
    }
    Ok(findings)
}
pub(super) fn service_findings(
    intervals: &[&ComplianceInterval],
) -> Result<Vec<Value>, ComplianceError> {
    let mut findings = Vec::new();
    let mut groups = Vec::<(&str, Vec<&ComplianceInterval>)>::new();
    let mut indices = BTreeMap::new();
    for item in intervals {
        let date = text(&item.shift, "date")?;
        let index = *indices.entry(date).or_insert_with(|| {
            groups.push((date, vec![]));
            groups.len() - 1
        });
        groups[index].1.push(item);
        let start = i64::from(item.start.hour()) * 60 + i64::from(item.start.minute());
        let end = i64::from(item.end.hour()) * 60 + i64::from(item.end.minute());
        let overnight = item.start.date() != item.end.date();
        if start < 360 || end > 1200 || overnight {
            let outside = start < 330 || end > 1410 || overnight;
            findings.push(create_issue(IssueSpec::new(if outside{"warning"}else{"info"},"LEGAL","JARBSCHG_14_NIGHT",if outside{"Nachtdienst für Jugendliche prüfen"}else{"Früh- oder Spätdienst für Jugendliche prüfen"},"Regulär darf nur von 6 bis 20 Uhr gearbeitet werden. Für Jugendliche über 16 Jahre gibt es unter bestimmten Voraussetzungen Ausnahmen in Mehrschichtbetrieben, teilweise bis 23 bzw. 23:30 Uhr oder ab 5:30 Uhr. Diese Ausnahme und die Grenze vor frühem Berufsschulunterricht sind hier nicht bestätigt (§ 14)."),[item.shift.as_ref()])?);
        }
    }
    for (date, items) in groups {
        let start = &items
            .iter()
            .min_by_key(|v| v.start.timestamp())
            .ok_or(ComplianceError::InvalidInput)?
            .start;
        let end = &items
            .iter()
            .max_by_key(|v| v.end.timestamp())
            .ok_or(ComplianceError::InvalidInput)?
            .end;
        let duration = elapsed(start, end)?;
        if duration > 600.0 {
            findings.push(create_issue(IssueSpec::new("warning","LEGAL","JARBSCHG_12_SPAN","Dienstspanne über 10 Stunden",&format!("Vom ersten Beginn bis zum letzten Ende einschließlich Pausen liegen {} Stunden. Für Jugendliche beträgt die reguläre Grenze 10 Stunden (§ 12).",amount(duration)?)).on_date(date),items.iter().map(|v|v.shift.as_ref()))?);
        }
    }
    // The shared sequence helper preserves recorded start-date grouping and
    // latest-end boundaries. Its owned interval clones only share source Arcs.
    let owned = intervals.iter().map(|v| (*v).clone()).collect::<Vec<_>>();
    for period in rest_periods(&owned)? {
        if period.minutes >= 0.0 && period.minutes < 720.0 {
            findings.push(create_issue(IssueSpec::new("warning","LEGAL","JARBSCHG_13_REST","Weniger als 12 Stunden Ruhezeit",&format!("Zwischen diesen Arbeitstagen liegen {} Stunden. Jugendliche brauchen mindestens 12 zusammenhängende Stunden Freizeit (§ 13).",amount(period.minutes)?)).on_date(text(&period.next.shift,"date")?).with_facts(&json!({"rule":"JARBSCHG_13_REST","restMinutes":period.minutes as i64,"minimumRestMinutes":720})),[period.current.shift.as_ref(),period.next.shift.as_ref()])?);
        }
    }
    Ok(findings)
}
pub(super) fn scope_findings(
    month: &str,
    days: &[YouthDay<'_>],
) -> Result<Vec<Value>, ComplianceError> {
    let prefix = format!("{month}-");
    let selected = days
        .iter()
        .filter(|d| d.date.starts_with(&prefix))
        .collect::<Vec<_>>();
    let mut findings = Vec::new();
    if let Some(day) = selected.iter().find(|d| d.work > 270.0 && d.pauses > 0.0) {
        findings.push(create_issue(IssueSpec::new("info","LEGAL","JARBSCHG_11_BREAK_PLACEMENT","Pausenlage prüfen","Die Pausensumme ist geprüft. Ohne Beginn und Ende jeder Pause lassen sich mindestens 15 Minuten je Pause, höchstens 4,5 Stunden am Stück sowie die Lage frühestens eine Stunde nach Beginn und spätestens eine Stunde vor Ende nicht prüfen (§ 11).").on_date(&day.date),[])?);
    }
    if let Some(item) = selected
        .iter()
        .flat_map(|d| &d.intervals)
        .find(|v| v.shift["type"] == "TRAINING")
    {
        findings.push(create_issue(IssueSpec::new("info","LEGAL","JARBSCHG_SCHOOL_SCOPE","Schulzeiten zusätzlich berücksichtigen","Hier werden die eingetragenen Zeiten geprüft. Gesetzliche Berufsschul- und Prüfungsanrechnung sowie besondere Regeln bei Vollzeitschulpflicht werden daraus nicht automatisch abgeleitet."),[item.shift.as_ref()])?);
    }
    Ok(findings)
}
