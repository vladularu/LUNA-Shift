//! Original annual editor display facts. No tax/annual calculation or host proof.
use crate::{
    input::{
        net_form::{self, InitialNetSettings},
        payroll_form::AnnualEditorSeed,
    },
    runtime::report::ReportIssue,
};
use serde_json::{Value, json};
fn invalid() -> ReportIssue {
    ReportIssue::new("PAYROLL_EDITOR_DISPLAY_INVALID")
}
fn title(month: &str) -> Result<String, ReportIssue> {
    crate::runtime::target_ui::month_title(month).map_err(|_| invalid())
}
fn duties(issue: &Value) -> Result<&[Value], ReportIssue> {
    match issue.get("duties") {
        None | Some(Value::Null) => Ok(&[]),
        Some(value) => value.as_array().map(Vec::as_slice).ok_or_else(invalid),
    }
}
fn issue_label(issue: &Value) -> Result<&'static str, ReportIssue> {
    Ok(match issue["code"].as_str().ok_or_else(invalid)? {
        "TARIFF_CHANGE" => "Tarifwechsel prüfen",
        "SALARY_BASIS_CONFLICT" => "Gehaltsangaben prüfen",
        "REFERENCE_MONTH_UNAVAILABLE" if !duties(issue)?.is_empty() => "Bereitschaft prüfen",
        "REFERENCE_MONTH_UNAVAILABLE" | "REFERENCE_MONTH_FAILED" => "Referenzmonat prüfen",
        "UNSUPPORTED_GROUP" | "UNSUPPORTED_YEAR" | "NO_TARIFF" => "Betrag ergänzen",
        "TEST_DATA" => "Testdaten aktiv",
        _ => return Err(invalid()),
    })
}
fn issue_message(issue: &Value) -> Result<String, ReportIssue> {
    let reference = || issue["month"].as_str().ok_or_else(invalid).and_then(title);
    Ok(match issue["code"].as_str().ok_or_else(invalid)? {
        "TARIFF_CHANGE" => "Im Anspruchsjahr ändern sich Tarif oder Entgeltgruppe. Prüfe deinen Beschäftigungsverlauf. Waren die bisherigen Angaben falsch, berichtige den gesamten Zeitraum. Bei einem tatsächlichen Wechsel kannst du den bestätigten Bruttobetrag ergänzen.".into(),
        "SALARY_BASIS_CONFLICT" => "Deine gespeicherten Gehaltsangaben widersprechen sich. Prüfe Tarif und Gehalt in deinem Arbeitsprofil.".into(),
        "REFERENCE_MONTH_UNAVAILABLE" if !duties(issue)?.is_empty() => format!("Für {} fehlen noch Abrechnungsangaben zur Bereitschaft. Prüfe die betroffenen Dienste, damit die Jahressonderzahlung berechnet werden kann.",reference()?),
        "REFERENCE_MONTH_UNAVAILABLE" => format!("Für {} fehlt eine vollständige Gehaltsberechnung. Prüfe dort Dienste und Gehaltsangaben oder ergänze den bestätigten Bruttobetrag.",reference()?),
        "REFERENCE_MONTH_FAILED" => format!("Die Gehaltsberechnung für {} ist fehlgeschlagen. Prüfe dort Dienste und Gehaltsangaben und versuche es erneut. Du kannst auch den bestätigten Bruttobetrag ergänzen.",reference()?),
        "UNSUPPORTED_GROUP" => "Für diese Tarifgruppe ist noch keine automatische Prognose hinterlegt. Du kannst den bestätigten Bruttobetrag ergänzen.".into(),
        "UNSUPPORTED_YEAR" => "Die automatische Tarifprognose ist bisher nur für 2026 hinterlegt. Für dieses Jahr kannst du den bestätigten Bruttobetrag ergänzen.".into(),
        "NO_TARIFF" => "Für deine Gehaltsgrundlage gibt es keine automatische Tarifprognose. Du kannst den vereinbarten Bruttobetrag ergänzen.".into(),
        "TEST_DATA" => "Solange Testmonate aktiv sind, wird keine persönliche Tarifprognose berechnet. Stelle im Testlabor deine eigenen Daten wieder her.".into(),
        _ => return Err(invalid()),
    })
}
pub fn present(
    month: &str,
    profile: &Value,
    settings: &InitialNetSettings,
    seed: &AnnualEditorSeed,
    annual: &Value,
) -> Result<Value, ReportIssue> {
    if !crate::net::settings::valid_settings_month(month) {
        return Err(invalid());
    }
    let forecast = annual["payments"].as_array().ok_or_else(invalid)?;
    let saved = settings.settings()["automation"]["annualPayments"]
        .as_array()
        .map_or(&[][..], Vec::as_slice);
    let visible = if forecast.is_empty() { saved } else { forecast };
    if !crate::runtime::financial_report::payroll::annual_editor_visible(month, profile, visible)? {
        return Ok(json!({"visible":false}));
    }
    let initial = seed.initial();
    let automatic = annual["automatic"].as_bool().ok_or_else(invalid)?;
    let issue = annual.get("issue").filter(|issue| !issue.is_null());
    let proposal = annual
        .get("proposal")
        .filter(|proposal| !proposal.is_null());
    let prefix = if automatic {
        "Automatisch nach Tarif"
    } else if initial.is_some() {
        "Eigener Betrag"
    } else if let Some(issue) = issue {
        issue_label(issue)?
    } else {
        "Keine Tarifprognose"
    };
    let mut message = None;
    let mut recovery = Value::Null;
    let mut review = &[][..];
    if initial.is_none()
        && let Some(issue) = issue
    {
        message = Some(issue_message(issue)?);
        match issue["code"].as_str().ok_or_else(invalid)? {
            "TARIFF_CHANGE" | "SALARY_BASIS_CONFLICT" => {
                recovery = json!({"title":"Beschäftigungsverlauf prüfen","target":{"kind":"PROFILE","section":"TARIFF"}})
            }
            "REFERENCE_MONTH_UNAVAILABLE" | "REFERENCE_MONTH_FAILED" => {
                let source_duties = duties(issue)?;
                if source_duties.is_empty() {
                    let month = issue["month"].as_str().ok_or_else(invalid)?;
                    recovery = json!({"title":format!("{} prüfen",title(month)?),"target":{"kind":"SALARY","month":month}});
                } else {
                    review = source_duties;
                }
            }
            _ => (),
        }
    }
    let year_prefix = format!("{}-", &month[..4]);
    let reset = !automatic
        && proposal.is_some()
        && saved.iter().any(|payment| {
            payment["payoutMonth"]
                .as_str()
                .is_some_and(|month| month.starts_with(&year_prefix))
        });
    let reset_amount = if reset {
        proposal.expect("checked proposal")["grossCents"].clone()
    } else {
        Value::Null
    };
    let proposal_note = proposal
        .map(|proposal| {
            let rate = proposal["rateBasisPoints"]
                .as_f64()
                .filter(|rate| rate.is_finite())
                .ok_or_else(invalid)?;
            let references: Result<Vec<_>, _> = proposal["referenceMonths"]
                .as_array()
                .ok_or_else(invalid)?
                .iter()
                .map(|month| month.as_str().ok_or_else(invalid).and_then(title))
                .collect();
            Ok::<_, ReportIssue>(format!(
                "{} % aus {} · voller Jahresanspruch.",
                net_form::display_decimal(rate, 100.0),
                references?.join(", ")
            ))
        })
        .transpose()?;
    let options: Result<Vec<_>, _> = (1..=12)
        .map(|number| {
            let value = format!("{}-{number:02}", &month[..4]);
            Ok::<_, ReportIssue>(json!({"label":title(&value)?,"value":value}))
        })
        .collect();
    Ok(json!({
        "visible":true,
        "initialGrossCents":initial.map(|initial|&initial["grossCents"]),
        "actionTitle":if initial.is_some(){"Anpassen"}else{"Betrag ergänzen"},
        "subtitle":format!("{prefix} · {}",title(seed.initial_payout())?),
        "issueMessage":message,"recovery":recovery,"duties":review,
        "resetGrossCents":reset_amount,"resetSuffix":if reset{Some(" · eigener Betrag wird ersetzt")}else{None},
        "proposalNote":proposal_note,"options":options?,
        "payoutCaption":format!("{} · 0 € bedeutet keine Zahlung.",title(seed.initial_payout())?),
    }))
}
