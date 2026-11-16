use super::{TimeDisplayError, array, credit, format, number, text};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
pub(super) fn present(
    analysis: &Value,
    available: bool,
    credits: &[Value],
) -> Result<Value, TimeDisplayError> {
    let mut by_id = HashMap::new();
    for line in credits {
        by_id.insert(text(line, "shiftId")?, line);
    }
    let mut rows = Vec::new();
    if let Some(groups) = analysis.get("groups").filter(|v| !v.is_null()) {
        for group in array(Some(groups))? {
            let mut labels = Vec::new();
            let mut seen = HashSet::new();
            for entry in array(group.get("entries"))? {
                if let Some(line) = by_id.get(text(entry, "id")?) {
                    let label = credit::label(line)?;
                    if seen.insert(label.clone()) {
                        labels.push(label);
                    }
                }
            }
            let unavailable = !available
                && array(group.get("types"))?
                    .iter()
                    .any(|kind| matches!(kind.as_str(), Some("VACATION" | "SICK")));
            let hours = if unavailable {
                "Nicht verfügbar".into()
            } else {
                format!("{} h", format::minutes(number(group, "minutes")?)?)
            };
            let mut row = json!({"key":text(group,"key")?,"title":text(group,"title")?,"color":text(group,"color")?,"symbol":text(group,"symbol")?,"count":number(group,"count")?,"hours":hours,"total":false});
            if labels.len() == 1 {
                row["subtitle"] = json!(labels[0]);
            } else if !labels.is_empty() {
                row["subtitle"] = json!("Unterschiedlicher Ausgleich");
            }
            rows.push(row);
        }
    } else {
        for item in array(analysis.get("items"))? {
            let kind = text(item, "type")?;
            let hours = if !available && matches!(kind, "VACATION" | "SICK") {
                "Nicht verfügbar".into()
            } else {
                format!("{} h", format::minutes(number(item, "minutes")?)?)
            };
            rows.push(json!({"key":kind,"labelType":kind,"count":number(item,"count")?,"hours":hours,"total":false}));
        }
    }
    rows.push(json!({"key":"TOTAL","title":"Gesamt","color":"","symbol":"","count":number(analysis,"totalCount")?,"hours":format!("{} h",format::minutes(number(analysis,"totalMinutes")?)?),"total":true}));
    Ok(json!(rows))
}
