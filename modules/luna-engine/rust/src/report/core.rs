//! Immediate annual timed facts. This path has no catalog/target/finance/check
//! readiness dependency and makes no claim that those sections are complete.
use crate::{
    EngineError,
    calendar::{
        recurrence::CollationRanks,
        window::{CalendarRecordRef, CalendarRecordSource},
    },
    credit::{analysis, metrics, summary::MetricsError},
};
use serde_json::{Value, json};

#[derive(Debug)]
pub enum AnnualCoreError {
    InvalidYear,
    Metrics(MetricsError),
}
impl From<MetricsError> for AnnualCoreError {
    fn from(value: MetricsError) -> Self {
        Self::Metrics(value)
    }
}
impl std::fmt::Display for AnnualCoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidYear => f.write_str("Ungültiges Berichtsjahr."),
            Self::Metrics(e) => std::fmt::Display::fmt(e, f),
        }
    }
}
impl std::error::Error for AnnualCoreError {}
fn number(value: &Value, key: &str) -> Result<f64, MetricsError> {
    value[key]
        .as_f64()
        .filter(|n| n.is_finite())
        .ok_or(EngineError::InvalidDuration.into())
}

/// `distribution` is an ordered entry array at the portable JSON boundary.
/// The thin UI adapter may reconstruct Map; it does not calculate its values.
pub fn build_annual_core_report(
    year: i32,
    entries: &[Value],
    profile: &Value,
    collation: &CollationRanks,
) -> Result<Value, AnnualCoreError> {
    let source = super::records::SliceRecords(entries);
    build_annual_core_report_records(
        year,
        &source.records().collect::<Vec<_>>(),
        profile,
        collation,
    )
}
pub fn build_annual_core_report_records(
    year: i32,
    entries: &[CalendarRecordRef<'_>],
    profile: &Value,
    collation: &CollationRanks,
) -> Result<Value, AnnualCoreError> {
    if !(1900..=4099).contains(&year) {
        return Err(AnnualCoreError::InvalidYear);
    }
    let mut parts = Vec::with_capacity(12);
    let mut months = Vec::with_capacity(12);
    let mut distribution = Vec::<(String, u64)>::new();
    let (mut actual, mut work, mut training) = (0.0, 0.0, 0.0);
    let (mut vacation, mut sick, mut free, mut count, mut active) = (0u64, 0u64, 0u64, 0u64, 0u64);
    for index in 1..=12 {
        let month = format!("{year}-{index:02}");
        let prefix = format!("{month}-");
        let mut selected = Vec::new();
        for entry in entries {
            if !entry.get("deletedAt").is_some_and(Value::is_null) {
                continue;
            }
            let date = entry["date"]
                .as_str()
                .ok_or(MetricsError::Calculation(EngineError::InvalidCalendarEntry))?;
            if date.starts_with(&prefix) {
                selected.push(*entry);
            }
        }
        let timed = analysis::monthly_timed_shift_type_analysis_records(
            &month, &selected, profile, collation,
        )?;
        let items = timed["items"]
            .as_array()
            .ok_or(MetricsError::Calculation(EngineError::InvalidCalendarEntry))?;
        let mut month_work = 0.0;
        for item in items {
            if !matches!(
                item["type"].as_str(),
                Some("TRAINING" | "VACATION" | "SICK" | "FREE")
            ) {
                month_work += number(item, "minutes")?;
            }
        }
        let month_training = items
            .iter()
            .find(|item| item["type"] == "TRAINING")
            .map(|item| number(item, "minutes"))
            .transpose()?
            .unwrap_or(0.0);
        let month_actual = month_work + month_training;
        for pair in metrics::shift_type_distribution_entries_refs(
            &month,
            &super::records::physical_refs(&selected),
        )?
        .as_array()
        .ok_or(MetricsError::Calculation(EngineError::InvalidCalendarEntry))?
        {
            let key = pair[0]
                .as_str()
                .ok_or(MetricsError::Calculation(EngineError::InvalidCalendarEntry))?;
            let amount = pair[1]
                .as_u64()
                .ok_or(MetricsError::Calculation(EngineError::InvalidCalendarEntry))?;
            if let Some((_, n)) = distribution.iter_mut().find(|(k, _)| k == key) {
                *n += amount;
            } else {
                distribution.push((key.to_owned(), amount));
            }
        }
        for entry in selected.iter().filter(|e| e["kind"] == "SHIFT") {
            match entry["type"].as_str() {
                Some("VACATION") => vacation += 1,
                Some("SICK") => sick += 1,
                Some("FREE") => free += 1,
                _ => {}
            }
        }
        actual += month_actual;
        work += month_work;
        training += month_training;
        count += selected.len() as u64;
        if !selected.is_empty() {
            active += 1;
        }
        parts.push(timed);
        months.push(json!({"month":month,"entryCount":selected.len(),"targetMinutes":null,"actualMinutes":month_actual,"balanceMinutes":null,"estimatedGrossAmount":null,"timePremiumAmount":null,"premiumAmount":0,"criticalCount":0,"warningCount":0}));
    }
    Ok(
        json!({"year":year,"shiftTypeAnalysis":analysis::combine_shift_type_analyses(&parts)?,"months":months,"targetMinutes":null,"actualMinutes":actual,"balanceMinutes":null,"workMinutes":work,"trainingMinutes":training,"vacationDays":vacation,"sickDays":sick,"freeDays":free,"entryCount":count,"activeMonthCount":active,"availablePayMonthCount":0,"estimatedGrossAmount":0,"premiumAmount":0,"overtimeAmount":0,"allowanceAmount":0,"criticalCount":0,"warningCount":0,"distribution":distribution,"worktimeCoverageComplete":false,"complianceCoverageComplete":false}),
    )
}
