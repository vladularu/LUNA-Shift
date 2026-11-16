use super::*;
use serde_json::Value;
use std::collections::BTreeSet;

fn exact<'a>(
    value: &'a Value,
    required: &[&str],
    optional: &[&str],
) -> Result<&'a serde_json::Map<String, Value>, TargetError> {
    let object = value.as_object().ok_or(TargetError::InvalidInput)?;
    if required.iter().any(|key| !object.contains_key(*key))
        || object
            .keys()
            .any(|key| !required.contains(&key.as_str()) && !optional.contains(&key.as_str()))
    {
        return Err(TargetError::InvalidInput);
    }
    Ok(object)
}
fn list(value: &Value, max: usize) -> Result<&[Value], TargetError> {
    let list = value.as_array().ok_or(TargetError::InvalidInput)?;
    if list.len() > max {
        return Err(TargetError::InvalidInput);
    }
    Ok(list)
}

/// Strict saved-data boundary, distinct from the calculation projection which accepts UI extras.
pub fn validate_saved_target_context(value: &Value) -> Result<Value, TargetError> {
    let context = exact(value, &["periods", "days"], &["employment"])?;
    for period in list(&context["periods"], 1000)? {
        exact(
            period,
            &[
                "validFrom",
                "validTo",
                "weeklyMinutes",
                "federalState",
                "holidayRegion",
                "model",
                "tariff",
            ],
            &[],
        )?;
        let model = exact(
            &period["model"],
            &["kind"],
            &[
                "weekdayMinutes",
                "monthlyReference",
                "sevenDayShiftPlanConfirmed",
            ],
        )?;
        match model["kind"].as_str() {
            Some("FIXED_WEEK") => {
                exact(&period["model"], &["kind", "weekdayMinutes"], &[])?;
                list(&model["weekdayMinutes"], 7)?;
            }
            Some("ROTATING_FIVE_IN_SEVEN") => {
                exact(
                    &period["model"],
                    &["kind", "monthlyReference", "sevenDayShiftPlanConfirmed"],
                    &[],
                )?;
            }
            _ => {
                exact(&period["model"], &["kind"], &[])?;
            }
        }
        let tariff = exact(
            &period["tariff"],
            &["kind"],
            &["version", "scopeConfirmed", "id", "accountRuleConfirmed"],
        )?;
        match tariff["kind"].as_str() {
            Some("TVUK_NURSING") => {
                exact(
                    &period["tariff"],
                    &["kind", "version", "scopeConfirmed", "accountRuleConfirmed"],
                    &[],
                )?;
            }
            Some(
                "TVOED_K" | "TVOED_B" | "TVL_KR" | "TVH_KR" | "TVAOED_K" | "TVAOED_B"
                | "TVAL_COMMON" | "TVAL_GENERAL" | "TVAL_KR",
            ) => {
                exact(
                    &period["tariff"],
                    &["kind", "version", "scopeConfirmed"],
                    &[],
                )?;
            }
            Some("UNVERIFIED") => {
                exact(&period["tariff"], &["kind", "id"], &[])?;
                if tariff["id"]
                    .as_str()
                    .is_none_or(|id| id.encode_utf16().count() > 200)
                {
                    return Err(TargetError::InvalidInput);
                }
            }
            _ => {
                exact(&period["tariff"], &["kind"], &[])?;
            }
        }
    }
    for day in list(&context["days"], 50_000)? {
        exact(
            day,
            &["date", "rosterStatus", "disposition"],
            &["lostMinutes", "mustWorkElsewhere"],
        )?;
    }
    if let Some(bounds) = context.get("employment") {
        exact(bounds, &["from", "to"], &[])?;
    }
    let parsed: TargetContext =
        serde_json::from_value(value.clone()).map_err(|_| TargetError::InvalidInput)?;
    validate(
        "2000-01",
        &TargetProfile {
            federal_state: "HE".into(),
            weekly_minutes: 0,
            holiday_region: None,
            working_time_target: None,
        },
        Some(&parsed),
    )?;
    Ok(value.clone())
}
pub fn validate_saved_target_settings(value: &Value) -> Result<Value, TargetError> {
    let settings = exact(value, &["version", "context", "planBindings"], &[])?;
    if settings["version"] != 1 {
        return Err(TargetError::UnsupportedSettingsVersion);
    }
    let context: TargetContext =
        serde_json::from_value(validate_saved_target_context(&settings["context"])?)
            .map_err(|_| TargetError::InvalidInput)?;
    let day_dates: BTreeSet<_> = context.days.iter().map(|d| d.date.as_str()).collect();
    let mut dates = BTreeSet::new();
    let bindings = list(&settings["planBindings"], 50_000)?;
    for binding in bindings {
        let binding = exact(binding, &["date", "signature"], &[])?;
        let date = binding["date"].as_str().ok_or(TargetError::InvalidInput)?;
        let signature = binding["signature"]
            .as_str()
            .ok_or(TargetError::InvalidInput)?;
        if signature.encode_utf16().count() > 100_000
            || !dates.insert(date)
            || !day_dates.contains(date)
        {
            return Err(TargetError::InvalidInput);
        }
    }
    if bindings.len() != context.days.len() {
        return Err(TargetError::InvalidInput);
    }
    Ok(value.clone())
}

pub(crate) fn valid_date(value: &str) -> Result<jiff::civil::Date, TargetError> {
    if value.len() != 10
        || value.as_bytes()[4] != b'-'
        || value.as_bytes()[7] != b'-'
        || value
            .bytes()
            .enumerate()
            .any(|(i, b)| i != 4 && i != 7 && !b.is_ascii_digit())
    {
        return Err(TargetError::InvalidInput);
    }
    value.parse().map_err(|_| TargetError::InvalidInput)
}
pub(crate) fn regional(state: &str) -> bool {
    matches!(state, "BY" | "SN" | "TH")
}
fn region_compatible(state: &str, region: &str) -> bool {
    match state {
        "BY" => matches!(
            region,
            "UNKNOWN" | "NONE" | "BY_MARIA_HIMMELFAHRT" | "BY_AUGSBURG"
        ),
        "SN" => matches!(region, "UNKNOWN" | "NONE" | "SN_FRONLEICHNAM"),
        "TH" => matches!(region, "UNKNOWN" | "NONE" | "TH_FRONLEICHNAM"),
        _ => region == "NONE",
    }
}
fn state(value: &str) -> bool {
    matches!(
        value,
        "BW" | "BY"
            | "BE"
            | "BB"
            | "HB"
            | "HH"
            | "HE"
            | "MV"
            | "NI"
            | "NW"
            | "RP"
            | "SL"
            | "SN"
            | "ST"
            | "SH"
            | "TH"
    )
}
fn minutes(value: i64, max: i64) -> Result<(), TargetError> {
    if !(0..=max).contains(&value) {
        Err(TargetError::InvalidInput)
    } else {
        Ok(())
    }
}
pub(crate) fn validate(
    month: &str,
    profile: &TargetProfile,
    context: Option<&TargetContext>,
) -> Result<(), TargetError> {
    validate_profile(month, profile)?;
    if let Some(context) = context {
        validate_context(context)?;
    }
    Ok(())
}
pub(crate) fn validate_profile(month: &str, profile: &TargetProfile) -> Result<(), TargetError> {
    if month.len() != 7 {
        return Err(TargetError::InvalidInput);
    }
    valid_date(&format!("{month}-01"))?;
    minutes(profile.weekly_minutes, 10080)?;
    if !state(&profile.federal_state) {
        return Err(TargetError::InvalidInput);
    }
    Ok(())
}
pub(crate) fn validate_context(context: &TargetContext) -> Result<(), TargetError> {
    // Existing saved context has 50,000 day-fact allowance; reject excess rather than truncate.
    if context.days.len() > 50_000 || context.periods.len() > 50_000 {
        return Err(TargetError::InvalidInput);
    }
    if let Some(bounds) = &context.employment {
        valid_date(&bounds.from)?;
        if let Some(to) = &bounds.to {
            valid_date(to)?;
            if to < &bounds.from {
                return Err(TargetError::InvalidInput);
            }
        }
    }
    let mut periods: Vec<_> = context.periods.iter().collect();
    periods.sort_by(|a, b| a.valid_from.cmp(&b.valid_from));
    let mut previous_end = "";
    for p in periods {
        valid_date(&p.valid_from)?;
        if let Some(to) = &p.valid_to {
            valid_date(to)?;
            if to < &p.valid_from {
                return Err(TargetError::InvalidInput);
            }
        }
        if p.valid_from.as_str() <= previous_end {
            return Err(TargetError::InvalidInput);
        }
        previous_end = p.valid_to.as_deref().unwrap_or("9999-12-31");
        minutes(p.weekly_minutes, 10080)?;
        if !state(&p.federal_state) || !region_compatible(&p.federal_state, &p.holiday_region) {
            return Err(TargetError::InvalidInput);
        }
        match &p.model {
            WorkModel::FixedWeek { weekday_minutes } => {
                if weekday_minutes.len() != 7 {
                    return Err(TargetError::InvalidInput);
                }
                for m in weekday_minutes {
                    minutes(*m, 1440)?
                }
                if weekday_minutes.iter().sum::<i64>() != p.weekly_minutes {
                    return Err(TargetError::InvalidInput);
                }
            }
            WorkModel::RotatingFiveInSeven {
                monthly_reference, ..
            } => {
                if monthly_reference != "WEEKDAYS_ONE_FIFTH" {
                    return Err(TargetError::InvalidInput);
                }
            }
            WorkModel::Unknown => {}
        }
        if p.tariff.reviewed_kind() {
            if p.tariff.version.is_none() {
                return Err(TargetError::InvalidInput);
            }
            if p.tariff.kind == TariffKind::TvukNursing
                && p.tariff.scope_confirmed == Some(true)
                && p.tariff.account_rule_confirmed == Some(false)
                && p.model.rotating()
                && p.model.confirmed() == Some(true)
            {
                return Err(TargetError::TvUkAccountConflict);
            }
        } else if p.tariff.kind == TariffKind::Unverified
            && p.tariff.id.as_deref().is_none_or(str::is_empty)
        {
            return Err(TargetError::InvalidInput);
        }
    }
    let mut days = BTreeSet::new();
    for day in &context.days {
        valid_date(&day.date)?;
        if !days.insert(&day.date) {
            return Err(TargetError::InvalidInput);
        }
        if let Some(m) = day.lost_minutes {
            minutes(m, 1440)?
        }
    }
    Ok(())
}
