//! Source UI policies over the same native payroll/projection/net preparation.
use crate::{
    report::financial::presentation::js_round,
    runtime::{facts::SnapshotFacts, report::ReportIssue},
};
use serde_json::{Value, json};
#[derive(Clone, Copy)]
enum DataStatus {
    Ready,
    Loading,
    Error,
}
fn failure() -> ReportIssue {
    ReportIssue::new("FINANCIAL_DETAIL_PANELS_INVALID")
}
fn number(value: &Value) -> Result<f64, ReportIssue> {
    value.as_f64().filter(|n| n.is_finite()).ok_or_else(failure)
}
fn array(value: &Value) -> Result<&[Value], ReportIssue> {
    value.as_array().map(Vec::as_slice).ok_or_else(failure)
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, ReportIssue> {
    value[key].as_str().ok_or_else(failure)
}
fn notice(blocked: bool, forecast: Option<&Value>, status: DataStatus) -> Value {
    let message = if blocked {
        "Für Testdaten gibt es keine Netto-Prognose."
    } else if let Some(f) = forecast.filter(|f| f["result"]["status"] == "unavailable") {
        f["result"]["reason"]
            .as_str()
            .unwrap_or("Richte deine Netto-Angaben in der Gehaltsübersicht ein.")
    } else if matches!(status, DataStatus::Loading) {
        "Netto-Angaben werden geladen …"
    } else {
        "Richte deine Netto-Angaben in der Gehaltsübersicht ein."
    };
    json!({"message":message,"showRetry":matches!(status,DataStatus::Error),"errorText":if matches!(status,DataStatus::Error){Some("Die Netto-Angaben konnten nicht geladen werden.")}else{None}})
}
fn source_status(error: &ReportIssue) -> DataStatus {
    if matches!(error.code, "SOURCE_NOT_REQUESTED" | "SOURCE_LOADING") {
        DataStatus::Loading
    } else {
        DataStatus::Error
    }
}
fn setup(facts: &SnapshotFacts, month: &str) -> (bool, bool, DataStatus) {
    let blocked = match facts.test_months() {
        Ok(rows) => rows.months().contains(month),
        Err(error) => return (false, false, source_status(&error.into())),
    };
    if blocked {
        return (true, false, DataStatus::Ready);
    }
    let selected = facts
        .net_settings()
        .map_err(ReportIssue::from)
        .and_then(|timeline| {
            timeline
                .resolve(month)
                .map_err(|_| ReportIssue::new("NET_SETTINGS_INVALID"))
        });
    match selected {
        Ok(selected) => (
            false,
            selected["settings"]["version"].as_f64() == Some(2.0),
            DataStatus::Ready,
        ),
        Err(error) => (false, false, source_status(&error)),
    }
}
fn card(total: &Value, free: &Value) -> Result<Value, ReportIssue> {
    let taxable = if total.is_null() || free.is_null() {
        None
    } else {
        Some(number(total)? - number(free)?)
    };
    Ok(
        json!({"title":"Zeitzuschläge","totalCents":total,"taxFreeCents":free,"taxableCents":taxable}),
    )
}
fn premium(
    core: &Value,
    pay: &Value,
    available: Option<&Value>,
    unavailable: &Value,
) -> Result<Value, ReportIssue> {
    let summary = &core["premiumSummary"];
    if available.is_some() && !summary.is_null() {
        let rows=array(&summary["relevant"] )?.iter().map(|row|json!({"id":row["category"],"label":row["label"],"amountCents":row["paid"],"freeCents":row["free"],"taxableCents":row["taxable"]})).collect::<Vec<_>>();
        let without = array(&summary["rows"])?
            .iter()
            .filter(|row| row["paid"].as_f64() == Some(0.0))
            .map(|row| row["label"].clone())
            .collect::<Vec<_>>();
        Ok(
            json!({"kind":"CLASSIFIED","card":card(&summary["paidPremiumCents"],&summary["taxFreeCents"] )?,"rows":rows,"socialInsurance":{"freeCents":summary["socialInsuranceFreeCents"],"liableCents":summary["socialInsuranceLiablePremiumCents"]},"withoutPremiums":without,"unavailable":null}),
        )
    } else {
        let rows=array(&core["breakdown"]["categories"] )?.iter().filter(|row|row["amount"].as_f64().is_some_and(|n|n>0.0)).map(|row|Ok(json!({"id":row["key"],"label":row["label"],"amountCents":js_round(number(&row["amount"])?*100.0),"freeCents":null,"taxableCents":null}))).collect::<Result<Vec<_>,ReportIssue>>()?;
        Ok(
            json!({"kind":"GROSS","card":card(&json!(js_round(number(&pay["timePremiumAmount"])?*100.0)),&Value::Null)?,"rows":rows,"socialInsurance":null,"withoutPremiums":[],"unavailable":unavailable}),
        )
    }
}
pub(super) fn basis_notes(forecast: &Value) -> Result<Vec<String>, ReportIssue> {
    let mut notes = vec![];
    let timing = &forecast["payrollTimingEstimate"];
    if !timing.is_null() {
        let estimate = &timing["crossYearTaxEstimate"];
        notes.push(if !estimate.is_null() {
            if estimate["annualBasis"] == "PAYROLL" {
                "Jahreswechsel geschätzt · Auszahlung zum Monatsende, mit deinen Jahreswerten."
                    .to_owned()
            } else {
                "Jahreswechsel geschätzt · Auszahlung zum Monatsende, Jahresbrutto hochgerechnet."
                    .to_owned()
            }
        } else {
            let title = crate::runtime::target_ui::month_title(text(timing, "sourceMonth")?)
                .map_err(|_| failure())?;
            format!("Netto-Schätzung auf Basis des Zulagenmonats {title}.")
        });
    }
    if !forecast["annualPayment"].is_null() {
        notes.push(text(&forecast["annualPayment"], "note")?.to_owned());
    }
    Ok(notes)
}
fn deduction(
    core: &Value,
    month: &str,
    available: Option<&Value>,
    unavailable: &Value,
    label: &Value,
) -> Result<Value, ReportIssue> {
    let Some(forecast) = available else {
        let mut value = unavailable.clone();
        value["kind"] = json!("UNAVAILABLE");
        return Ok(value);
    };
    let pay = &forecast["result"]["pay"];
    let order = [
        "wage-tax",
        "health-insurance",
        "care-insurance",
        "pension-insurance",
        "unemployment-insurance",
        "solidarity",
        "church-tax",
        "supplementary-pension",
        "other-net",
    ];
    let mut deductions = core["deductions"].clone();
    let rows = deductions["rows"].as_array_mut().ok_or_else(failure)?;
    rows.sort_by_key(|row| {
        order
            .iter()
            .position(|id| row["id"] == *id)
            .map_or(-1, |i| i as i32)
    });
    let pension_note = pension_note(forecast);
    Ok(
        json!({"kind":"AVAILABLE","value":{"monthTitle":crate::runtime::target_ui::month_title(month).map_err(|_|failure())?,"forecastLabel":label,"deductions":deductions,"taxableGrossCents":pay["amounts"]["taxableGrossCents"],"socialInsuranceGrossCents":pay["amounts"]["socialInsuranceGrossCents"],"provisionalNetCents":if !label.is_null(){pay["netCents"].clone()}else{Value::Null},"basisNotes":basis_notes(forecast)?,"pensionNote":pension_note}}),
    )
}
fn pension_note(forecast: &Value) -> Option<&'static str> {
    let pay = &forecast["result"]["pay"];
    (forecast["pensionOmitted"]==true).then_some(if !pay["pension"].is_null()&&pay["pension"]["scheme"]!="NONE"{"Zusatzversorgung teilweise berücksichtigt. Weitere Beiträge und ihre Auswirkungen auf Steuern und Sozialversicherung fehlen noch."}else{"Beiträge zur Zusatzversorgung und ihre Auswirkungen auf Steuern und Sozialversicherung fehlen noch."})
}
pub(super) fn enrich(
    view: &mut Value,
    facts: &SnapshotFacts,
    month: &str,
    pay: &Value,
    net: &Result<Value, ReportIssue>,
    core: &Value,
) -> Result<(), ReportIssue> {
    let (blocked, enabled, status) = setup(facts, month);
    let forecast = net.as_ref().ok().filter(|_| enabled);
    let available = forecast.filter(|f| f["result"]["status"] == "available");
    let unavailable = notice(blocked, forecast, status);
    view["premiumDisplay"] = premium(core, pay, available, &unavailable)?;
    view["deductionDisplay"] = deduction(
        core,
        month,
        available,
        &unavailable,
        &view["serviceDisplay"]["forecastLabel"],
    )?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn original_unavailable_ui_policy_keeps_loading_error_test_and_unconfigured_distinct() {
        let source: Value = serde_json::from_str(include_str!(
            "../../../../reference/premium-deduction-display-golden.json"
        ))
        .unwrap();
        for case in source["statuses"].as_array().unwrap() {
            let status = match case["status"].as_str().unwrap() {
                "loading" => DataStatus::Loading,
                "error" => DataStatus::Error,
                _ => DataStatus::Ready,
            };
            let forecast = (case["enabled"] == true)
                .then_some(&case["forecast"])
                .filter(|v| !v.is_null());
            assert_eq!(
                notice(case["blocked"] == true, forecast, status),
                case["expected"]
            );
        }
    }
    #[test]
    fn original_cash_year_and_partial_pension_notes_remain_exact() {
        let source: Value = serde_json::from_str(include_str!(
            "../../../../reference/premium-deduction-display-golden.json"
        ))
        .unwrap();
        for case in source["metadata"].as_array().unwrap() {
            assert_eq!(
                json!({"basisNotes":basis_notes(&case["forecast"]).unwrap(),"pensionNote":pension_note(&case["forecast"])}),
                case["expected"]
            );
        }
    }
}
