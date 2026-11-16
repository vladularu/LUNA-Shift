use super::{
    super::{TimeDisplayError, array, format, number, text},
    card,
};
use crate::input::javascript_json::number_text;
use serde_json::{Value, json};
pub(super) fn present(report: &Value, pending: bool) -> Result<Value, TimeDisplayError> {
    let months = array(report.get("months"))?;
    if months.len() != 12 {
        return Err(TimeDisplayError);
    }
    let maximum = months.iter().try_fold(1.0_f64, |maximum, item| {
        Ok::<_, TimeDisplayError>(maximum.max(number(item, "actualMinutes")?))
    })?;
    let mut result = Vec::with_capacity(months.len());
    for item in months {
        let month = text(item, "month")?;
        let title = crate::runtime::target_ui::month_title(month).map_err(|_| TimeDisplayError)?;
        let actual = card::actual(item)?;
        let shift_hours = format!(
            "{actual}{}",
            if item.get("timeAccountMinutes") == Some(&Value::Null) {
                ""
            } else {
                " h"
            }
        );
        let displayed = if pending {
            format::minutes(number(item, "actualMinutes")?)?
        } else {
            actual
        };
        let unit = if !pending && item.get("timeAccountMinutes") == Some(&Value::Null) {
            ""
        } else {
            " h"
        };
        let target = if pending {
            "Wird berechnet".into()
        } else if item.get("targetMinutes") == Some(&Value::Null) {
            "Nicht verfügbar".into()
        } else {
            format!("{} h", format::minutes(number(item, "targetMinutes")?)?)
        };
        let percentage = (number(item, "actualMinutes")? / maximum) * 100.0;
        if !percentage.is_finite() {
            return Err(TimeDisplayError);
        }
        result.push(json!({"month":month,"shiftHours":shift_hours,"width":format!("{}%",number_text(percentage)),"label":format!("{title}, {displayed} {}",if pending {"erfasst; Prüfung ausstehend"}else{"Ist"}),"subtitle":format!("{displayed}{unit} {} · Soll {target}",if pending {"erfasst"}else{"Ist"})}));
    }
    Ok(json!(result))
}
