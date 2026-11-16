//! Constructs daily credit inputs from shared native employment and target rules.
use super::{
    daily::{CreditResult, DailyCreditContext, DailyWorkCredit, calculate_daily_work_credit},
    string,
};
use crate::{
    EngineError,
    calendar::{parse_date, recurrence::CollationRanks},
    employment::{self, EmploymentError},
    rules::RuleResolver,
    target::{
        self, AdjustmentKind, MonthlyTarget, PreparedTargetContext, PreparedTargetProfile,
        PreparedTargetSource, TargetError, TargetPreparationStats, TargetProfile, TargetSource,
    },
};
use bigdecimal::BigDecimal;
use serde::Deserialize;
use serde_json::Value;
use std::{fmt, sync::Arc};

#[derive(Debug)]
pub enum DailyCreditError {
    Employment(EmploymentError),
    Target(TargetError),
    Calculation(EngineError),
}

impl fmt::Display for DailyCreditError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Employment(error) => fmt::Display::fmt(error, f),
            Self::Target(error) => fmt::Display::fmt(error, f),
            Self::Calculation(error) => fmt::Display::fmt(error, f),
        }
    }
}
impl std::error::Error for DailyCreditError {}
impl From<EmploymentError> for DailyCreditError {
    fn from(error: EmploymentError) -> Self {
        Self::Employment(error)
    }
}
impl From<TargetError> for DailyCreditError {
    fn from(error: TargetError) -> Self {
        Self::Target(error)
    }
}
impl From<EngineError> for DailyCreditError {
    fn from(error: EngineError) -> Self {
        Self::Calculation(error)
    }
}

#[derive(Debug, Clone)]
pub struct ResolvedDailyCreditContext {
    pub context: DailyCreditContext,
    pub time_zone: String,
}

struct TargetBasisKey {
    month: String,
    state: String,
    weekly_minutes: i64,
    region: Option<String>,
    input: Option<usize>,
    override_context: Option<PreparedTargetContext>,
}
impl TargetBasisKey {
    fn same_basis(&self, other: &Self) -> bool {
        self.month == other.month
            && self.state == other.state
            && self.weekly_minutes == other.weekly_minutes
            && self.region == other.region
            && self.input == other.input
            && match (&self.override_context, &other.override_context) {
                (None, None) => true,
                (Some(a), Some(b)) => a.same_source(b),
                _ => false,
            }
    }
}
struct CachedTargetBasis {
    key: TargetBasisKey,
    profile: PreparedTargetProfile,
    target: Arc<MonthlyTarget>,
    absence_reference: Option<Arc<MonthlyTarget>>,
}
enum TargetInputs<'a> {
    Local(TargetSource<'a>),
    Shared(&'a PreparedTargetSource),
}
impl TargetInputs<'_> {
    fn source(&self) -> &TargetSource<'_> {
        match self {
            Self::Local(source) => source,
            Self::Shared(source) => source,
        }
    }
}
/// One immutable source input is parsed/indexed independently of its monthly
/// results. A shared source may outlive individual month/day report requests.
pub struct DailyCreditContextCache<'a> {
    profile: &'a Value,
    resolver: &'a RuleResolver,
    inputs: TargetInputs<'a>,
    bases: Vec<CachedTargetBasis>,
}
impl<'a> DailyCreditContextCache<'a> {
    pub fn new(profile: &'a Value, resolver: &'a RuleResolver) -> Self {
        Self {
            profile,
            resolver,
            inputs: TargetInputs::Local(TargetSource::borrowed(profile)),
            bases: vec![],
        }
    }
    pub fn with_source(source: &'a PreparedTargetSource, resolver: &'a RuleResolver) -> Self {
        Self {
            profile: source.profile(),
            resolver,
            inputs: TargetInputs::Shared(source),
            bases: vec![],
        }
    }
    pub fn profile(&self) -> &'a Value {
        self.profile
    }
    pub fn resolver(&self) -> &'a RuleResolver {
        self.resolver
    }
    pub fn preparation_stats(&self) -> TargetPreparationStats {
        self.inputs.source().stats()
    }
    pub fn cached_basis_count(&self) -> usize {
        self.bases.len()
    }
    /// Month headers use employment at the first day, while daily credits use
    /// each day's employment. Both retain the original source-bound target.
    pub fn target_profile_at(&self, date: &str) -> Result<PreparedTargetProfile, DailyCreditError> {
        parse_date(date)?;
        let overlay = employment::employment_overlay_at(self.profile, date)?;
        let field = |key| {
            overlay
                .and_then(|v| v.get(key))
                .or_else(|| self.profile.get(key))
        };
        let state = field("federalState")
            .and_then(Value::as_str)
            .ok_or(TargetError::InvalidInput)?;
        let weekly = field("weeklyMinutes")
            .and_then(Value::as_i64)
            .ok_or(TargetError::InvalidInput)?;
        let region = match field("holidayRegion") {
            None | Some(Value::Null) => None,
            Some(v) => Some(v.as_str().ok_or(TargetError::InvalidInput)?),
        };
        Ok(self.inputs.source().profile_fields(
            state,
            weekly,
            region,
            field("workingTimeTarget"),
        )?)
    }
    pub(crate) fn monthly_target_with_basis(
        &mut self,
        month: &str,
        basis: &PreparedTargetProfile,
        context: Option<&PreparedTargetContext>,
    ) -> Result<Arc<MonthlyTarget>, DailyCreditError> {
        if !self.inputs.source().owns_profile(basis) {
            return Err(TargetError::InvalidInput.into());
        }
        let index = self.basis(month, basis.clone(), context)?;
        Ok(Arc::clone(&self.bases[index].target))
    }
    fn basis(
        &mut self,
        month: &str,
        profile: PreparedTargetProfile,
        context: Option<&PreparedTargetContext>,
    ) -> Result<usize, DailyCreditError> {
        // Status/month/profile guards run before a computed-result cache lookup.
        profile.validate_request(month)?;
        let p = profile.profile();
        let key = TargetBasisKey {
            month: month.into(),
            state: p.federal_state.clone(),
            weekly_minutes: p.weekly_minutes,
            region: p.holiday_region.clone(),
            input: profile.input_identity(),
            override_context: context.cloned(),
        };
        if let Some(index) = self
            .bases
            .iter()
            .position(|basis| basis.key.same_basis(&key))
        {
            return Ok(index);
        }
        let target = Arc::new(profile.calculate(month, self.resolver, context)?);
        self.bases.push(CachedTargetBasis {
            key,
            profile,
            target,
            absence_reference: None,
        });
        Ok(self.bases.len() - 1)
    }
    pub fn base_monthly_target(
        &mut self,
        month: &str,
        context: Option<&PreparedTargetContext>,
    ) -> Result<Arc<MonthlyTarget>, DailyCreditError> {
        let profile = self.inputs.source().base_profile()?;
        let index = self.basis(month, profile, context)?;
        Ok(Arc::clone(&self.bases[index].target))
    }
    pub(crate) fn base_monthly_target_borrowed(
        &mut self,
        month: &str,
        context: Option<&target::TargetContext>,
    ) -> Result<Arc<MonthlyTarget>, DailyCreditError> {
        if context.is_some() {
            let profile = self.inputs.source().base_profile()?;
            Ok(Arc::new(profile.calculate_borrowed_context(
                month,
                self.resolver,
                context,
            )?))
        } else {
            self.base_monthly_target(month, None)
        }
    }
    fn absence_reference(&mut self, index: usize) -> Result<Arc<MonthlyTarget>, DailyCreditError> {
        if let Some(reference) = &self.bases[index].absence_reference {
            return Ok(Arc::clone(reference));
        }
        let basis = &self.bases[index];
        let reference = if basis.profile.profile().working_time_target.is_none()
            && basis.key.override_context.is_none()
        {
            Arc::clone(&basis.target)
        } else {
            Arc::new(basis.profile.without_input().calculate(
                &basis.key.month,
                self.resolver,
                None,
            )?)
        };
        self.bases[index].absence_reference = Some(Arc::clone(&reference));
        Ok(reference)
    }
    pub fn resolve(&mut self, date: &str) -> Result<ResolvedDailyCreditContext, DailyCreditError> {
        let day = parse_date(date)?;
        let overlay = employment::employment_overlay_at(self.profile, date)?;
        let field = |key| {
            overlay
                .and_then(|v| v.get(key))
                .or_else(|| self.profile.get(key))
        };
        let state = field("federalState")
            .and_then(Value::as_str)
            .ok_or(TargetError::InvalidInput)?;
        let weekly = field("weeklyMinutes")
            .and_then(Value::as_i64)
            .ok_or(TargetError::InvalidInput)?;
        let region = match field("holidayRegion") {
            None | Some(Value::Null) => None,
            Some(v) => Some(v.as_str().ok_or(TargetError::InvalidInput)?),
        };
        let time_zone = field("timeZone")
            .and_then(Value::as_str)
            .ok_or(TargetError::InvalidInput)?
            .to_owned();
        let profile = self.inputs.source().profile_fields(
            state,
            weekly,
            region,
            field("workingTimeTarget"),
        )?;
        let index = self.basis(&date[..7], profile, None)?;
        target::require_target_minutes(&self.bases[index].target)?;
        let minutes = self.bases[index]
            .target
            .days
            .iter()
            .find(|d| d.date == date)
            .and_then(|d| d.target_minutes)
            .ok_or(TargetError::TargetUnavailable)?;
        let reference = self.absence_reference(index)?;
        let absence = if day.weekday().to_monday_one_offset() <= 5
            && !reference
                .adjustments
                .iter()
                .any(|a| a.date == date && a.kind == AdjustmentKind::StatutoryHoliday)
        {
            weekly
                .checked_add(2)
                .ok_or(TargetError::InvalidInput)?
                .div_euclid(5)
        } else {
            0
        };
        Ok(ResolvedDailyCreditContext {
            context: DailyCreditContext {
                target_minutes: BigDecimal::from(minutes),
                absence_reference_minutes: BigDecimal::from(absence),
            },
            time_zone,
        })
    }
    pub fn calculate(
        &mut self,
        date: &str,
        entries: &[Value],
        collation: &CollationRanks,
    ) -> Result<CreditResult<DailyWorkCredit>, DailyCreditError> {
        let resolved = self.resolve(date)?;
        Ok(calculate_daily_work_credit(
            date,
            entries,
            &resolved.time_zone,
            &resolved.context,
            collation,
        )?)
    }
    pub fn calculate_prepared(
        &mut self,
        date: &str,
        entries: &super::prepared::PreparedCreditEntries<'_>,
        collation: &CollationRanks,
    ) -> Result<CreditResult<DailyWorkCredit>, DailyCreditError> {
        let resolved = self.resolve(date)?;
        Ok(super::daily::calculate_daily_work_credit_prepared(
            date,
            entries,
            &resolved.time_zone,
            &resolved.context,
            collation,
        )?)
    }
    pub fn summary_prepared(
        &mut self,
        date: &str,
        entries: &super::prepared::PreparedCreditEntries<'_>,
        collation: &CollationRanks,
    ) -> Result<DailyWorkCredit, DailyCreditError> {
        let resolved = self.resolve(date)?;
        Ok(super::daily::calculate_daily_work_credit_summary_prepared(
            date,
            entries,
            &resolved.time_zone,
            &resolved.context,
            collation,
        )?)
    }
    pub fn calculate_borrowed_prepared<'b>(
        &mut self,
        date: &str,
        entries: &'b super::prepared::PreparedCreditEntries<'_>,
        collation: &CollationRanks,
    ) -> Result<super::daily::BorrowedCreditResult<'b, DailyWorkCredit>, DailyCreditError> {
        let resolved = self.resolve(date)?;
        Ok(super::daily::calculate_daily_work_credit_borrowed_prepared(
            date,
            entries,
            &resolved.time_zone,
            &resolved.context,
            collation,
        )?)
    }
}

/// Resolve both the contractual target and the separate paid-absence reference.
/// Missing target/history data propagates an error; it never becomes zero or READY.
pub fn resolve_daily_credit_context(
    date: &str,
    effective_profile: &Value,
    resolver: &RuleResolver,
) -> Result<ResolvedDailyCreditContext, TargetError> {
    let day = parse_date(date).map_err(|_| TargetError::InvalidInput)?;
    let profile: TargetProfile =
        TargetProfile::deserialize(effective_profile).map_err(|_| TargetError::InvalidInput)?;
    let target =
        target::calculate_monthly_working_time_target(&date[..7], &profile, resolver, None)?;
    target::require_target_minutes(&target)?;
    let minutes = target
        .days
        .iter()
        .find(|value| value.date == date)
        .and_then(|value| value.target_minutes)
        .ok_or(TargetError::TargetUnavailable)?;
    let basic = TargetProfile {
        federal_state: profile.federal_state,
        weekly_minutes: profile.weekly_minutes,
        holiday_region: profile.holiday_region,
        working_time_target: None,
    };
    let reference =
        target::calculate_monthly_working_time_target(&date[..7], &basic, resolver, None)?;
    let absence_reference = if day.weekday().to_monday_one_offset() <= 5
        && !reference.adjustments.iter().any(|adjustment| {
            adjustment.date == date && adjustment.kind == AdjustmentKind::StatutoryHoliday
        }) {
        basic
            .weekly_minutes
            .checked_add(2)
            .ok_or(TargetError::InvalidInput)?
            .div_euclid(5)
    } else {
        0
    };
    Ok(ResolvedDailyCreditContext {
        context: DailyCreditContext {
            target_minutes: BigDecimal::from(minutes),
            absence_reference_minutes: BigDecimal::from(absence_reference),
        },
        time_zone: string(effective_profile, "timeZone")
            .map_err(|_| TargetError::InvalidInput)?
            .to_owned(),
    })
}

pub fn calculate_daily_work_credit_from_resolved_profile(
    date: &str,
    entries: &[Value],
    effective_profile: &Value,
    resolver: &RuleResolver,
    collation: &CollationRanks,
) -> Result<CreditResult<DailyWorkCredit>, DailyCreditError> {
    let resolved = resolve_daily_credit_context(date, effective_profile, resolver)?;
    Ok(calculate_daily_work_credit(
        date,
        entries,
        &resolved.time_zone,
        &resolved.context,
        collation,
    )?)
}

/// Select dated employment, construct both references, then allocate work.
/// No precomputed TypeScript calculation result is required.
pub fn calculate_daily_work_credit_from_profile(
    date: &str,
    entries: &[Value],
    profile: &Value,
    resolver: &RuleResolver,
    collation: &CollationRanks,
) -> Result<CreditResult<DailyWorkCredit>, DailyCreditError> {
    let effective = employment::employment_profile_at(profile, date)?;
    calculate_daily_work_credit_from_resolved_profile(
        date, entries, &effective, resolver, collation,
    )
}

#[cfg(test)]
mod cache_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn unchanged_month_reuses_one_native_target_basis() {
        let profile = json!({"federalState":"NW","holidayRegion":"NONE","weeklyMinutes":2311,"timeZone":"Europe/Berlin"});
        let resolver = RuleResolver::bundled().unwrap();
        let mut cache = DailyCreditContextCache::new(&profile, &resolver);
        for day in 1..=31 {
            cache.resolve(&format!("2026-07-{day:02}")).unwrap();
        }
        assert_eq!(cache.bases.len(), 1);
    }

    #[test]
    fn dated_employment_keeps_distinct_native_target_bases() {
        let profile = json!({"federalState":"NW","holidayRegion":"NONE","weeklyMinutes":2310,"timeZone":"Europe/Berlin","employmentTimeline":[{"effectiveFrom":"2026-01-01","employment":{"weeklyMinutes":1200}},{"effectiveFrom":"2026-07-16","employment":{"weeklyMinutes":1800}}]});
        let resolver = RuleResolver::bundled().unwrap();
        let mut cache = DailyCreditContextCache::new(&profile, &resolver);
        assert_eq!(
            cache.resolve("2026-07-10").unwrap().context.target_minutes,
            BigDecimal::from(240)
        );
        assert_eq!(
            cache.resolve("2026-07-20").unwrap().context.target_minutes,
            BigDecimal::from(360)
        );
        assert_eq!(cache.bases.len(), 2);
    }

    #[test]
    fn explicit_null_overlay_cannot_fall_back_to_current_profile() {
        let profile = json!({"federalState":"NW","holidayRegion":"NONE","weeklyMinutes":2310,"timeZone":"Europe/Berlin","employmentTimeline":[{"effectiveFrom":"2026-01-01","employment":{"timeZone":null}}]});
        let resolver = RuleResolver::bundled().unwrap();
        assert!(
            DailyCreditContextCache::new(&profile, &resolver)
                .resolve("2026-07-10")
                .is_err()
        );
    }

    #[test]
    fn unrelated_employment_changes_reuse_the_original_saved_context() {
        let profile = json!({"federalState":"NW","holidayRegion":"NONE","weeklyMinutes":1200,"timeZone":"Europe/Berlin","workingTimeTarget":{"status":"ready","mode":"FORECAST","notices":[],"context":{"periods":[{"validFrom":"2026-01-01","validTo":null,"weeklyMinutes":1200,"federalState":"NW","holidayRegion":"NONE","model":{"kind":"FIXED_WEEK","weekdayMinutes":[240,240,240,240,240,0,0]},"tariff":{"kind":"TVOED_K","version":"2026-01-01","scopeConfirmed":true}}],"days":[]}},"employmentTimeline":[{"effectiveFrom":"2026-01-01","employment":{"timeZone":"Europe/Berlin"}},{"effectiveFrom":"2026-07-16","employment":{"timeZone":"Etc/UTC"}}]});
        let resolver = RuleResolver::bundled().unwrap();
        let mut cache = DailyCreditContextCache::new(&profile, &resolver);
        assert_eq!(
            cache.resolve("2026-07-10").unwrap().time_zone,
            "Europe/Berlin"
        );
        assert_eq!(cache.resolve("2026-07-20").unwrap().time_zone, "Etc/UTC");
        assert_eq!(cache.bases.len(), 1);
    }
}
