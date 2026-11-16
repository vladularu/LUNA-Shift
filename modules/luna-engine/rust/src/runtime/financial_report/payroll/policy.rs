use super::{failure, number, title};
use crate::{
    net::payment_schedule::{
        PAYMENT_GROUPS, PaymentGroup, PaymentPreferences, resolve_salary_payment_period,
        salary_payment_sources,
    },
    report::financial::annual_salary::{annual_payout_months, salary_annual_family},
    runtime::report::ReportIssue,
};
use serde_json::{Value, json};
use std::collections::BTreeSet;
fn label(value: &Value) -> String {
    if let Some(s) = value.as_str() {
        s.into()
    } else if let Some(n) = value.as_f64() {
        ryu_js::Buffer::new().format_finite(n).into()
    } else {
        "undefined".into()
    }
}
fn pension_label(scheme: &str) -> Result<&'static str, ReportIssue> {
    Ok(match scheme {
        "UNKNOWN" => "Zusatzversorgung nicht berücksichtigt",
        "NONE" => "Keine",
        "VBL_WEST" => "VBL West",
        "VBL_EAST" => "VBL Ost",
        "KZVK" => "KZVK Köln",
        "KZVK_DORTMUND" => "KZVK Dortmund · BAT-KF",
        "EZVK_DARMSTADT" => "EZVK · Bestand Darmstadt",
        "EZVK_KARLSRUHE" => "EZVK · Bestand Karlsruhe",
        "BVK_I" => "BVK Bayern · Abrechnungsverband I",
        "BVK_II" => "BVK Bayern · Abrechnungsverband II",
        "KVBW_I" => "KVBW Baden-Württemberg · Verband I",
        "KVBW_II" => "KVBW Baden-Württemberg · Verband II",
        "RZVK" => "Rheinische ZVK · Verband I",
        "KVW_I" => "kvw Westfalen-Lippe · Verband I",
        "KVW_II" => "kvw Westfalen-Lippe · Verband II",
        "KVK_I" => "KVK Kurhessen-Waldeck · Verband I",
        "ZVK_DARMSTADT_I" => "ZVK Darmstadt · Verband I",
        "ZVK_DARMSTADT_II" => "ZVK Darmstadt · Verband II",
        "KVBBG" => "ZVK Brandenburg · ATV-K",
        "ZVK_SACHSEN" => "ZVK Sachsen · ATV-K",
        "ZVK_THUERINGEN" => "ZVK Thüringen · ATV-K",
        "OTHER" => "Andere Kasse · offen",
        _ => return Err(failure()),
    })
}
fn settings_entry(settings: &Value) -> Result<Value, ReportIssue> {
    let p = &settings["profile"];
    let children = number(&p["childrenUnder25"])?;
    let family = if crate::net::js_truthy(&p["isParent"]) {
        if children == 0.0 {
            "Kinder · keine unter 25".into()
        } else {
            format!(
                "{} {} unter 25",
                label(&p["childrenUnder25"]),
                if children == 1.0 { "Kind" } else { "Kinder" }
            )
        }
    } else {
        "Keine Kinder".into()
    };
    let cases = settings["specialCases"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let insurance = if cases.iter().any(|v| v == "PRIVATE_INSURANCE") {
        "privat versichert"
    } else if cases.iter().any(|v| v == "OTHER_INSURANCE_STATUS") {
        "abweichender Versicherungsstatus"
    } else {
        "gesetzlich versichert"
    };
    let pension = pension_label(
        settings["automation"]["pensionScheme"]
            .as_str()
            .unwrap_or("UNKNOWN"),
    )?;
    let church = crate::net::js_truthy(&p["churchTaxRatePercent"]);
    Ok(
        json!({"accessibilityLabel":format!("Netto-Einstellungen. Steuerklasse {} · {} Kirchensteuer. {family} · {insurance}. {pension}. Angaben ansehen und ändern.",label(&p["taxClass"]),if church{"mit"}else{"ohne"}),"taxClass":p["taxClass"],"hasFactor":!p["factorPermille"].is_null(),"churchTax":church,"family":family,"insurance":insurance,"pension":pension}),
    )
}
pub(super) fn annual_visible(
    month: &str,
    profile: &Value,
    payments: &[Value],
) -> Result<bool, ReportIssue> {
    let year = month.get(..4).ok_or_else(failure)?;
    let first = payments
        .iter()
        .find(|p| p["payoutMonth"] == month)
        .or_else(|| {
            payments.iter().find(|p| {
                p["payoutMonth"]
                    .as_str()
                    .is_some_and(|m| m.starts_with(&format!("{year}-")))
            })
        });
    let fallback = annual_payout_months(
        salary_annual_family(profile),
        year.parse().map_err(|_| failure())?,
    )
    .map_err(|_| failure())?;
    let payout = first
        .and_then(|p| p["payoutMonth"].as_str())
        .or_else(|| fallback.first().map(String::as_str))
        .unwrap_or(month);
    let moved = first.is_some_and(|p| p["grossCents"].as_f64() == Some(0.0))
        && payments.iter().any(|p| {
            p["payoutMonth"]
                .as_str()
                .is_some_and(|m| m.starts_with(&format!("{year}-")))
                && p["grossCents"].as_f64().is_some_and(|n| n > 0.0)
        });
    Ok(payout == month && !moved)
}
pub(super) fn timing(month: &str, prefs: &PaymentPreferences) -> Result<Value, ReportIssue> {
    let period = resolve_salary_payment_period(prefs, month).map_err(|_| failure())?;
    let configured = period.map_or(Some(0), |p| p.delays[&PaymentGroup::Premiums]);
    let lag = configured.filter(|lag| {
        period.is_none_or(|p| PAYMENT_GROUPS.iter().all(|g| p.delays[g] == Some(*lag)))
    });
    let plans = PAYMENT_GROUPS
        .iter()
        .map(|group| salary_payment_sources(prefs, month, *group).map_err(|_| failure()))
        .collect::<Result<Vec<_>, _>>()?;
    let months = plans
        .iter()
        .flat_map(|p| p.months.iter())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let caption = if plans.iter().any(|p| !p.unresolved_months.is_empty()) {
        "Zulagenmonat noch offen".into()
    } else if months.is_empty() {
        "In diesem Monat keine Zulagen zugeordnet.".into()
    } else {
        format!(
            "{}: {}",
            if months.len() == 1 {
                "Zulagenmonat"
            } else {
                "Zulagenmonate"
            },
            months
                .iter()
                .map(|m| title(m))
                .collect::<Result<Vec<_>, _>>()?
                .join(" und ")
        )
    };
    Ok(json!({"choice":lag.map(|v|v.to_string()),"sourceMonths":months,"sourceCaption":caption}))
}
#[derive(Clone, Copy)]
pub(super) enum SettingsStatus {
    Ready,
    Loading,
    Error,
}
pub(super) struct ExtraInput<'a> {
    pub month: &'a str,
    pub profile: &'a Value,
    pub settings: Option<&'a Value>,
    pub selected: &'a Value,
    pub annual: &'a Value,
    pub forecast: Option<&'a Value>,
    pub preferences: &'a PaymentPreferences,
    pub blocked: bool,
    pub status: SettingsStatus,
}
pub(super) fn extras(input: &ExtraInput<'_>) -> Result<Value, ReportIssue> {
    let ExtraInput {
        month,
        profile,
        settings,
        selected,
        annual,
        forecast,
        preferences,
        blocked,
        status,
    } = input;
    let configured = settings.is_some_and(|s| s["version"].as_f64() == Some(2.0));
    let net_notice = if *blocked {
        Some("Für Testdaten gibt es keine Netto-Prognose.")
    } else if matches!(status, SettingsStatus::Loading) {
        Some("Netto-Angaben werden geladen …")
    } else if matches!(status, SettingsStatus::Error) {
        Some("Die Netto-Angaben konnten nicht geladen werden.")
    } else if !configured {
        Some("Ergänze deine Netto-Angaben über die Einstellungskarte.")
    } else {
        forecast
            .filter(|f| f["result"]["status"] == "unavailable")
            .and_then(|f| f["result"]["reason"].as_str())
    };
    let salary_notice = if *blocked {
        None
    } else {
        match status {
            SettingsStatus::Ready => None,
            SettingsStatus::Loading => Some("Weitere Bezüge werden geladen …"),
            SettingsStatus::Error => Some(
                "Weitere Bezüge konnten nicht geladen werden. Die Gehaltsübersicht ist unvollständig.",
            ),
        }
    };
    let entry = if !blocked && matches!(status, SettingsStatus::Ready) {
        settings.map(settings_entry).transpose()?
    } else {
        None
    };
    let payments = annual["payments"].as_array().ok_or_else(failure)?;
    let visible = configured && !*blocked && annual_visible(month, profile, payments)?;
    Ok(
        json!({"notices":{"net":net_notice,"salary":salary_notice,"recovery":forecast.map(|f|&f["recovery"])},"settingsEntry":entry,"annualEditor":{"visible":visible,"payments":payments,"proposal":annual["proposal"],"issue":annual["issue"],"automatic":annual["automatic"],"settingsMonth":settings.map(|s|&s["month"]),"savedRevision":selected["revision"]},"timing":timing(month,preferences)?}),
    )
}
