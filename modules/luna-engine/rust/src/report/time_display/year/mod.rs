mod card;
mod months;
use super::{TimeDisplayError, array, number, rows};
use serde_json::{Value, json};
fn shifts(report: &Value, pending: bool, overview: bool) -> Result<Value, TimeDisplayError> {
    let Some(analysis) = report.get("shiftTypeAnalysis").filter(|v| !v.is_null()) else {
        return Ok(Value::Null);
    };
    let coverage = report
        .get("worktimeCoverageComplete")
        .and_then(Value::as_bool)
        .ok_or(TimeDisplayError)?;
    let available = coverage && (overview || !pending);
    let mut result = json!({"rows":rows::present(analysis,available,&[])?,"empty":number(analysis,"totalCount")?==0.0});
    if overview && (pending || !coverage) {
        result["caption"] = json!("Stunden ohne Abwesenheitsgutschriften.");
    } else if !available {
        result["caption"] =
            json!("Ohne Feiertagsdaten fehlen die Zeitgutschriften für Urlaub und Krankheit.");
    }
    Ok(result)
}
pub(super) fn present(report: &Value, pending: bool) -> Result<Value, TimeDisplayError> {
    report
        .get("worktimeCoverageComplete")
        .and_then(Value::as_bool)
        .ok_or(TimeDisplayError)?;
    let distribution = array(report.get("distribution"))?
        .iter()
        .map(|entry| {
            let entry = entry
                .as_array()
                .filter(|v| v.len() == 2)
                .ok_or(TimeDisplayError)?;
            let kind = entry[0].as_str().ok_or(TimeDisplayError)?.to_owned();
            let count = entry[1]
                .as_f64()
                .filter(|n| n.is_finite())
                .ok_or(TimeDisplayError)?;
            Ok((kind, count))
        })
        .collect::<Result<Vec<_>, TimeDisplayError>>()?;
    Ok(
        json!({"overview":{"card":card::present(report,pending,true)?,"shifts":shifts(report,pending,true)?},"details":{"card":card::present(report,pending,false)?,"shifts":shifts(report,pending,false)?},"months":months::present(report,pending)?,"distribution":crate::report::time_details::annual_distribution_sections(&distribution)}),
    )
}
