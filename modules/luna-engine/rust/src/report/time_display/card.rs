use super::{TimeDisplayError, array, format, number};
use serde_json::{Value, json};
fn basis(code: &str) -> Option<&'static str> {
    match code {
        "LEGACY_WORK_MODEL_UNKNOWN" => {
            Some("Grundlage: 5-Tage-Woche (Mo–Fr). Arbeitszeitmodell ergänzen.")
        }
        "WORK_MODEL_UNKNOWN" => Some("Arbeitszeitmodell noch offen."),
        "WORK_PROFILE_MISSING" => Some("Arbeitszeitprofil für diesen Zeitraum ergänzen."),
        "HOLIDAY_REGION_UNKNOWN" => Some("Bundesland für die Feiertagsberechnung ergänzen."),
        "HOLIDAY_REGION_UNSUPPORTED" => Some("Feiertagsdaten für dein Bundesland fehlen."),
        "TARIFF_SCOPE_UNCONFIRMED" => Some("Tarifzuordnung noch nicht bestätigt."),
        "TARIFF_VERSION_UNREVIEWED" => Some("Tarifgrundlage noch nicht geprüft."),
        "TARIFF_UNSUPPORTED" => Some("Tarifgrundlage für die Sollzeit ergänzen."),
        "SEVEN_DAY_PLAN_UNCONFIRMED" => Some("Grundlage: 5-Tage-Woche im Schichtdienst."),
        "CUSTOM_ROTATING_REFERENCE" => {
            Some("Mit der hinterlegten Referenz für dein Arbeitszeitmodell berechnet.")
        }
        "TARGET_RULE_FORECAST" => Some("Mit der hinterlegten Sollzeitregel berechnet."),
        "CONDITIONAL_ROSTER_FREE_FORECAST" => Some("Dienstplanangaben für die Sollzeit ergänzen."),
        _ => None,
    }
}
fn target_caption(target: Option<&Value>) -> Result<Option<String>, TimeDisplayError> {
    let Some(target) =
        target.filter(|t| t.get("status").and_then(Value::as_str) == Some("PROVISIONAL"))
    else {
        return Ok(None);
    };
    let notices = array(target.get("notices"))?
        .iter()
        .filter(|item| {
            item.get("affectsTarget").and_then(Value::as_bool) == Some(true)
                && item.get("code").and_then(Value::as_str) != Some("CONTRACTUAL_TARGET_FORECAST")
        })
        .collect::<Vec<_>>();
    if let Some(notice) = notices.iter().find(|item| {
        !matches!(
            item.get("code").and_then(Value::as_str),
            Some("TARGET_RULE_FORECAST" | "CUSTOM_ROTATING_REFERENCE")
        )
    }) {
        return Ok(Some(
            basis(notice.get("code").and_then(Value::as_str).unwrap_or(""))
                .unwrap_or("Berechnungsannahmen in deinem Arbeitszeitprofil prüfen.")
                .into(),
        ));
    }
    if array(target.get("adjustments"))?.iter().any(|item| {
        matches!(
            item.get("status").and_then(Value::as_str),
            Some("PENDING" | "PLAN_ESTIMATE")
        )
    }) {
        return Ok(Some(
            "Dienstplanangaben für die Feiertagsberechnung noch offen.".into(),
        ));
    }
    Ok(if let Some(notice) = notices.first() {
        basis(notice.get("code").and_then(Value::as_str).unwrap_or("")).map(str::to_owned)
    } else {
        Some("Aus deinem Arbeitszeitprofil berechnet.".into())
    })
}
pub(super) fn present(frame: &Value, analysis: &Value) -> Result<Value, TimeDisplayError> {
    if frame.get("ok").and_then(Value::as_bool) != Some(true) {
        return Ok(
            json!({"actual":format::minutes(number(analysis,"totalMinutes")?)?,"target":"Nicht verfügbar","balance":"Nicht verfügbar","balanceAccent":"MUTED"}),
        );
    }
    let summary = frame.get("value").ok_or(TimeDisplayError)?;
    let account = summary.get("timeAccountMinutes");
    let actual = match account {
        Some(Value::Null) => "Noch offen".into(),
        Some(_) => format::precise(number(summary, "timeAccountMinutes")?)?,
        None => format::minutes(number(summary, "actualMinutes")?)?,
    };
    let balance =
        if !array(summary.get("specialDutyNotes"))?.is_empty() || account == Some(&Value::Null) {
            "Noch offen".into()
        } else if account.is_none() {
            format::signed(number(summary, "balanceMinutes")?)?
        } else {
            let minutes = number(summary, "balanceMinutes")?;
            format!(
                "{}{}",
                if minutes >= 0.0 { "+" } else { "" },
                format::precise(minutes)?
            )
        };
    let tint = if account == Some(&Value::Null) {
        "MUTED"
    } else if number(summary, "balanceMinutes")? < 0.0 {
        "DANGER"
    } else {
        "SUCCESS"
    };
    let mut card = json!({"actual":actual,"target":format::minutes(number(summary,"targetMinutes")?)?,"balance":balance,"balanceAccent":tint});
    if account.is_some() {
        card["actualLabel"] = json!("Zeitkonto");
    }
    let caption = match super::credit::caption(summary)? {
        Some(caption) => Some(caption),
        None => target_caption(summary.get("targetCalculation"))?,
    };
    if let Some(caption) = caption {
        card["caption"] = json!(caption);
    }
    Ok(card)
}

pub(super) fn dashboard(frame: &Value, analysis: &Value) -> Result<Value, TimeDisplayError> {
    let mut card = present(frame, analysis)?;
    card.as_object_mut()
        .ok_or(TimeDisplayError)?
        .remove("balanceAccent");
    if frame.get("ok").and_then(Value::as_bool) != Some(true) {
        card["actual"] = json!(format!(
            "{} h",
            card["actual"].as_str().ok_or(TimeDisplayError)?
        ));
        card["caption"] = json!(
            "Soll und Zeitgutschriften sind noch offen. Tippe für die Berechnungsgrundlagen."
        );
        return Ok(card);
    }
    let summary = frame.get("value").ok_or(TimeDisplayError)?;
    if summary.get("timeAccountMinutes") != Some(&Value::Null) {
        card["actual"] = json!(format!(
            "{} h",
            card["actual"].as_str().ok_or(TimeDisplayError)?
        ));
    }
    card["target"] = json!(format!(
        "{} h",
        card["target"].as_str().ok_or(TimeDisplayError)?
    ));
    let pending = !array(summary.get("specialDutyNotes"))?.is_empty();
    if !pending {
        card["balance"] = json!(format!(
            "{} h",
            card["balance"].as_str().ok_or(TimeDisplayError)?
        ));
    }
    if super::credit::caption(summary)?.is_none() && pending {
        card["caption"] = json!("Bereitschaften: Zeitgutschrift noch offen");
    }
    Ok(card)
}
