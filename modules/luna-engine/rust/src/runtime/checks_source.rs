//! Snapshot-owned checks: raw facts and the explicit snapshot date are the only inputs.
use super::{
    facts::{FactError, SnapshotFacts},
    report::ReportIssue,
    sources::SourceReadError,
};
use crate::{
    calendar::recurrence::CollationRanks,
    compliance::{
        annual::{self, AnnualComplianceSource, AnnualTraining},
        dated::{self, PreparedDatedComplianceSource},
        model::ComplianceError,
        profile::ComplianceProfile,
    },
    contract::{ImmutableSnapshot, SourceKind},
    report::computation::Computation,
    rules::{RuleResolver, holidays::HolidayError},
    training::{self, PreparedTrainingProfiles, TrainingLoad, YouthSource},
};
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};
const MAX_CACHE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ITEM_BYTES: u64 = 4 * 1024 * 1024;
#[derive(Clone, PartialEq, Eq)]
enum Period {
    Month(String),
    Year(i32),
}
#[derive(Default)]
struct ReportCache {
    entries: VecDeque<(Period, Arc<Value>, u64)>,
    bytes: u64,
}
enum TrainingState {
    NotRequested,
    Unavailable {
        issues: Vec<ReportIssue>,
        loading: bool,
    },
    Ready {
        source: YouthSource,
        profiles: Arc<PreparedTrainingProfiles>,
    },
}
impl TrainingState {
    fn metadata(&self) -> Value {
        match self {
            Self::NotRequested => json!({"state":"NOT_REQUESTED"}),
            Self::Ready { .. } => json!({"state":"READY"}),
            Self::Unavailable { issues, .. } => {
                json!({"state":"UNAVAILABLE","reason":issues[0],"issues":issues})
            }
        }
    }
}
/// No Deserialize or public constructor accepting calculated facts. The source
/// keeps its immutable snapshot owner; dispatch separately guards publication.
pub struct ChecksSnapshotSource {
    snapshot: ImmutableSnapshot,
    profile: Arc<Value>,
    resolver: Arc<RuleResolver>,
    collation: Arc<CollationRanks>,
    annual: AnnualComplianceSource,
    training: TrainingState,
    youth_protection: bool,
    reports: Mutex<ReportCache>,
}
impl ChecksSnapshotSource {
    pub fn from_facts(facts: &SnapshotFacts) -> Result<Self, ReportIssue> {
        // Preferences are actual IO facts. Unknown must never silently mean false.
        let youth_protection = facts.youth_preference().map_err(ReportIssue::from)?;
        let profile = Arc::clone(
            facts
                .calculation_profile()
                .map_err(ReportIssue::from)?
                .ok_or_else(|| ReportIssue::new("PROFILE_MISSING"))?,
        );
        let calendar = facts.calendar().map_err(ReportIssue::from)?;
        let resolver = Arc::clone(facts.catalog().map_err(ReportIssue::from)?.resolver());
        let collation = Arc::clone(calendar.collation());
        // One immutable SHIFT source shared by adult/year/training preparation,
        // never a full profile/target clone for each date or reporting month.
        let shifts: Arc<[Value]> = calendar
            .entries()
            .iter()
            .filter(|v| v["kind"] == "SHIFT")
            .cloned()
            .collect::<Vec<_>>()
            .into();
        let annual = AnnualComplianceSource::with_shared_collation(
            Arc::clone(&shifts),
            Arc::clone(&profile),
            Arc::clone(&resolver),
            Arc::clone(&collation),
            facts.snapshot().reference_date().into(),
            youth_protection,
        )
        .map_err(|_| ReportIssue::new("CHECKS_INPUT_INVALID"))?;
        let training = training_facts(facts, shifts, Arc::clone(&profile));
        Ok(Self {
            snapshot: facts.snapshot().clone(),
            profile,
            resolver,
            collation,
            annual,
            training,
            youth_protection,
            reports: Mutex::new(ReportCache::default()),
        })
    }
    pub fn month(&self, month: &str) -> Result<Value, ReportIssue> {
        Ok(self.month_shared(month)?.as_ref().clone())
    }
    pub fn year(&self, year: i32) -> Result<Value, ReportIssue> {
        Ok(self.year_shared(year)?.as_ref().clone())
    }
    pub fn month_shared(&self, month: &str) -> Result<Arc<Value>, ReportIssue> {
        crate::calendar::parse_date(&format!("{month}-01"))
            .map_err(|_| ReportIssue::new("CHECKS_PERIOD_INVALID"))?;
        self.cached(Period::Month(month.into()), || self.calculate_month(month))
    }
    pub fn year_shared(&self, year: i32) -> Result<Arc<Value>, ReportIssue> {
        if !(1900..=4099).contains(&year) {
            return Err(ReportIssue::new("CHECKS_PERIOD_INVALID"));
        }
        self.cached(Period::Year(year), || self.calculate_year(year))
    }
    fn cached(
        &self,
        key: Period,
        calculate: impl FnOnce() -> Result<Value, ReportIssue>,
    ) -> Result<Arc<Value>, ReportIssue> {
        {
            let mut cache = self
                .reports
                .lock()
                .map_err(|_| ReportIssue::new("CHECKS_CONTEXT_UNAVAILABLE"))?;
            if let Some(i) = cache.entries.iter().position(|v| v.0 == key) {
                let item = cache.entries.remove(i).expect("located report");
                let result = Arc::clone(&item.1);
                cache.entries.push_back(item);
                return Ok(result);
            }
        }
        // Calculation runs outside the cache mutex; there is no registry lock.
        let result = Arc::new(calculate()?);
        let Some(bytes) =
            crate::report::cache_budget::serialized_bytes(result.as_ref(), MAX_ITEM_BYTES)
        else {
            return Ok(result);
        };
        let mut cache = self
            .reports
            .lock()
            .map_err(|_| ReportIssue::new("CHECKS_CONTEXT_UNAVAILABLE"))?;
        if let Some(item) = cache.entries.iter().find(|item| item.0 == key) {
            return Ok(Arc::clone(&item.1));
        }
        while cache.entries.len() >= 32 || cache.bytes + bytes > MAX_CACHE_BYTES {
            let (_, _, bytes) = cache.entries.pop_front().expect("nonempty over budget");
            cache.bytes -= bytes;
        }
        cache.bytes += bytes;
        cache.entries.push_back((key, Arc::clone(&result), bytes));
        Ok(result)
    }
    fn calculate_month(&self, month: &str) -> Result<Value, ReportIssue> {
        let adult = capture((|| {
            let shifts = self.annual.selected_shifts(month)?;
            let source = PreparedDatedComplianceSource::with_shared_collation(
                shifts.into_iter().cloned().collect::<Vec<_>>().into(),
                Arc::clone(&self.collation),
            );
            let mut options = serde_json::Map::new();
            options.insert(
                "referenceDate".into(),
                json!(self.snapshot.reference_date()),
            );
            options.insert("youthProtection".into(), json!(self.youth_protection));
            for key in [
                "federalState",
                "holidayRegion",
                "weeklyMinutes",
                "regularRotatingNightWork",
                "sundayHolidayWorkEligible",
                "allEmploymentWorkRecorded",
            ] {
                if let Some(value) = self.profile.get(key) {
                    options.insert(key.into(), value.clone());
                }
            }
            let zone = self.profile["timeZone"]
                .as_str()
                .ok_or(ComplianceError::InvalidInput)?;
            dated::calculate_monthly_compliance_with_basis(
                month,
                &source,
                zone,
                &Value::Object(options),
                self.snapshot.reference_date(),
                &self.resolver,
                ComplianceProfile::from_raw(&self.profile),
            )
        })())?;
        let training = match &self.training {
            TrainingState::NotRequested => None,
            TrainingState::Unavailable { loading, .. } => {
                training::calculate_training_compliance_for_state(
                    month,
                    adult.value(),
                    if *loading {
                        TrainingLoad::Loading
                    } else {
                        TrainingLoad::Error(None)
                    },
                    &self.resolver,
                    &self.collation,
                )
                .map_err(|_| ReportIssue::new("TRAINING_CALCULATION_FAILED"))?
            }
            TrainingState::Ready { source, profiles } => {
                let entries = source
                    .prepare(month)
                    .map_err(|_| ReportIssue::new("TRAINING_INPUT_INVALID"))?;
                training::calculate_training_compliance_for_state(
                    month,
                    adult.value(),
                    TrainingLoad::Ready {
                        entries: &entries,
                        profiles,
                    },
                    &self.resolver,
                    &self.collation,
                )
                .map_err(|_| ReportIssue::new("TRAINING_CALCULATION_FAILED"))?
            }
        };
        let compliance = match adult {
            Computation::Ready(value) => serde_json::to_value(Computation::Ready(value.result()))
                .map_err(|_| ReportIssue::new("OUTPUT_INVALID"))?,
            Computation::Unavailable { error, failure } => {
                serde_json::to_value(Computation::<Value>::Unavailable { error, failure })
                    .map_err(|_| ReportIssue::new("OUTPUT_INVALID"))?
            }
        };
        Ok(
            json!({"month":month,"compliance":compliance,"training":training.map(|v|v.into_json()),"trainingState":self.training.metadata()}),
        )
    }
    fn calculate_year(&self, year: i32) -> Result<Value, ReportIssue> {
        let training = match &self.training {
            TrainingState::NotRequested => None,
            TrainingState::Unavailable { loading, .. } => Some(if *loading {
                AnnualTraining::Loading
            } else {
                AnnualTraining::Error(None)
            }),
            TrainingState::Ready { source, profiles } => {
                Some(AnnualTraining::Prepared { source, profiles })
            }
        };
        let mut result = annual::calculate_annual_compliance(
            year,
            &self.annual,
            training.as_ref(),
            &self.collation,
        )
        .map_err(|_| ReportIssue::new("CHECKS_CALCULATION_FAILED"))?
        .into_json();
        result["trainingState"] = self.training.metadata();
        Ok(result)
    }
}
fn capture<T>(result: Result<T, ComplianceError>) -> Result<Computation<T>, ReportIssue> {
    match result {
        Ok(value) => Ok(Computation::Ready(value)),
        Err(ComplianceError::Rules(failure)) => Ok(Computation::rule(&failure)),
        Err(ComplianceError::Holiday(HolidayError::Resolution(failure))) => {
            Ok(Computation::rule(&failure))
        }
        Err(_) => Err(ReportIssue::new("CHECKS_CALCULATION_FAILED")),
    }
}
fn training_facts(
    facts: &SnapshotFacts,
    shifts: Arc<[Value]>,
    profile: Arc<Value>,
) -> TrainingState {
    let profiles = facts.training_profiles();
    let details = facts.training_details();
    let not_requested = |error: &FactError| {
        matches!(
            error,
            FactError::Source {
                error: SourceReadError::NotRequested,
                ..
            }
        )
    };
    if profiles.as_ref().err().is_some_and(not_requested)
        && details.as_ref().err().is_some_and(not_requested)
    {
        return TrainingState::NotRequested;
    }
    let mut errors = Vec::new();
    if let Err(error) = &profiles {
        errors.push((SourceKind::TrainingProfiles, error.clone()));
    }
    if let Err(error) = &details {
        errors.push((SourceKind::TrainingShiftDetails, error.clone()));
    }
    let profiles = profiles.ok().and_then(|p| match p.prepared() {
        Ok(p) => Some(Arc::clone(p)),
        Err(error) => {
            errors.push((SourceKind::TrainingProfiles, FactError::Training(error)));
            None
        }
    });
    if !errors.is_empty() {
        let loading = errors.iter().any(|(_, e)| {
            matches!(
                e,
                FactError::Source {
                    error: SourceReadError::Loading | SourceReadError::NotRequested,
                    ..
                }
            )
        });
        return TrainingState::Unavailable {
            loading,
            issues: errors
                .into_iter()
                .map(|(kind, error)| {
                    let mut issue = ReportIssue::from(error);
                    issue.source = Some(kind);
                    issue
                })
                .collect(),
        };
    }
    let details = details.expect("checked training details");
    TrainingState::Ready {
        source: YouthSource::new(shifts, details.saved().as_ref().clone().into(), profile),
        profiles: profiles.expect("checked training profiles"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn original_rule_capture_is_preserved_without_message_inference() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../reference/checks-snapshot-golden.json"
        ))
        .unwrap();
        let cases = fixture["captureCases"].as_array().unwrap();
        assert_eq!(cases.len(), 1);
        for case in cases {
            let input = &case["input"];
            let resolver = RuleResolver::from_catalog_json(
                input["catalog"].clone(),
                serde_json::from_value(input["selections"].clone()).unwrap(),
                None,
            )
            .unwrap();
            let source =
                PreparedDatedComplianceSource::new(Arc::from([]), CollationRanks::default());
            let result = dated::calculate_monthly_compliance(
                input["month"].as_str().unwrap(),
                &source,
                input["timeZone"].as_str().unwrap(),
                &input["options"],
                "2026-11-12",
                &resolver,
            )
            .map(|value| value.into_json());
            let actual = serde_json::to_value(capture(result).unwrap()).unwrap();
            assert_eq!(actual, case["expected"]);
        }
    }
}
