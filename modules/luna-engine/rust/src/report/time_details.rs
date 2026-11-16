//! Numeric sidecars over available native time/distribution outputs; no display formatting.
use serde::Serialize;
use serde_json::Value;
#[derive(Debug, Default, Serialize)]
pub struct AnnualDistributionSections {
    pub services: Vec<AnnualServiceItem>,
    pub absences: Vec<AnnualAbsenceItem>,
}
#[derive(Debug, Serialize)]
pub struct AnnualServiceItem {
    pub r#type: String,
    pub count: f64,
    pub percentage: f64,
}
#[derive(Debug, Serialize)]
pub struct AnnualAbsenceItem {
    pub r#type: String,
    pub count: f64,
}
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecialDutyTimeFacts {
    pub paid_minutes: f64,
    pub pending_indices: Vec<usize>,
    pub pending_count: usize,
}
#[derive(Debug, Clone, Copy)]
pub struct TimeFactsError;
impl std::fmt::Display for TimeFactsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Die Zeitdarstellung ist nicht verfügbar.")
    }
}
impl std::error::Error for TimeFactsError {}
fn absence(kind: &str) -> bool {
    matches!(kind, "VACATION" | "SICK" | "FREE")
}
pub fn annual_distribution_sections(distribution: &[(String, f64)]) -> AnnualDistributionSections {
    // Source consumes a Map: a repeated key updates the value at its first slot.
    let mut entries: Vec<(String, f64)> = Vec::new();
    for (kind, count) in distribution {
        if let Some((_, before)) = entries.iter_mut().find(|(key, _)| key == kind) {
            *before = *count;
        } else {
            entries.push((kind.clone(), *count));
        }
    }
    entries.retain(|(_, count)| *count > 0.0);
    entries.sort_by(|left, right| {
        right
            .1
            .partial_cmp(&left.1)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    // Sorting precedes the Number fold in Source; preserve even that order for
    // fractional/large values rather than summing a different iteration order.
    let total = entries
        .iter()
        .filter(|(kind, _)| !absence(kind))
        .fold(0.0, |total, (_, count)| total + count);
    let mut result = AnnualDistributionSections::default();
    for (kind, count) in entries {
        if absence(&kind) {
            result.absences.push(AnnualAbsenceItem {
                r#type: kind,
                count,
            });
        } else {
            result.services.push(AnnualServiceItem {
                r#type: kind,
                count,
                percentage: if total == 0.0 {
                    0.0
                } else {
                    (count / total * 100.0).round()
                },
            });
        }
    }
    result
}
/// Only call with an available native summary. Missing source/computation state
/// is not an empty summary and must remain unavailable at the Runtime boundary.
pub fn special_duty_time_facts(summary: &Value) -> Result<SpecialDutyTimeFacts, TimeFactsError> {
    if !summary.is_object() {
        return Err(TimeFactsError);
    }
    let lines = match summary.get("specialDutyTimeCredits") {
        None | Some(Value::Null) => &[][..],
        Some(Value::Array(lines)) => lines.as_slice(),
        _ => return Err(TimeFactsError),
    };
    let mut result = SpecialDutyTimeFacts::default();
    for (index, line) in lines.iter().enumerate() {
        if !line.is_object() {
            return Err(TimeFactsError);
        }
        if line.get("creditedMinutes") == Some(&Value::Null) {
            result.pending_indices.push(index);
        }
        if line["settlement"] == "PAY"
            && line.get("creditedMinutes").and_then(Value::as_f64) == Some(0.0)
        {
            result.paid_minutes += line
                .get("recordedMinutes")
                .and_then(Value::as_f64)
                .filter(|v| v.is_finite())
                .ok_or(TimeFactsError)?;
        }
    }
    result.pending_count = result.pending_indices.len();
    Ok(result)
}
