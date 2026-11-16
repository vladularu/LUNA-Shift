//! Explicit dated presentation; never a legacy-salary fallback.
use crate::{
    contract::ReportPeriod,
    report::financial::assessed::AssessedFinancialYear,
    runtime::{
        facts::SnapshotFacts,
        report::{ReportIssue, SectionOutput},
    },
};
use serde_json::{Value, json};
/// The year is a native assessed result with private fields and no Deserialize
/// implementation. No caller can substitute calculated host monetary facts.
pub fn annual(
    profile: &Value,
    year: i32,
    remuneration: &AssessedFinancialYear,
) -> Result<Value, ReportIssue> {
    annual_value(
        profile,
        year,
        &serde_json::to_value(remuneration).map_err(|_| ReportIssue::new("VIEW_OUTPUT_INVALID"))?,
    )
}
fn annual_value(profile: &Value, year: i32, remuneration: &Value) -> Result<Value, ReportIssue> {
    if !(1900..=4099).contains(&year) {
        return Err(ReportIssue::new("VIEW_PERIOD_INVALID"));
    }
    let rows = super::required(remuneration, "months")?
        .as_array()
        .ok_or_else(|| ReportIssue::new("VIEW_OUTPUT_INVALID"))?;
    if rows.len() != 12 {
        return Err(ReportIssue::new("VIEW_OUTPUT_INVALID"));
    }
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
    .any(|key| profile.get(*key).is_some_and(|v| !v.is_null()));
    let salary_source = if tariff {
        "TARIFF"
    } else if profile
        .get("manualMonthlyGrossCents")
        .is_some_and(|v| !v.is_null())
    {
        "MANUAL"
    } else {
        "UNSET"
    };
    let mut months = Vec::with_capacity(12);
    for (index, row) in rows.iter().enumerate() {
        let month = format!("{year}-{:02}", index + 1);
        if row["month"] != month {
            return Err(ReportIssue::new("VIEW_OUTPUT_INVALID"));
        }
        // Exactly calculateAvailableMonth's dated path: pay is null. These
        // compatibility fields never stand in for remuneration completeness.
        months.push(json!({"month":month,"timePremiumAmount":null,"estimatedGrossAmount":null,"premiumAmount":0}));
    }
    Ok(
        json!({"year":year,"salarySource":salary_source,"availablePayMonthCount":0,"estimatedGrossAmount":0,"premiumAmount":0,"overtimeAmount":0,"allowanceAmount":0,"months":months,"remuneration":remuneration}),
    )
}
pub(crate) fn presentation(
    facts: &SnapshotFacts,
    period: &ReportPeriod,
    output: &SectionOutput,
) -> Result<Value, ReportIssue> {
    let output = match output {
        SectionOutput::Ready { value } => value,
        SectionOutput::Unavailable { reason } => {
            return Ok(json!(SectionOutput::Unavailable {
                reason: reason.clone()
            }));
        }
        SectionOutput::NotRequested {} => return Ok(json!(SectionOutput::NotRequested {})),
    };
    let assessed = super::required(output, "assessed")?;
    if assessed["state"] != "READY" {
        return Ok(assessed.clone());
    }
    let value = super::required(assessed, "value")?;
    match period {
        ReportPeriod::Month { .. } => Ok(assessed.clone()),
        ReportPeriod::Year { year } => {
            let profile = facts
                .financial_profile()
                .map_err(ReportIssue::from)?
                .ok_or_else(|| ReportIssue::new("PROFILE_MISSING"))?;
            Ok(json!(SectionOutput::Ready {
                value: annual_value(profile, i32::from(*year), value)?
            }))
        }
    }
}
