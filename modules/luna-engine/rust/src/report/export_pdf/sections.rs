use super::{PdfError, format::*};
use crate::target::{MonthlyTarget, TargetStatus};
use serde_json::{Value, json};
use std::collections::HashSet;

pub(super) fn time(facts: &Value, targets: &[MonthlyTarget]) -> Result<Value, PdfError> {
    let mut seen = HashSet::new();
    let mut references = Vec::new();
    for target in targets {
        for notice in &target.notices {
            if matches!(
                notice.code.as_str(),
                "CONDITIONAL_ROSTER_FREE_FORECAST"
                    | "TARGET_RULE_FORECAST"
                    | "TRAINING_YOUTH_TARGET_UNSUPPORTED"
                    | "TRAINING_YOUTH_PREFERENCE_LOADING"
                    | "TRAINING_YOUTH_PREFERENCE_ERROR"
            ) && seen.insert(notice.message.as_str())
            {
                references.push(notice.message.as_str());
            }
        }
    }
    let note = if !references.is_empty() {
        format!("Sollzeit vorläufig. {}", references.join(" "))
    } else if targets
        .iter()
        .any(|target| target.status != TargetStatus::Final)
    {
        "Sollzeit vorläufig oder unvollständig. Offene Voraussetzungen sind nicht als bestätigter Anspruch berücksichtigt.".into()
    } else {
        String::new()
    };
    let has_account = boolean(facts, "hasTimeAccount");
    let values = [
        ("Sollzeit", minutes(number(facts, "target"), false)?),
        (
            "Erfasste Kontozeit",
            if has_account {
                account(number(facts, "timeAccount"), false)?
            } else {
                minutes(number(facts, "actual"), false)?
            },
        ),
        (
            "Saldo",
            if has_account {
                account(number(facts, "balance"), true)?
            } else {
                minutes(number(facts, "balance"), true)?
            },
        ),
    ];
    let cards = values.into_iter().map(|(label,value)|json!({"label":text(label),"unavailable":value=="Nicht verfügbar","value":text(&value)})).collect::<Vec<_>>();
    Ok(
        json!({"cards":cards,"accountNote":if has_account {text(&format!("Erfasste Zeit: {}. Die Kontozeit berücksichtigt die geplanten Zeitgutschriften aus der gewählten Abgeltung.",minutes(number(facts,"actual"),false)?))} else {Value::Null},"targetNote":optional_text(&note)}),
    )
}
pub(super) fn categories(facts: &Value) -> Result<Value, PdfError> {
    let mut rows = Vec::new();
    for category in facts["categories"].as_array().ok_or(PdfError)? {
        let count = number(category, "count");
        let amount = number(category, "minutes");
        if count == Some(0.0) && amount == Some(0.0) {
            continue;
        }
        let label = format!(
            "{}{}",
            string(category, "label"),
            count.map_or_else(String::new, |v| format!(
                " · {} Einträge",
                crate::input::javascript_json::number_text(v)
            ))
        );
        rows.push(json!({"label":text(&label),"value":text(&format!("{}{}",minutes(amount,false)?,if boolean(category,"credit"){" Gutschrift"}else{""}))}));
    }
    Ok(json!({"rows":rows}))
}
pub(super) fn annual(facts: &Value, include_salary: bool) -> Result<Value, PdfError> {
    const MONTHS: [&str; 12] = [
        "Januar",
        "Februar",
        "März",
        "April",
        "Mai",
        "Juni",
        "Juli",
        "August",
        "September",
        "Oktober",
        "November",
        "Dezember",
    ];
    let mut rows = Vec::new();
    for (month, label) in facts["monthly"]
        .as_array()
        .ok_or(PdfError)?
        .iter()
        .zip(MONTHS)
    {
        let has_account = boolean(month, "hasTimeAccount");
        rows.push(json!({"label":text(label),"target":text(&minutes(number(month,"target"),false)?),"actual":text(&if has_account{account(number(month,"actual"),false)?}else{minutes(number(month,"actual"),false)?}),"balance":text(&if has_account{account(number(month,"balance"),true)?}else{minutes(number(month,"balance"),true)?}),"gross":if include_salary{money(number(month,"gross"))?}else{Value::Null},"net":if include_salary{prepared_money(&month["netDisplay"])}else{Value::Null}}));
    }
    Ok(
        json!({"rows":rows,"includeSalary":include_salary,"basisNote":if include_salary{optional_text(string(facts,"netBasisNote"))}else{Value::Null}}),
    )
}
pub(super) fn salary(facts: &Value, details: bool) -> Result<Value, PdfError> {
    let annual = boolean(facts, "annual");
    let suffix = if annual { " (Teilwert möglich)" } else { "" };
    let mut gross_rows = Vec::new();
    let mut deduction_rows = Vec::new();
    if details && !annual {
        for (label, key, required) in [
            ("Grundgehalt", "base", true),
            ("Zulagen", "allowances", true),
            ("Zeitzuschläge", "premiums", true),
            ("Überstunden", "overtime", false),
            ("Bereitschaftsvergütung", "specialDuties", false),
            ("Jahressonderzahlung", "annualPaymentAmount", false),
        ] {
            let value = number(facts, key);
            if required || value.is_some_and(|v| v != 0.0) {
                gross_rows.push(json!({"label":text(label),"value":money(value)?}));
            }
        }
        for (label, key) in [
            ("Steuern", "tax"),
            ("Sozialversicherung", "insurance"),
            ("Zusatzversorgung", "pension"),
        ] {
            deduction_rows.push(json!({"label":text(label),"value":money(number(facts,key))?}));
        }
    }
    let notes = ["specialDutyNote", "annualPaymentNote"]
        .into_iter()
        .filter_map(|key| {
            let raw = string(facts, key);
            (!raw.is_empty()).then(|| text(raw))
        })
        .collect::<Vec<_>>();
    Ok(
        json!({"grossLabel":text(&format!("{}{suffix}",if boolean(facts,"grossPartial"){"Bekanntes Brutto"}else{"Brutto geschätzt"})),"gross":money(number(facts,"gross"))?,"grossUnavailable":facts["gross"].is_null(),"netLabel":text(&format!("{}{suffix}",string(facts,"netLabel"))),"net":prepared_money(&facts["netDisplay"]),"netUnavailable":facts["net"].is_null(),"basisNote":optional_text(string(facts,"netBasisNote")),"coverageNote":if annual{text(&format!("Brutto: {}/12 Monate verfügbar. Netto: {}/12 Monate verfügbar. Summen enthalten nur verfügbare Monate.",crate::input::javascript_json::number_text(number(facts,"payCount").unwrap_or(0.0)),crate::input::javascript_json::number_text(number(facts,"netCount").unwrap_or(0.0))))}else{Value::Null},"details":if details&&!annual{json!({"grossRows":gross_rows,"deductionRows":deduction_rows})}else{Value::Null},"notes":notes,"footer":text(&format!("Schätzung aus den eingetragenen Monatseinträgen. Keine Lohnabrechnung.{}",if boolean(facts,"pensionOmitted"){" Zusatzversorgung nicht berücksichtigt."}else{""}))}),
    )
}
pub(super) fn notice(facts: &Value) -> Result<Value, PdfError> {
    Ok(
        json!({"title":text(&format!("{}Prüfhinweise",if boolean(facts,"testData"){"Enthält Testdaten · "}else{""})),"checks":text(string(facts,"checks")),"prerequisites":optional_text(string(facts,"checkPrerequisites")),"issues":facts["issues"].as_array().ok_or(PdfError)?.iter().map(|v|short(v.as_str().unwrap_or(""),120)).collect::<Vec<_>>()}),
    )
}
