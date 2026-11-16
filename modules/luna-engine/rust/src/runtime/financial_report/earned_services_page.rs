//! Presentation policy from the original earned-services route, over native facts.
use crate::runtime::report::ReportIssue;
use serde_json::{Value, json};
pub fn present(
    month: &str,
    profile: &Value,
    pay: &Value,
    blocked: bool,
) -> Result<Value, ReportIssue> {
    let invalid = || ReportIssue::new("EARNED_SERVICES_POLICY_INVALID");
    crate::calendar::month_range(month).map_err(|_| invalid())?;
    if !profile.is_object() {
        return Err(invalid());
    }
    let available = pay["available"].as_bool().ok_or_else(invalid)?;
    let tariff = [
        "tariff",
        "nursingTrainingTariff",
        "vkaETariff",
        "tvlKrTariff",
        "tvUkNursingTariff",
        "tvhKrTariff",
        "tvalPflegeTariff",
    ]
    .iter()
    .any(|key| crate::net::js_truthy(&profile[*key]));
    let (kind, title, message) = if !tariff {
        (
            "NO_TARIFF",
            Some("Keine tarifliche Berechnung"),
            Some("Für manuell hinterlegtes Gehalt werden keine Zeitzuschläge berechnet."),
        )
    } else if !available {
        (
            "NO_PAY",
            Some("Nicht verfügbar"),
            Some("Für diesen Zeitraum fehlen geprüfte Tarifdaten."),
        )
    } else {
        ("SERVICES", None, None)
    };
    let tax_notice = (kind == "SERVICES" && blocked)
        .then_some("Für Testdaten wird keine steuerliche Aufteilung berechnet.");
    let read_error_notice = (kind == "SERVICES" && !blocked)
        .then_some("Die Angaben für die steuerliche Aufteilung konnten nicht geladen werden.");
    Ok(
        json!({"month":month,"kind":kind,"title":title,"message":message,"taxNotice":tax_notice,"taxReadErrorNotice":read_error_notice}),
    )
}
