//! Independent work-credit/target reports, without legal or salary readiness.
use super::{
    computation::{Computation, capture_metrics},
    records::ReportRecords,
};
use crate::calendar::window::CalendarRecordSource;
use crate::{
    EngineError,
    calendar::recurrence::CollationRanks,
    credit::{
        analysis,
        context::{DailyCreditContextCache, DailyCreditError},
        duty,
        summary::{self, MetricsError, MonthlySummaryBasis},
    },
    employment::{EmploymentError, profile_view::CalculationProfileStore},
    rules::RuleResolver,
    target::{PreparedTargetSource, TargetPreparationStats},
};
use serde::Serialize;
use serde_json::{Value, json};
use std::{collections::VecDeque, sync::Arc};
const MAX_CACHE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ITEM_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTimeMonth {
    month_shifts: ReportRecords,
    summary: Computation<Value>,
    shift_type_analysis: Value,
}
impl NativeTimeMonth {
    pub fn summary(&self) -> &Computation<Value> {
        &self.summary
    }
    pub fn shift_type_analysis(&self) -> &Value {
        &self.shift_type_analysis
    }
}

#[derive(Debug)]
pub enum TimeReportError {
    InvalidYear,
    Metrics(MetricsError),
    Employment(EmploymentError),
    Core(super::core::AnnualCoreError),
}
impl std::fmt::Display for TimeReportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidYear => f.write_str("Ungültiges Berichtsjahr."),
            Self::Metrics(e) => e.fmt(f),
            Self::Employment(e) => e.fmt(f),
            Self::Core(e) => e.fmt(f),
        }
    }
}
impl std::error::Error for TimeReportError {}
impl TimeReportError {
    pub fn source_error_name(&self) -> &'static str {
        match self {
            Self::Metrics(e) => e.source_error_name(),
            _ => "Error",
        }
    }
}
pub struct TimeReportContext {
    source: Arc<PreparedTargetSource>,
    profiles: CalculationProfileStore,
    entries: ReportRecords,
    resolver: Arc<RuleResolver>,
    collation: Arc<CollationRanks>,
    annual_cache: VecDeque<(i32, Arc<Value>, u64)>,
    annual_cache_bytes: u64,
    annual_computations: usize,
    month_cache: VecDeque<(String, Arc<NativeTimeMonth>, u64)>,
    month_cache_bytes: u64,
    month_computations: usize,
}
impl TimeReportContext {
    /// Native immutable record-owner seam. Source admission and live publication
    /// remain with the runtime; no calculated rows or Ready JSON are accepted.
    pub fn with_record_source<S: crate::calendar::window::CalendarRecordSource + 'static>(
        profile: Arc<Value>,
        source: Arc<PreparedTargetSource>,
        entries: S,
        resolver: Arc<RuleResolver>,
        collation: Arc<CollationRanks>,
    ) -> Result<Self, TimeReportError> {
        if !std::ptr::eq(profile.as_ref(), source.profile()) {
            return Err(TimeReportError::Metrics(MetricsError::Target(
                crate::target::TargetError::InvalidInput,
            )));
        }
        let profiles = CalculationProfileStore::new(Arc::clone(&profile))
            .map_err(TimeReportError::Employment)?;
        Ok(Self {
            source,
            profiles,
            entries: ReportRecords::new(entries),
            resolver,
            collation,
            annual_cache: VecDeque::new(),
            annual_cache_bytes: 0,
            annual_computations: 0,
            month_cache: VecDeque::new(),
            month_cache_bytes: 0,
            month_computations: 0,
        })
    }
    pub fn new(
        profile: Arc<Value>,
        entries: Arc<Vec<Value>>,
        resolver: Arc<RuleResolver>,
        collation: CollationRanks,
    ) -> Result<Self, TimeReportError> {
        let source = Arc::new(PreparedTargetSource::new(Arc::clone(&profile)));
        Self::with_source(profile, source, entries, resolver, collation)
    }
    /// Several native entry windows may share one snapshot's target owner.
    /// A different profile cannot borrow another snapshot's typed target cache.
    pub fn with_source(
        profile: Arc<Value>,
        source: Arc<PreparedTargetSource>,
        entries: Arc<Vec<Value>>,
        resolver: Arc<RuleResolver>,
        collation: CollationRanks,
    ) -> Result<Self, TimeReportError> {
        Self::with_shared_collation(profile, source, entries, resolver, Arc::new(collation))
    }
    /// Raw-calendar admission and every report use one comparison-string map.
    pub fn with_shared_collation(
        profile: Arc<Value>,
        source: Arc<PreparedTargetSource>,
        entries: Arc<Vec<Value>>,
        resolver: Arc<RuleResolver>,
        collation: Arc<CollationRanks>,
    ) -> Result<Self, TimeReportError> {
        Self::with_record_source(profile, source, entries, resolver, collation)
    }
    pub fn preparation_stats(&self) -> TargetPreparationStats {
        self.source.stats()
    }
    pub fn annual_computations(&self) -> usize {
        self.annual_computations
    }
    pub fn month_computations(&self) -> usize {
        self.month_computations
    }
    fn cached_month(&mut self, month: &str) -> Option<Arc<NativeTimeMonth>> {
        let index = self.month_cache.iter().position(|(key, ..)| key == month)?;
        let entry = self.month_cache.remove(index).expect("located month");
        let result = Arc::clone(&entry.1);
        self.month_cache.push_back(entry);
        Some(result)
    }
    fn retain_month(&mut self, month: &str, value: NativeTimeMonth) -> Arc<NativeTimeMonth> {
        let result = Arc::new(value);
        self.month_computations = self.month_computations.saturating_add(1);
        let Some(bytes) = super::cache_budget::serialized_bytes(result.as_ref(), MAX_ITEM_BYTES)
        else {
            return result;
        };
        while self.month_cache.len() >= 24 || self.month_cache_bytes + bytes > MAX_CACHE_BYTES {
            let (_, _, old_bytes) = self.month_cache.pop_front().expect("nonempty over budget");
            self.month_cache_bytes -= old_bytes;
        }
        self.month_cache
            .push_back((month.into(), Arc::clone(&result), bytes));
        self.month_cache_bytes += bytes;
        result
    }
    pub fn month_shared(&mut self, month: &str) -> Result<Arc<NativeTimeMonth>, TimeReportError> {
        crate::calendar::parse_date(&format!("{month}-01"))
            .map_err(MetricsError::from)
            .map_err(TimeReportError::Metrics)?;
        if let Some(result) = self.cached_month(month) {
            return Ok(result);
        }
        let effective = self
            .profiles
            .at(&format!("{month}-01"))
            .map_err(TimeReportError::Employment)?;
        let (entries, shifts) =
            select_monthly_entries(month, &self.entries).map_err(TimeReportError::Metrics)?;
        let mut cache = DailyCreditContextCache::with_source(&self.source, &self.resolver);
        let summary = cache
            .target_profile_at(&format!("{month}-01"))
            .map_err(MetricsError::from)
            .and_then(|basis| {
                let pay = crate::pay::special::calculate_special_duty_pay_refs(
                    month,
                    &shifts.physical().collect::<Vec<_>>(),
                    &effective.calculation,
                    &self.resolver,
                )?;
                summary::calculate_monthly_summary_refs_prepared_with_basis(
                    month,
                    &shifts.physical().collect::<Vec<_>>(),
                    &mut cache,
                    MonthlySummaryBasis {
                        profile: &basis,
                        context: None,
                    },
                    &self.collation,
                    &pay,
                )
            });
        let summary = capture_metrics(summary).map_err(TimeReportError::Metrics)?;
        let analysis = if summary.value().is_some() {
            analysis::monthly_shift_type_analysis_records_prepared(
                month,
                &entries.records().collect::<Vec<_>>(),
                &mut cache,
                &self.collation,
            )
        } else {
            analysis::monthly_timed_shift_type_analysis_records(
                month,
                &entries.records().collect::<Vec<_>>(),
                &effective.calculation,
                &self.collation,
            )
        }
        .map_err(TimeReportError::Metrics)?;
        Ok(self.retain_month(
            month,
            NativeTimeMonth {
                month_shifts: shifts,
                summary,
                shift_type_analysis: analysis,
            },
        ))
    }
    pub fn annual(&mut self, year: i32) -> Result<Value, TimeReportError> {
        self.annual_shared(year).map(|value| value.as_ref().clone())
    }
    /// Retained native result for one immutable source. UI adapters never
    /// supply a calculated annual object, and repeated navigation does no work.
    pub fn annual_shared(&mut self, year: i32) -> Result<Arc<Value>, TimeReportError> {
        if !(1900..=4099).contains(&year) {
            return Err(TimeReportError::InvalidYear);
        }
        if let Some(index) = self
            .annual_cache
            .iter()
            .position(|(cached, ..)| *cached == year)
        {
            let item = self
                .annual_cache
                .remove(index)
                .expect("located cache entry");
            let value = Arc::clone(&item.1);
            self.annual_cache.push_back(item);
            return Ok(value);
        }
        let result = Arc::new(self.compute_annual(year)?);
        self.annual_computations += 1;
        let Some(bytes) = super::cache_budget::serialized_bytes(result.as_ref(), MAX_ITEM_BYTES)
        else {
            return Ok(result);
        };
        while self.annual_cache.len() >= 3 || self.annual_cache_bytes + bytes > MAX_CACHE_BYTES {
            let (_, _, old_bytes) = self.annual_cache.pop_front().expect("nonempty over budget");
            self.annual_cache_bytes -= old_bytes;
        }
        self.annual_cache
            .push_back((year, Arc::clone(&result), bytes));
        self.annual_cache_bytes += bytes;
        Ok(result)
    }
    fn compute_annual(&mut self, year: i32) -> Result<Value, TimeReportError> {
        if !(1900..=4099).contains(&year) {
            return Err(TimeReportError::InvalidYear);
        }
        let core = super::core::build_annual_core_report_records(
            year,
            &self.entries.records().collect::<Vec<_>>(),
            self.source.profile(),
            &self.collation,
        )
        .map_err(TimeReportError::Core)?;
        let source = Arc::clone(&self.source);
        let resolver = Arc::clone(&self.resolver);
        let mut cache = DailyCreditContextCache::with_source(&source, &resolver);
        let mut months = Vec::with_capacity(12);
        let mut analyses = Vec::with_capacity(12);
        let (mut target, mut credited) = (0.0, 0.0);
        let mut complete = true;
        for core_month in core["months"]
            .as_array()
            .ok_or(TimeReportError::InvalidYear)?
        {
            let month = core_month["month"]
                .as_str()
                .ok_or(TimeReportError::InvalidYear)?;
            let prepared = self.month_for_annual(month, &mut cache)?;
            let summary = prepared.as_ref().and_then(|month| month.summary.value());
            let mut row = json!({"month":month,"entryCount":core_month["entryCount"],"targetMinutes":null,"actualMinutes":core_month["actualMinutes"],"balanceMinutes":null});
            if let Some(summary) = summary {
                analyses.push(
                    prepared
                        .as_ref()
                        .expect("known month")
                        .shift_type_analysis
                        .clone(),
                );
                target += number(summary, "targetMinutes")?;
                credited += number(summary, "actualMinutes")?;
                row["targetMinutes"] = summary["targetMinutes"].clone();
                row["actualMinutes"] = summary["actualMinutes"].clone();
                if let Some(status) = summary
                    .get("targetCalculation")
                    .and_then(|v| v.get("status"))
                {
                    row["targetStatus"] = status.clone();
                }
                if let Some(minutes) = summary.get("timeAccountMinutes") {
                    row["timeAccountMinutes"] = minutes.clone();
                }
                if summary
                    .get("specialDutyNotes")
                    .and_then(Value::as_array)
                    .is_none_or(Vec::is_empty)
                {
                    row["balanceMinutes"] = summary["balanceMinutes"].clone();
                }
            } else {
                complete = false;
            }
            months.push(row);
        }
        let actual = if complete {
            credited
        } else {
            number(&core, "actualMinutes")?
        };
        let has_account = months.iter().any(|m| m.get("timeAccountMinutes").is_some());
        let balance = if complete && months.iter().all(|m| !m["balanceMinutes"].is_null()) {
            Some(if has_account {
                months.iter().try_fold(0.0, |sum, m| {
                    Ok::<_, TimeReportError>(sum + number(m, "balanceMinutes")?)
                })?
            } else {
                actual - target
            })
        } else {
            None
        };
        let mut result = core
            .as_object()
            .ok_or(TimeReportError::InvalidYear)?
            .iter()
            .filter(|(k, _)| {
                [
                    "year",
                    "workMinutes",
                    "trainingMinutes",
                    "vacationDays",
                    "sickDays",
                    "freeDays",
                    "entryCount",
                    "activeMonthCount",
                    "distribution",
                ]
                .contains(&k.as_str())
            })
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect::<serde_json::Map<_, _>>();
        result.insert("months".into(), json!(months));
        result.insert("actualMinutes".into(), json!(actual));
        result.insert(
            "targetMinutes".into(),
            if complete { json!(target) } else { Value::Null },
        );
        if !complete {
            result.insert("targetStatus".into(), json!("UNAVAILABLE"));
        } else if months.iter().any(|m| m["targetStatus"] == "PROVISIONAL") {
            result.insert("targetStatus".into(), json!("PROVISIONAL"));
        } else if self.source.profile().get("workingTimeTarget").is_some() {
            result.insert("targetStatus".into(), json!("FINAL"));
        }
        result.insert("balanceMinutes".into(), json!(balance));
        if has_account {
            let account = if complete
                && months
                    .iter()
                    .all(|m| m.get("timeAccountMinutes").is_none_or(|v| !v.is_null()))
            {
                Some(months.iter().try_fold(0.0, |sum, m| {
                    Ok::<_, TimeReportError>(
                        sum + number(
                            m,
                            if m.get("timeAccountMinutes").is_some() {
                                "timeAccountMinutes"
                            } else {
                                "actualMinutes"
                            },
                        )?,
                    )
                })?)
            } else {
                None
            };
            result.insert("timeAccountMinutes".into(), json!(account));
        }
        result.insert(
            "shiftTypeAnalysis".into(),
            if complete {
                analysis::combine_shift_type_analyses(&analyses)
                    .map_err(TimeReportError::Metrics)?
            } else {
                core["shiftTypeAnalysis"].clone()
            },
        );
        result.insert("worktimeCoverageComplete".into(), json!(complete));
        Ok(Value::Object(result))
    }
    fn month_for_annual(
        &mut self,
        month: &str,
        cache: &mut DailyCreditContextCache<'_>,
    ) -> Result<Option<Arc<NativeTimeMonth>>, TimeReportError> {
        if let Some(month) = self.cached_month(month) {
            return Ok(Some(month));
        }
        let effective = self
            .profiles
            .at(&format!("{month}-01"))
            .map_err(TimeReportError::Employment)?;
        let (entries, shifts) =
            select_monthly_entries(month, &self.entries).map_err(TimeReportError::Metrics)?;
        let monthly = cache
            .target_profile_at(&format!("{month}-01"))
            .map_err(MetricsError::from)
            .and_then(|basis| {
                let pay = crate::pay::special::calculate_special_duty_pay_refs(
                    month,
                    &shifts.physical().collect::<Vec<_>>(),
                    &effective.calculation,
                    &self.resolver,
                )?;
                summary::calculate_monthly_summary_refs_prepared_with_basis(
                    month,
                    &shifts.physical().collect::<Vec<_>>(),
                    cache,
                    MonthlySummaryBasis {
                        profile: &basis,
                        context: None,
                    },
                    &self.collation,
                    &pay,
                )
            });
        let summary = match monthly {
            Ok(value) => value,
            Err(error) if unavailable(&error) => return Ok(None),
            Err(error) => return Err(TimeReportError::Metrics(error)),
        };
        let analysis = analysis::monthly_shift_type_analysis_records_prepared(
            month,
            &entries.records().collect::<Vec<_>>(),
            cache,
            &self.collation,
        )
        .map_err(TimeReportError::Metrics)?;
        Ok(Some(self.retain_month(
            month,
            NativeTimeMonth {
                month_shifts: shifts,
                summary: Computation::Ready(summary),
                shift_type_analysis: analysis,
            },
        )))
    }
}

fn number(value: &Value, key: &str) -> Result<f64, TimeReportError> {
    value[key]
        .as_f64()
        .filter(|n| n.is_finite())
        .ok_or(TimeReportError::Metrics(MetricsError::Calculation(
            EngineError::InvalidDuration,
        )))
}
fn unavailable(error: &MetricsError) -> bool {
    matches!(
        error,
        MetricsError::Target(_) | MetricsError::Daily(DailyCreditError::Target(_))
    )
}
fn select_monthly_entries(
    month: &str,
    entries: &ReportRecords,
) -> Result<(ReportRecords, ReportRecords), MetricsError> {
    let prefix = format!("{month}-");
    let (mut selected, mut shifts) = (Vec::new(), Vec::new());
    for (index, record) in entries.records().enumerate() {
        let entry = record.base_value();
        if entry.get("deletedAt") != Some(&Value::Null) {
            continue;
        }
        let in_month = if entry["kind"] == "SHIFT"
            && entry
                .get("specialDuty")
                .is_some_and(|v| !v.is_null() && v != &Value::Bool(false))
        {
            duty::duty_calendar_dates(entry)?
                .iter()
                .any(|date| date.starts_with(&prefix))
        } else {
            entry["date"]
                .as_str()
                .ok_or(EngineError::InvalidCalendarEntry)?
                .starts_with(&prefix)
        };
        if in_month {
            selected.push(index);
            if entry["kind"] == "SHIFT" {
                shifts.push(index);
            }
        }
    }
    Ok((
        entries
            .select(selected)
            .ok_or(EngineError::InvalidCalendarEntry)?,
        entries
            .select(shifts)
            .ok_or(EngineError::InvalidCalendarEntry)?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn context() -> TimeReportContext {
        TimeReportContext::new(
            Arc::new(json!({"timeZone":"Europe/Berlin","federalState":"NW","holidayRegion":"NONE","weeklyMinutes":1200})),
            Arc::new(vec![]),
            Arc::new(RuleResolver::bundled().unwrap()),
            CollationRanks::default(),
        ).unwrap()
    }
    fn value(bytes: usize) -> NativeTimeMonth {
        NativeTimeMonth {
            month_shifts: ReportRecords::new(Arc::new(Vec::<Value>::new())),
            summary: Computation::Ready(json!({"actualMinutes":0})),
            shift_type_analysis: json!({"opaque": "x".repeat(bytes)}),
        }
    }
    #[test]
    fn retained_month_outputs_have_independent_count_total_byte_and_item_limits() {
        let mut count = context();
        for index in 0..30 {
            count.retain_month(
                &format!("{}-{:02}", 2024 + index / 12, index % 12 + 1),
                value(0),
            );
        }
        assert_eq!(count.month_cache.len(), 24);
        assert!(count.cached_month("2024-01").is_none());
        let latest = count.cached_month("2026-06").unwrap();
        assert!(Arc::ptr_eq(
            &latest,
            &count.cached_month("2026-06").unwrap()
        ));
        let mut bytes = context();
        for index in 1..=6 {
            bytes.retain_month(&format!("2026-{index:02}"), value(3 * 1024 * 1024));
        }
        assert!(bytes.month_cache.len() < 6);
        assert!(bytes.month_cache_bytes <= MAX_CACHE_BYTES);
        assert!(bytes.cached_month("2026-01").is_none());
        let entries = bytes.month_cache.len();
        let retained_bytes = bytes.month_cache_bytes;
        let oversized = bytes.retain_month("2027-01", value(MAX_ITEM_BYTES as usize + 1));
        assert!(
            super::super::cache_budget::serialized_bytes(oversized.as_ref(), MAX_ITEM_BYTES)
                .is_none()
        );
        assert!(bytes.cached_month("2027-01").is_none());
        assert_eq!(bytes.month_cache.len(), entries);
        assert_eq!(bytes.month_cache_bytes, retained_bytes);
    }
}
