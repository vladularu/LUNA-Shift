//! Native source profile/clock preparation, independent of target and catalog IO.
use super::{
    InputError,
    employment::RawEmploymentHistory,
    personal_context::CheckedWorkPatternSettings,
    simple_profile::project_stored_simple_profile_without_history,
    stored_profile::{self, OpaqueStoredWorkProfile},
};
use serde_json::{Value, json};
use std::sync::Arc;
fn clock_error() -> InputError {
    InputError::source("Ungültiger Zeitpunkt für die Profilanzeige.", "RangeError")
}
fn source_error(e: crate::employment::EmploymentError) -> InputError {
    InputError::user_facing_source(e.to_string(), "RemunerationProfileError")
}
fn date_at(stamp: jiff::Timestamp, zone: &str) -> Result<jiff::civil::Date, InputError> {
    Ok(stamp
        .to_zoned(crate::time_zone::zone(zone).map_err(|_| clock_error())?)
        .date())
}
fn zone(profile: &Value) -> Result<&str, InputError> {
    profile["timeZone"].as_str().ok_or_else(clock_error)
}
fn add_zone(zones: &mut Vec<String>, zone: &str) {
    if !zones.iter().any(|v| v == zone) {
        zones.push(zone.into());
    }
}
fn thin(profile: &Value) -> Value {
    let mut profile = profile.clone();
    if let Some(record) = profile.as_object_mut() {
        record.remove("employmentTimeline");
        record.remove("workingTimeTarget");
    }
    profile
}
fn merge(base: &Value, overlay: Option<&Value>) -> Result<Value, InputError> {
    merge_owned(base.clone(), overlay)
}
fn merge_owned(mut result: Value, overlay: Option<&Value>) -> Result<Value, InputError> {
    if let Some(overlay) = overlay {
        let record = result.as_object_mut().ok_or_else(clock_error)?;
        for (key, value) in overlay.as_object().ok_or_else(clock_error)? {
            record.insert(key.clone(), value.clone());
        }
    }
    Ok(result)
}
/// WorkingTimeProvider's second overlay on its already selected, retained base.
/// This never reprojects a stored profile or changes that calculation base.
pub(crate) fn provider_on_selected_base(
    base: &Value,
    history: &[Value],
    observed_epoch_milliseconds: i64,
) -> Result<Value, InputError> {
    if !history
        .iter()
        .any(|value| crate::net::js_truthy(&value["employment"]))
    {
        return Ok(base.clone());
    }
    let stamp = jiff::Timestamp::from_millisecond(observed_epoch_milliseconds)
        .map_err(|_| clock_error())?;
    let overlay = crate::employment::employment_overlay_from_profiles(
        base.get("salaryBasisConflict"),
        history,
        &date_at(stamp, zone(base)?)?.to_string(),
    )
    .map_err(source_error)?;
    let mut selected = base.clone();
    selected
        .as_object_mut()
        .ok_or_else(clock_error)?
        .insert("employmentTimeline".into(), Value::Array(history.to_vec()));
    merge_owned(selected, overlay)
}
/// No Deserialize and no constructor accepting a calculated host civil date.
pub struct PreparedProfileClock {
    clock: Value,
    saved: Option<Arc<Value>>,
    base: Option<Arc<Value>>,
    provider_overlay: Option<Value>,
}
pub fn prepare_profile_clock(
    stored: Option<&OpaqueStoredWorkProfile>,
    history: Option<&RawEmploymentHistory>,
    observed_epoch_milliseconds: i64,
) -> Result<PreparedProfileClock, InputError> {
    if observed_epoch_milliseconds.unsigned_abs() > crate::money::MAX_SAFE_INTEGER as u64 {
        return Err(clock_error());
    }
    let stamp = jiff::Timestamp::from_millisecond(observed_epoch_milliseconds)
        .map_err(|_| clock_error())?;
    let mut selection_zones = Vec::new();
    let (saved, base, provider_overlay) = if let Some(stored) = stored {
        // The source's loadProfile is strict even though report recovery retains a
        // separate opaque core view for invalid salary fields.
        let mapped = stored_profile::map_profile_row(stored.raw_profile())?;
        let saved = Arc::new(
            stored_profile::load_simple_salary_for_profile(&mapped, stored.raw_salary_rows())
                .map_err(|e| InputError::source(e.to_string(), "DataLoadFailure"))?,
        );
        let history = history
            .ok_or_else(|| {
                InputError::validation("Der Beschäftigungsverlauf ist nicht verfügbar.")
            })?
            .profiles();
        let has_employment = history
            .iter()
            .any(|v| crate::net::js_truthy(&v["employment"]));
        let conflict = crate::net::js_truthy(&saved["salaryBasisConflict"]);
        let alternative = [
            "nursingTrainingTariff",
            "vkaETariff",
            "tvlKrTariff",
            "tvUkNursingTariff",
            "tvhKrTariff",
            "tvalPflegeTariff",
        ]
        .iter()
        .any(|key| crate::net::js_truthy(&saved[*key]));
        let saved_zone = zone(&saved)?;
        let saved_date = date_at(stamp, saved_zone)?.to_string();
        if !conflict && (has_employment || !alternative) {
            add_zone(&mut selection_zones, saved_zone);
        }
        let base =
            project_stored_simple_profile_without_history(Some(&saved), history, &saved_date)?
                .ok_or_else(clock_error)?;
        let provider_overlay = if has_employment {
            let base_zone = zone(&base)?;
            add_zone(&mut selection_zones, base_zone);
            crate::employment::employment_overlay_from_profiles(
                base.get("salaryBasisConflict"),
                history,
                &date_at(stamp, base_zone)?.to_string(),
            )
            .map_err(source_error)?
            .cloned()
        } else {
            None
        };
        (Some(saved), Some(base), provider_overlay)
    } else {
        (None, None, None)
    };
    let provider = base
        .as_ref()
        .map(|base| merge(base, provider_overlay.as_ref()))
        .transpose()?;
    let analysis_zone = base
        .as_ref()
        .map(|v| zone(v))
        .transpose()?
        .unwrap_or("Europe/Berlin");
    let provider_zone = provider
        .as_ref()
        .map(zone)
        .transpose()?
        .unwrap_or("Europe/Berlin");
    let reference_date = date_at(stamp, analysis_zone)?.to_string();
    let mut expiry_zones: Vec<&str> = selection_zones.iter().map(String::as_str).collect();
    for name in [analysis_zone, provider_zone] {
        if !expiry_zones.contains(&name) {
            expiry_zones.push(name);
        }
    }
    let mut valid_until = i64::MAX;
    for name in expiry_zones {
        let next = date_at(stamp, name)?
            .checked_add(jiff::Span::new().days(1))
            .map_err(|_| clock_error())?;
        let midnight = next
            .at(0, 0, 0, 0)
            .to_zoned(crate::time_zone::zone(name).map_err(|_| clock_error())?)
            .map_err(|_| clock_error())?
            .timestamp()
            .as_millisecond();
        if midnight <= observed_epoch_milliseconds {
            return Err(clock_error());
        }
        valid_until = valid_until.min(midnight);
    }
    let saved_zone = saved.as_ref().map(|v| zone(v)).transpose()?;
    let base_zone = base.as_ref().map(|v| zone(v)).transpose()?;
    let clock = json!({"observedEpochMilliseconds":observed_epoch_milliseconds,"validUntilEpochMilliseconds":valid_until,"onboarding":saved.is_none(),"selectionTimeZones":selection_zones,"savedTimeZone":saved_zone,"savedDate":saved_zone.map(|z|date_at(stamp,z).map(|v|v.to_string())).transpose()?,"projectedBaseTimeZone":base_zone,"projectedBaseDate":base_zone.map(|z|date_at(stamp,z).map(|v|v.to_string())).transpose()?,"providerTimeZone":provider_zone,"providerDate":date_at(stamp,provider_zone)?.to_string(),"analysisTimeZone":analysis_zone,"referenceDate":reference_date,"month":&reference_date[..7]});
    Ok(PreparedProfileClock {
        clock,
        saved,
        base,
        provider_overlay,
    })
}
impl PreparedProfileClock {
    pub fn clock_metadata(&self) -> &Value {
        &self.clock
    }
    /// The source analysis base before the provider's second dated overlay.
    /// Borrowed only: callers must keep the real checked history owner separate.
    pub(crate) fn calendar_base(&self) -> Option<&Arc<Value>> {
        self.base.as_ref()
    }
    pub fn requires_work_pattern(&self) -> bool {
        self.base
            .as_ref()
            .is_some_and(|base| base.get("workPattern").is_none_or(Value::is_null))
    }
    /// Original save return before the rendered provider's fallback and second
    /// effective-date overlay; no target/history-bearing UI DTO is accepted.
    pub(crate) fn projected_receipt_profile(
        &self,
        history: Option<&RawEmploymentHistory>,
    ) -> Result<Option<Arc<Value>>, InputError> {
        let Some(base) = &self.base else {
            return Ok(None);
        };
        let history = history.ok_or_else(|| {
            InputError::validation("Der Beschäftigungsverlauf ist nicht verfügbar.")
        })?;
        let mut value = base.as_ref().clone();
        value["employmentTimeline"] = json!(history.profiles().as_ref());
        Ok(Some(Arc::new(value)))
    }
    fn calculation_base(
        &self,
        pattern: Option<&CheckedWorkPatternSettings>,
    ) -> Result<Option<Value>, InputError> {
        let Some(base) = &self.base else {
            return Ok(None);
        };
        let mut calculation = thin(base);
        if calculation.get("workPattern").is_none_or(Value::is_null) {
            let settings = pattern
                .ok_or_else(|| InputError::validation("Das Arbeitsmuster ist nicht verfügbar."))?
                .settings();
            calculation["workPattern"] = json!({"workplaceCoverage":settings.workplace_coverage,"assignment":settings.assignment});
        }
        Ok(Some(calculation))
    }
    /// The actual WorkingTimeProvider constructs calculationProfile from its
    /// base before the separate dated provider overlay. Retain native history
    /// for the original target builder without turning display DTOs into facts.
    pub(crate) fn calculation_profile_base(
        &self,
        pattern: Option<&CheckedWorkPatternSettings>,
        history: Option<&RawEmploymentHistory>,
    ) -> Result<Option<Arc<Value>>, InputError> {
        let Some(mut base) = self.calculation_base(pattern)? else {
            return Ok(None);
        };
        let history = history.ok_or_else(|| {
            InputError::validation("Der Beschäftigungsverlauf ist nicht verfügbar.")
        })?;
        base["employmentTimeline"] = json!(history.profiles().as_ref());
        Ok(Some(Arc::new(base)))
    }
    /// Native editing retains the original employment rows. Display metadata
    /// deliberately omits them; neither path constructs or loads a target tree.
    pub(crate) fn editor_profile(
        &self,
        pattern: Option<&CheckedWorkPatternSettings>,
        history: Option<&RawEmploymentHistory>,
    ) -> Result<Option<Arc<Value>>, InputError> {
        let Some(mut calculation) = self.calculation_base(pattern)? else {
            return Ok(None);
        };
        let history = history.ok_or_else(|| {
            InputError::validation("Der Beschäftigungsverlauf ist nicht verfügbar.")
        })?;
        calculation["employmentTimeline"] = json!(history.profiles().as_ref());
        Ok(Some(Arc::new(merge_owned(
            calculation,
            self.provider_overlay.as_ref(),
        )?)))
    }
    /// The pattern affects display/model metadata, never clock selection. A
    /// missing genuinely needed pattern is a separate unavailable result.
    pub fn profile_metadata(
        &self,
        pattern: Option<&CheckedWorkPatternSettings>,
    ) -> Result<Value, InputError> {
        let Some(base) = &self.base else {
            return Ok(
                json!({"savedProfile":null,"projectedBaseProfile":null,"providerProfile":null,"calculationBaseProfile":null}),
            );
        };
        let calculation = self.calculation_base(pattern)?.ok_or_else(clock_error)?;
        let provider = merge(&calculation, self.provider_overlay.as_ref())?;
        Ok(
            json!({"savedProfile":self.saved.as_ref().map(|p|thin(p)),"projectedBaseProfile":thin(base),"providerProfile":thin(&provider),"calculationBaseProfile":calculation}),
        )
    }
    pub fn metadata(
        &self,
        pattern: Option<&CheckedWorkPatternSettings>,
    ) -> Result<Value, InputError> {
        let mut clock = self.clock.clone();
        let profiles = self.profile_metadata(pattern)?;
        for (key, value) in profiles.as_object().ok_or_else(clock_error)? {
            clock[key] = value.clone();
        }
        Ok(clock)
    }
    pub fn is_valid_at(&self, epoch_milliseconds: i64) -> bool {
        self.clock["observedEpochMilliseconds"]
            .as_i64()
            .is_some_and(|from| epoch_milliseconds >= from)
            && self.clock["validUntilEpochMilliseconds"]
                .as_i64()
                .is_some_and(|until| epoch_milliseconds < until)
    }
}
