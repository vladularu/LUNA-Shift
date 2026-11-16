//! Direct artifact work on the existing Finance job; recorded provider input
//! and native snapshot profile/target/catalog owners, no additional source.
use super::calculation_profile_from_facts;
use crate::{
    contract::{
        ReportPeriod, SourceKind,
        export_report::{ExportFormat, ExportIntent, ExportLayout, ExportProfileRole},
    },
    input::finance_rows::{RawNetPayTimeline, RawSalaryPaymentPreferences},
    report::{
        export_document::{build::build_artifact_document, model::ReportInput},
        export_pdf::model::{PdfLayout, PdfOptions},
    },
    runtime::{facts::SnapshotFacts, report::ReportIssue},
};
use serde_json::{Value, json};
use std::sync::Arc;
pub fn calculate(
    facts: &SnapshotFacts,
    period: &ReportPeriod,
    intent: &ExportIntent,
) -> Result<Value, ReportIssue> {
    let unavailable = || ReportIssue::new("EXPORT_UNAVAILABLE");
    let period = match period {
        ReportPeriod::Month { month } => month.clone(),
        ReportPeriod::Year { year } => year.to_string(),
    };
    let env = facts.profile_clock_environment()?.ok_or_else(unavailable)?;
    let provided = env
        .editor_profile(super::state(facts, SourceKind::WorkPatternSettings))?
        .ok_or_else(unavailable)?;
    let profile = if intent.profile_role == ExportProfileRole::Calculation {
        calculation_profile_from_facts(facts).map_err(|_| unavailable())?
    } else {
        Arc::clone(&provided)
    };
    let resolver = Arc::clone(facts.catalog()?.resolver());
    let pattern = facts.work_pattern()?;
    let decisions = facts.tariff_decisions()?;
    let tests = facts.test_months()?;
    let youth = facts.youth_preference()?;
    let with_salary = intent.format == ExportFormat::Pdf && intent.include_salary;
    let timeline = if with_salary {
        Some(
            RawNetPayTimeline::try_from_rows(Arc::clone(intent.net_settings_rows()))
                .map_err(|_| unavailable())?,
        )
    } else {
        None
    };
    let preference = if with_salary && period.len() == 4 {
        Some(
            RawSalaryPaymentPreferences::try_from_row(
                intent.salary_preference_row().map(|v| Arc::new(v.clone())),
            )
            .map_err(|_| unavailable())?,
        )
    } else {
        None
    };
    let zone = crate::time_zone::zone(profile["timeZone"].as_str().ok_or_else(unavailable)?)
        .map_err(|_| unavailable())?;
    let now = jiff::Timestamp::from_millisecond(intent.observed_epoch_milliseconds)
        .map_err(|_| unavailable())?
        .to_zoned(zone);
    let created = now.to_string();
    let reference = now.date().to_string();
    let input = ReportInput {
        period: &period,
        entries: Arc::clone(intent.entries()),
        profile,
        tariff_decisions: decisions.decisions(),
        work_pattern_settings: pattern.settings(),
        resolver,
        collation: Arc::clone(intent.ranks()),
        created_at: &created,
        reference_date: &reference,
        youth_protection: youth,
        test_months: tests.months(),
        net_pay_timeline: timeline
            .as_ref()
            .map_or(&[][..], |v| v.timeline().as_slice()),
        salary_payment_preferences: preference.as_ref().map(|v| v.preferences().as_ref()),
        net_pay_profile: Some(provided),
    };
    let document = build_artifact_document(&input).map_err(|_| unavailable())?;
    match intent.format {
        ExportFormat::Csv => Ok(
            json!({"format":"CSV","period":period,"text":document.to_csv(16*1024*1024).map_err(|_|unavailable())?}),
        ),
        ExportFormat::Pdf => Ok(
            json!({"format":"PDF","period":period,"plan":document.pdf_plan(PdfOptions{layout:if intent.layout==ExportLayout::Standard{PdfLayout::Standard}else{PdfLayout::Compact},include_salary:intent.include_salary}).map_err(|_|unavailable())?}),
        ),
    }
}
