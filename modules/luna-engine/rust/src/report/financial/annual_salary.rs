//! Existing reviewable annual salary proposal and source payment schedule.
use super::{FinancialError, source::FinancialContext};
use crate::money::round_ratio;
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SalaryAnnualFamily {
    TvoedP,
    TvoedE,
    TvoedSue,
    TvlKr,
    TvhKr,
    Tvuk,
    Tvaoed,
    Tval,
    Caritas,
    Drk,
    AvrDd,
    Own,
}
pub fn annual_payout_months(
    family: SalaryAnnualFamily,
    year: i32,
) -> Result<Vec<String>, FinancialError> {
    if !(1900..=4099).contains(&year) || (family == SalaryAnnualFamily::AvrDd && year > 4098) {
        return Err(FinancialError::invalid("Ungültiges Anspruchsjahr."));
    }
    Ok(match family {
        SalaryAnnualFamily::Own => vec![],
        SalaryAnnualFamily::AvrDd => vec![format!("{year}-11"), format!("{}-06", year + 1)],
        _ => vec![format!("{year}-11")],
    })
}
pub fn salary_annual_family(profile: &Value) -> SalaryAnnualFamily {
    let yes = |key: &str| crate::net::js_truthy(&profile[key]);
    if yes("salaryBasisConflict") {
        SalaryAnnualFamily::Own
    } else if yes("nursingTrainingTariff") {
        SalaryAnnualFamily::Tvaoed
    } else if yes("tvalPflegeTariff") {
        SalaryAnnualFamily::Tval
    } else if yes("vkaETariff") {
        SalaryAnnualFamily::TvoedE
    } else if yes("tvlKrTariff") {
        SalaryAnnualFamily::TvlKr
    } else if yes("tvhKrTariff") {
        SalaryAnnualFamily::TvhKr
    } else if yes("tvUkNursingTariff") {
        SalaryAnnualFamily::Tvuk
    } else if yes("tariff") {
        SalaryAnnualFamily::TvoedP
    } else {
        SalaryAnnualFamily::Own
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnualSalaryProposal {
    pub gross_cents: i64,
    pub basis_cents: i64,
    pub rate_basis_points: i64,
    pub reference_months: Vec<String>,
    pub note: String,
}
#[derive(Debug, Clone, Serialize)]
pub struct AnnualSalaryProposalResult {
    pub proposal: Option<AnnualSalaryProposal>,
    pub issue: Option<Value>,
}
fn unavailable(code: &str) -> AnnualSalaryProposalResult {
    AnnualSalaryProposalResult {
        proposal: None,
        issue: Some(json!({"code":code})),
    }
}
fn basis(profile: &Value) -> Value {
    json!([
        profile["tariff"]["payGroup"],
        profile["vkaETariff"]["payGroup"],
        profile["tvlKrTariff"]["payGroup"],
        profile["tvhKrTariff"]["payGroup"],
        profile["tvUkNursingTariff"]["payGroup"],
        crate::net::js_truthy(&profile["nursingTrainingTariff"]),
        crate::net::js_truthy(&profile["tvalPflegeTariff"])
    ])
}
fn group(value: &Value) -> i64 {
    value
        .as_str()
        .unwrap_or("")
        .bytes()
        .filter(u8::is_ascii_digit)
        .fold(0i64, |number, digit| {
            number
                .saturating_mul(10)
                .saturating_add(i64::from(digit - b'0'))
        })
}
pub(crate) fn incomplete_duties(pay: &Value) -> Vec<Value> {
    let mut seen = BTreeSet::new();
    let mut duties: Vec<Value> = pay["specialDutyBreakdowns"].as_array().into_iter().flatten().filter(|line| !crate::net::js_truthy(&line["complete"]) && seen.insert(line["shiftId"].clone().to_string())).map(|line| json!({"shiftId":line["shiftId"],"date":line["date"],"title":line["title"],"message":line["notes"].as_array().and_then(|notes| notes.first()).filter(|note| !note.is_null()).cloned().unwrap_or_else(|| json!("Prüfe die Abrechnungsangaben dieses Dienstes."))})).collect();
    duties.sort_by(|left, right| left["date"].as_str().cmp(&right["date"].as_str()));
    duties
}
fn rounded_cents(value: f64) -> Option<i64> {
    let cents = (value * 100.0 + 0.5).floor();
    (cents.is_finite() && cents.abs() <= crate::money::MAX_SAFE_INTEGER as f64)
        .then_some(cents as i64)
}

pub fn annual_salary_proposal_result(
    year: i32,
    context: &mut FinancialContext<'_>,
) -> Result<AnnualSalaryProposalResult, FinancialError> {
    if year != 2026 {
        return Ok(unavailable("UNSUPPORTED_YEAR"));
    }
    let original = std::sync::Arc::clone(context.calculation_profile());
    if crate::net::js_truthy(&original["salaryBasisConflict"]) {
        return Ok(unavailable("SALARY_BASIS_CONFLICT"));
    }
    if !context.test_months().is_empty() {
        return Ok(unavailable("TEST_DATA"));
    }
    let mut contexts = vec![
        crate::employment::employment_profile_at(&original, &format!("{year}-01-01"))
            .map_err(|error| FinancialError::invalid(error.to_string()))?,
    ];
    for item in original["employmentTimeline"]
        .as_array()
        .into_iter()
        .flatten()
    {
        if crate::net::js_truthy(&item["employment"])
            && let Some(date) = item["effectiveFrom"]
                .as_str()
                .filter(|date| date.starts_with(&year.to_string()))
        {
            contexts.push(
                crate::employment::employment_profile_at(&original, date)
                    .map_err(|error| FinancialError::invalid(error.to_string()))?,
            );
        }
    }
    let bases: BTreeSet<String> = contexts
        .iter()
        .map(|profile| basis(profile).to_string())
        .collect();
    if bases.len() > 1 {
        return Ok(unavailable("TARIFF_CHANGE"));
    }
    let profile = crate::employment::employment_profile_at(&original, &format!("{year}-12-01"))
        .map_err(|error| FinancialError::invalid(error.to_string()))?;
    let yes = |key: &str| crate::net::js_truthy(&profile[key]);
    let mut months = vec![7, 8, 9];
    let rate = if yes("nursingTrainingTariff") {
        months = vec![8, 9, 10];
        9000
    } else if yes("tvalPflegeTariff") {
        months = vec![11];
        9500
    } else if yes("tariff") {
        if group(&profile["tariff"]["payGroup"]) <= 8 {
            9000
        } else {
            8500
        }
    } else if yes("vkaETariff") {
        if group(&profile["vkaETariff"]["payGroup"]) <= 8 {
            9000
        } else {
            8500
        }
    } else if yes("tvUkNursingTariff") {
        8800
    } else if yes("tvhKrTariff") {
        let group = group(&profile["tvhKrTariff"]["payGroup"]);
        if group > 12 {
            return Ok(unavailable("UNSUPPORTED_GROUP"));
        }
        if group <= 8 { 9000 } else { 6000 }
    } else if yes("tvlKrTariff") {
        let group = group(&profile["tvlKrTariff"]["payGroup"]);
        if group <= 6 {
            8743
        } else if group <= 8 {
            8814
        } else if group <= 15 {
            7435
        } else {
            4647
        }
    } else {
        return Ok(unavailable("NO_TARIFF"));
    };
    if let Some(cached) = context.annual_proposals.get(&year) {
        return Ok(cached.clone());
    }
    let reference_months: Vec<String> = months
        .iter()
        .map(|month| format!("{year}-{month:02}"))
        .collect();
    let mut sum = 0i64;
    for month in &reference_months {
        let calculated = (|| -> Result<Value, FinancialError> {
            let source = context.salary_month(month)?;
            let pay = source.pay();
            if pay["available"] != true
                || pay["estimatedGrossAmount"].is_null()
                || pay["personalBaseAmount"].is_null()
            {
                let mut issue = json!({"code":"REFERENCE_MONTH_UNAVAILABLE","month":month});
                let duties = incomplete_duties(pay);
                if !duties.is_empty() {
                    issue["duties"] = json!(duties);
                }
                return Ok(issue);
            }
            let amount = if yes("tvalPflegeTariff") {
                pay["personalBaseAmount"].as_f64()
            } else {
                pay["estimatedGrossAmount"]
                    .as_f64()
                    .zip(pay["overtimeAmount"].as_f64())
                    .map(|(gross, overtime)| gross - overtime)
            }
            .ok_or_else(|| FinancialError::invalid("Ungültige Vergütungssumme."))?;
            sum = sum
                .checked_add(
                    rounded_cents(amount)
                        .ok_or_else(|| FinancialError::invalid("Ungültige Vergütungssumme."))?,
                )
                .ok_or_else(|| FinancialError::invalid("Ungültige Vergütungssumme."))?;
            Ok(Value::Null)
        })();
        match calculated {
            Ok(issue) if !issue.is_null() => {
                return Ok(AnnualSalaryProposalResult {
                    proposal: None,
                    issue: Some(issue),
                });
            }
            Err(_) => {
                return Ok(AnnualSalaryProposalResult {
                    proposal: None,
                    issue: Some(json!({"code":"REFERENCE_MONTH_FAILED","month":month})),
                });
            }
            _ => {}
        }
    }
    let note = if yes("tvalPflegeTariff") {
        "Prognose bei vollem Jahresanspruch aus dem November-Ausbildungsentgelt. Zulagen und Zeitzuschläge erhöhen diese Grundlage nicht. Anspruch am Stichtag und mögliche Kürzungen sind nicht bestätigt."
    } else if yes("nursingTrainingTariff") {
        "Prognose bei vollem Jahresanspruch aus dem durchschnittlichen Entgelt von August bis Oktober einschließlich berücksichtigungsfähiger Zulagen. Zusätzliche Überstundenvergütung bleibt ausgenommen. Anspruch am Stichtag und mögliche Kürzungen sind nicht bestätigt."
    } else {
        "Vorschlag bei vollem Jahresanspruch und unveränderter gewählter Gehaltsbasis. Dienstplan und enthaltene Zulagen sind berücksichtigt, Überstunden ausgenommen. Beschäftigung am Stichtag, Fehlzeiten, Stufenwechsel und dienstplanmäßige Überstunden bitte prüfen; den Betrag gegebenenfalls anpassen."
    };
    let proposal = AnnualSalaryProposal {
        gross_cents: round_ratio(
            sum.checked_mul(rate)
                .ok_or_else(|| FinancialError::invalid("Ungültige Vergütungssumme."))?,
            months.len() as i64 * 10000,
        )
        .map_err(|error| FinancialError::invalid(error.to_string()))?,
        basis_cents: round_ratio(sum, months.len() as i64)
            .map_err(|error| FinancialError::invalid(error.to_string()))?,
        rate_basis_points: rate,
        reference_months,
        note: note.into(),
    };
    let result = AnnualSalaryProposalResult {
        proposal: Some(proposal),
        issue: None,
    };
    context.annual_proposals.insert(year, result.clone());
    Ok(result)
}

pub fn annual_salary_forecast(
    year: i32,
    context: &mut FinancialContext<'_>,
    saved: &[Value],
) -> Result<Value, FinancialError> {
    let result = annual_salary_proposal_result(year, context)?;
    let months = annual_payout_months(salary_annual_family(context.profile()), year)?;
    let automatic = result.proposal.is_some()
        && months.len() == 1
        && !saved.iter().any(|payment| {
            payment["payoutMonth"]
                .as_str()
                .is_some_and(|month| month.starts_with(&format!("{year}-")))
        });
    let mut payments = saved.to_vec();
    if automatic {
        payments.push(json!({"revision":1,"payoutMonth":months[0],"grossCents":result.proposal.as_ref().expect("automaticproposal").gross_cents,"netBasis":{"kind":"CONSTANT_PAY"}}));
    }
    Ok(
        json!({"payments":payments,"proposal":result.proposal,"automatic":automatic,"issue":result.issue}),
    )
}
