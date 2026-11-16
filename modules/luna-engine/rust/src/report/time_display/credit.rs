use super::{TimeDisplayError, format, number, text};
use serde_json::Value;
pub(super) fn label(line: &Value) -> Result<String, TimeDisplayError> {
    if line.get("creditedMinutes") == Some(&Value::Null) {
        return Ok("Zeitgutschrift offen".into());
    }
    let minutes = number(line, "creditedMinutes")?;
    let paid = line.get("settlement").and_then(Value::as_str) == Some("PAY");
    if paid && minutes == 0.0 {
        return Ok("Auszahlung".into());
    }
    let credit = format!("{} h Zeitgutschrift", format::precise(minutes)?);
    Ok(if paid {
        format!("Auszahlung · {credit}")
    } else {
        credit
    })
}
pub(super) fn caption(summary: &Value) -> Result<Option<String>, TimeDisplayError> {
    let Some(account) = summary.get("timeAccountMinutes") else {
        return Ok(None);
    };
    let facts = crate::report::time_details::special_duty_time_facts(summary)
        .map_err(|_| TimeDisplayError)?;
    let lines = super::array(summary.get("specialDutyTimeCredits"))?;
    let reason = if facts.pending_count == 1 {
        let line = lines
            .get(facts.pending_indices[0])
            .ok_or(TimeDisplayError)?;
        let date = text(line, "date")?;
        let day = date.get(8..10).ok_or(TimeDisplayError)?;
        let month = date.get(5..7).ok_or(TimeDisplayError)?;
        let note = super::array(line.get("notes"))?
            .first()
            .and_then(Value::as_str)
            .unwrap_or("Ergänze die Angaben zur Bereitschaft.");
        format!("{day}.{month}.: {note}")
    } else if facts.pending_count > 1 {
        format!(
            "{} Bereitschaften: Angaben zur Zeitgutschrift fehlen.",
            facts.pending_count
        )
    } else {
        "Für das Zeitkonto fehlen noch Bereitschaftsangaben.".into()
    };
    let details = if account.is_null() {
        reason
    } else if facts.paid_minutes > 0.0 {
        format!(
            "{} h Bereitschaft mit Auszahlung.",
            format::precise(facts.paid_minutes)?
        )
    } else {
        "Zeitgutschrift aus deinem vereinbarten Ausgleich.".into()
    };
    Ok(Some(format!(
        "Erfasst: {} h. {details}",
        format::precise(number(summary, "actualMinutes")?)?
    )))
}
