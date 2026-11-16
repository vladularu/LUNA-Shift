use super::super::{TimeDisplayError, credit, format, number};
use serde_json::{Value, json};
pub(super) fn actual(report: &Value) -> Result<String, TimeDisplayError> {
    match report.get("timeAccountMinutes") {
        Some(Value::Null) => Ok("Noch offen".into()),
        Some(_) => format::precise(number(report, "timeAccountMinutes")?),
        None => format::minutes(number(report, "actualMinutes")?),
    }
}
fn balance(report: &Value) -> Result<String, TimeDisplayError> {
    match report.get("timeAccountMinutes") {
        Some(Value::Null) => Ok("Noch offen".into()),
        None => format::signed(number(report, "balanceMinutes")?),
        Some(_) => {
            let value = number(report, "balanceMinutes")?;
            Ok(format!(
                "{}{}",
                if value >= 0.0 { "+" } else { "" },
                format::precise(value)?
            ))
        }
    }
}
pub(super) fn present(
    report: &Value,
    pending: bool,
    overview: bool,
) -> Result<Value, TimeDisplayError> {
    let account = report.get("timeAccountMinutes");
    let mut actual = actual(report)?;
    if overview && account != Some(&Value::Null) {
        actual.push_str(" h");
    }
    let target = if pending {
        "Wird berechnet".into()
    } else if report.get("targetMinutes") == Some(&Value::Null) {
        "Nicht verfügbar".into()
    } else {
        let formatted = format::minutes(number(report, "targetMinutes")?)?;
        if overview {
            format!("{formatted} h")
        } else {
            formatted
        }
    };
    let balance = if pending {
        "Wird berechnet".into()
    } else if report.get("balanceMinutes") == Some(&Value::Null) {
        if overview && account == Some(&Value::Null) {
            "Noch offen".into()
        } else {
            "Nicht verfügbar".into()
        }
    } else {
        let formatted = balance(report)?;
        if overview {
            format!("{formatted} h")
        } else {
            formatted
        }
    };
    let mut card = json!({"actual":actual,"target":target,"balance":balance});
    if account.is_some() {
        card["actualLabel"] = json!("Zeitkonto");
    }
    let caption = if overview && pending {
        Some("Erfasste Zeiten · Soll und Saldo werden berechnet.".into())
    } else {
        match credit::caption(report)? {
            Some(caption) => Some(caption),
            None if overview
                && report
                    .get("worktimeCoverageComplete")
                    .and_then(Value::as_bool)
                    == Some(false) =>
            {
                Some("Erfasste Zeiten · Soll und Saldo nicht berechenbar".into())
            }
            None if overview
                && report.get("targetStatus").and_then(Value::as_str) == Some("PROVISIONAL") =>
            {
                Some("Aus den Arbeitszeitangaben der Monate berechnet.".into())
            }
            None => None,
        }
    };
    if let Some(caption) = caption {
        card["caption"] = json!(caption);
    }
    if !overview {
        card["balanceAccent"] = json!(if report.get("balanceMinutes") == Some(&Value::Null) {
            "MUTED"
        } else if number(report, "balanceMinutes")? < 0.0 {
            "DANGER"
        } else {
            "SUCCESS"
        });
    }
    Ok(card)
}
