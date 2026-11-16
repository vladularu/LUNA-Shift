//! Compatibility projection for full existing source records. Only target-relevant fields are
//! interpreted; unrelated profile/history fields are preserved verbatim and are never pay results.
use super::rules::legacy_package_id;
use super::validation::valid_date;
use super::{InputStatus, TargetError, TargetNotice};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

fn text<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}
fn present(v: &Value, key: &str) -> bool {
    v.get(key)
        .is_some_and(|v| !v.is_null() && v != &Value::Bool(false))
}
fn stringify_equal(a: &Value, b: &Value) -> bool {
    serde_json::to_string(a).ok() == serde_json::to_string(b).ok()
}
fn merge(base: &Value, overlay: &Value) -> Result<Value, TargetError> {
    let mut value = base.as_object().cloned().ok_or(TargetError::InvalidInput)?;
    for (key, v) in overlay.as_object().ok_or(TargetError::InvalidInput)? {
        value.insert(key.clone(), v.clone());
    }
    Ok(Value::Object(value))
}
fn version(kind: &str) -> &'static str {
    match kind {
        "TVL_KR" | "TVAL_COMMON" | "TVAL_GENERAL" | "TVAL_KR" => "2026-02-14",
        "TVH_KR" => "2026-03-27",
        "TVUK_NURSING" => "2025-01-01",
        "TVAOED_K" | "TVAOED_B" => "2025-07-01",
        _ => "2026-01-01",
    }
}
fn tariff(kind: &str) -> Value {
    let mut v = json!({"kind":kind,"version":version(kind),"scopeConfirmed":null});
    if kind == "TVUK_NURSING" {
        v["accountRuleConfirmed"] = Value::Null
    }
    v
}
fn tval(scope: Option<&str>) -> Value {
    tariff(match scope {
        Some("SECTION_43") => "TVAL_KR",
        Some("GENERAL") => "TVAL_GENERAL",
        _ => "TVAL_COMMON",
    })
}
fn sector(sector: Option<&str>, training: bool) -> Option<Value> {
    match sector {
        Some("BT_K") => Some(tariff(if training { "TVAOED_K" } else { "TVOED_K" })),
        Some("BT_B") => Some(tariff(if training { "TVAOED_B" } else { "TVOED_B" })),
        _ => None,
    }
}
fn unverified(id: impl Into<String>) -> Value {
    json!({"kind":"UNVERIFIED","id":id.into()})
}
fn reviewed(v: &Value) -> bool {
    matches!(
        text(v, "kind"),
        Some(
            "TVOED_K"
                | "TVOED_B"
                | "TVL_KR"
                | "TVH_KR"
                | "TVAOED_K"
                | "TVAOED_B"
                | "TVAL_COMMON"
                | "TVAL_GENERAL"
                | "TVAL_KR"
                | "TVUK_NURSING"
        )
    )
}

fn selected_tariff(selection: &Value) -> Result<Value, TargetError> {
    let package = text(selection, "packageId");
    let variant = text(selection, "variant");
    if text(selection, "kind") == Some("tariff") {
        if package == Some("tval-pflege-tdl") {
            return Ok(
                if variant == Some("CARE")
                    && text(selection, "group") == Some("regular")
                    && matches!(
                        text(selection, "region"),
                        Some("WEST_38_5" | "EAST" | "EAST_UNIVERSITY_HOSPITAL")
                    )
                    && matches!(text(selection, "level"), Some("1" | "2" | "3"))
                {
                    tval(text(selection, "tvalEmployerScope"))
                } else {
                    unverified("TVA_L/UNREVIEWED_SELECTION")
                },
            );
        }
        if package == Some("tvaoed-pflege-vka")
            && let Some(t) = sector(variant, true)
        {
            return Ok(t);
        }
        if package == Some("tvl-kr-tdl") && variant == Some("SECTION_43") {
            return Ok(tariff("TVL_KR"));
        }
        if (package == Some("tvoed-vka-bt-k") || package == Some(legacy_package_id()?))
            && let Some(t) = sector(variant, false)
        {
            return Ok(t);
        }
        return Ok(unverified(format!(
            "{}/{}",
            package.unwrap_or("undefined"),
            variant.unwrap_or("undefined")
        )));
    }
    Ok(unverified("OWN_OR_UNCONFIGURED"))
}
fn current_tariff(profile: &Value) -> Value {
    let keys = [
        "tariff",
        "vkaETariff",
        "tvlKrTariff",
        "tvUkNursingTariff",
        "tvhKrTariff",
        "nursingTrainingTariff",
        "tvalPflegeTariff",
    ];
    if !present(profile, "salaryBasisConflict") {
        for key in keys {
            if present(profile, key)
                && keys
                    .iter()
                    .filter(|other| **other != key)
                    .all(|other| !present(profile, other))
            {
                return match key {
                    "tvalPflegeTariff" => tval(text(&profile[key], "employerScope")),
                    "nursingTrainingTariff" => sector(text(&profile[key], "sector"), true)
                        .unwrap_or_else(|| unverified("TVAOED")),
                    "tvUkNursingTariff" => tariff("TVUK_NURSING"),
                    "tvhKrTariff" => tariff("TVH_KR"),
                    "tvlKrTariff" => tariff("TVL_KR"),
                    "vkaETariff" => sector(text(&profile[key], "sector"), false)
                        .unwrap_or_else(|| unverified("VKA_E")),
                    "tariff" => sector(text(&profile[key], "sector"), false)
                        .unwrap_or_else(|| unverified("CURRENT_SALARY_SELECTION")),
                    _ => unverified("CURRENT_SALARY_SELECTION"),
                };
            }
        }
    }
    unverified("CURRENT_SALARY_SELECTION")
}
fn historical_tariff(t: &Value) -> Result<Value, TargetError> {
    if text(t, "kind") == Some("UNVERIFIED") {
        if text(t, "id") == Some("tvl-kr-tdl/SECTION_43") {
            return Ok(tariff("TVL_KR"));
        }
        if text(t, "id").is_some_and(|id| {
            id == "BT_B"
                || id == "tvoed-vka-bt-k/BT_B"
                || id == format!("{}/BT_B", legacy_package_id().unwrap_or(""))
        }) {
            return Ok(tariff("TVOED_B"));
        }
    }
    Ok(t.clone())
}

pub fn derive_working_time_forecast_model(profile: &Value, weekly_minutes: i64) -> Value {
    match profile
        .get("sundayHolidayWorkEligible")
        .and_then(Value::as_bool)
    {
        Some(true) => {
            json!({"kind":"ROTATING_FIVE_IN_SEVEN","monthlyReference":"WEEKDAYS_ONE_FIFTH","sevenDayShiftPlanConfirmed":null})
        }
        Some(false) => {
            let daily = weekly_minutes.div_euclid(5);
            json!({"kind":"FIXED_WEEK","weekdayMinutes":[daily,daily,daily,daily,weekly_minutes-daily*4,0,0]})
        }
        None => json!({"kind":"UNKNOWN"}),
    }
}

// Err here models the source's RemunerationProfileError branch; projection returns status:error.
fn resolve_history(history: &[Value], date: &str) -> Result<(Option<Value>, bool), TargetError> {
    let resolved = crate::employment::resolve_remuneration_profile(history, date)
        .map_err(|_| TargetError::InvalidInput)?;
    Ok((
        resolved.profile,
        resolved.status == crate::employment::ResolutionStatus::Dated,
    ))
}

fn corrected(
    field: &str,
    dated: Option<&Value>,
    period: &Value,
    sources: &[Value],
) -> Result<bool, TargetError> {
    let overrides = dated
        .and_then(|d| d.get("employmentOverrides"))
        .and_then(Value::as_object);
    let on = if field == "tariff" {
        overrides.and_then(|o| {
            o.iter()
                .filter(|(key, _)| {
                    [
                        "tariff",
                        "nursingTrainingTariff",
                        "vkaETariff",
                        "tvlKrTariff",
                        "tvUkNursingTariff",
                        "tvhKrTariff",
                        "tvalPflegeTariff",
                    ]
                    .contains(&key.as_str())
                })
                .filter_map(|(_, value)| value.as_str())
                .max()
        })
    } else {
        overrides.and_then(|o| o.get(field)).and_then(Value::as_str)
    };
    let Some(on) = on else { return Ok(false) };
    let from = text(period, "validFrom").ok_or(TargetError::InvalidInput)?;
    if from <= on {
        return Ok(true);
    }
    let before = sources
        .iter()
        .find(|p| {
            text(p, "validFrom").is_some_and(|from| from <= on)
                && text(p, "validTo").is_none_or(|to| to >= on)
        })
        .or_else(|| sources.first());
    let Some(before) = before else {
        return Ok(false);
    };
    Ok(match field {
        "tariff" => historical_tariff(&period["tariff"])? == historical_tariff(&before["tariff"])?,
        "weeklyMinutes" => period["weeklyMinutes"] == before["weeklyMinutes"],
        "sundayHolidayWorkEligible" => stringify_equal(&period["model"], &before["model"]),
        _ => return Err(TargetError::InvalidInput),
    })
}

pub fn create_working_time_calculation_profile(
    profile: &Value,
    snapshot: Option<&Value>,
    history: &[Value],
    status: InputStatus,
    youth_protection: Option<bool>,
    youth_status: InputStatus,
) -> Result<Value, TargetError> {
    if status != InputStatus::Ready {
        return merge(
            profile,
            &json!({"workingTimeTarget":{"status":status,"notices":[]}}),
        );
    }
    // Match the source's narrow remuneration-error recovery; structural/date errors elsewhere propagate.
    match project(profile, snapshot, history, youth_protection, youth_status) {
        Ok(value) => Ok(value),
        Err(ProjectionError::History) => merge(
            profile,
            &json!({"workingTimeTarget":{"status":"error","notices":[]}}),
        ),
        Err(ProjectionError::Target(error)) => Err(error),
    }
}
enum ProjectionError {
    History,
    Target(TargetError),
}
impl From<TargetError> for ProjectionError {
    fn from(value: TargetError) -> Self {
        Self::Target(value)
    }
}
fn project(
    profile: &Value,
    snapshot: Option<&Value>,
    given_history: &[Value],
    youth: Option<bool>,
    youth_status: InputStatus,
) -> Result<Value, ProjectionError> {
    let fallback = profile
        .get("employmentTimeline")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let history = if given_history.is_empty() {
        fallback
    } else {
        given_history
    };
    let original = snapshot
        .and_then(|s| s.get("context"))
        .filter(|v| !v.is_null());
    let mut notices = Vec::<TargetNotice>::new();
    if original.is_none() && !history.iter().any(|h| present(h, "employment")) {
        notices.push(TargetNotice {
            date: None,
            code: "EMPLOYMENT_REFERENCE_UNCONFIRMED".into(),
            affects_target: true,
            message: super::rules::profile_notice("EMPLOYMENT_REFERENCE_UNCONFIRMED")?.into(),
        })
    }
    let weekly = profile["weeklyMinutes"]
        .as_i64()
        .ok_or(TargetError::InvalidInput)?;
    let default_source = vec![
        json!({"validFrom":"1900-01-01","validTo":null,"weeklyMinutes":weekly,"federalState":profile["federalState"],"holidayRegion":profile["holidayRegion"],"model":derive_working_time_forecast_model(profile,weekly),"tariff":current_tariff(profile)}),
    ];
    let sources = original
        .and_then(|o| o.get("periods"))
        .and_then(Value::as_array)
        .unwrap_or(&default_source);
    let mut periods = vec![];
    for period in sources {
        let from = text(period, "validFrom").ok_or(TargetError::InvalidInput)?;
        let end = text(period, "validTo");
        let mut starts = vec![from];
        starts.extend(
            history
                .iter()
                .filter_map(|h| text(h, "effectiveFrom"))
                .filter(|on| *on > from && end.is_none_or(|to| *on <= to)),
        );
        starts.sort();
        for (index, valid_from) in starts.iter().enumerate() {
            let valid_to = if let Some(next) = starts.get(index + 1) {
                Some(
                    valid_date(next)?
                        .checked_sub(jiff::ToSpan::days(1))
                        .map_err(|_| TargetError::InvalidInput)?
                        .to_string(),
                )
            } else {
                end.map(str::to_owned)
            };
            let (resolved, is_dated) =
                resolve_history(history, valid_from).map_err(|_| ProjectionError::History)?;
            let dated = resolved.as_ref().filter(|r| {
                present(r, "employment")
                    || original.is_none()
                        && !is_dated
                        && text(&r["data"]["selection"], "kind") == Some("tariff")
                        && text(&r["data"]["selection"], "packageId") == Some("tval-pflege-tdl")
                    || is_dated
                        && (original.is_none()
                            || text(r, "effectiveFrom").is_some_and(|on| on >= from))
            });
            let employment = if dated.is_some_and(|d| present(d, "employment")) {
                if present(profile, "salaryBasisConflict") {
                    Some(profile.clone())
                } else if history.iter().any(|h| present(h, "employment")) {
                    let (selected, _) = resolve_history(history, valid_from)
                        .map_err(|_| ProjectionError::History)?;
                    if let Some(selected) = selected.filter(|s| present(s, "employment")) {
                        Some(merge(profile, &selected["employment"])?)
                    } else {
                        Some(profile.clone())
                    }
                } else {
                    Some(profile.clone())
                }
            } else {
                None
            };
            let baseline = history
                .iter()
                .find(|h| h.get("effectiveFrom").is_some_and(Value::is_null))
                .and_then(|h| h.get("employment"))
                .filter(|v| !v.is_null());
            let replaces = original.is_none()
                || dated
                    .and_then(|d| text(d, "effectiveFrom"))
                    .is_some_and(|on| on >= from);
            let corrected_week = corrected("weeklyMinutes", dated, period, sources)?;
            let corrected_sunday = corrected("sundayHolidayWorkEligible", dated, period, sources)?;
            let corrected_tariff = corrected("tariff", dated, period, sources)?;
            let original_week = period["weeklyMinutes"]
                .as_i64()
                .ok_or(TargetError::InvalidInput)?;
            let new_week = if let Some(e) = &employment {
                if replaces
                    || corrected_week
                    || baseline.is_some_and(|b| b["weeklyMinutes"] == period["weeklyMinutes"])
                {
                    e["weeklyMinutes"]
                        .as_i64()
                        .ok_or(TargetError::InvalidInput)?
                } else {
                    original_week
                }
            } else {
                dated
                    .and_then(|d| d["data"]["weeklyMinutes"].as_i64())
                    .unwrap_or(original_week)
            };
            let selected = dated
                .and_then(|d| d.get("data"))
                .and_then(|d| d.get("selection"));
            let mut selected_target = historical_tariff(&period["tariff"])?;
            let employment_replaces = employment.as_ref().is_some_and(|e| {
                replaces
                    || corrected_tariff
                    || text(&selected_target, "kind") == Some("UNVERIFIED")
                        && match text(&selected_target, "id") {
                            Some("VKA_E") => present(e, "vkaETariff"),
                            Some("TVAOED") => present(e, "nursingTrainingTariff"),
                            Some("TVA_L") => present(e, "tvalPflegeTariff"),
                            _ => false,
                        }
                    || baseline.is_some_and(|b| {
                        merge(profile, b)
                            .is_ok_and(|v| current_tariff(&v)["kind"] == selected_target["kind"])
                    })
            });
            if employment_replaces {
                let e = employment.as_ref().ok_or(TargetError::InvalidInput)?;
                let family = if present(e, "tvalPflegeTariff")
                    && !e["tvalPflegeTariff"]
                        .as_object()
                        .is_some_and(|p| p.contains_key("employerScope"))
                    && selected.is_some_and(|s| {
                        text(s, "kind") == Some("tariff")
                            && text(s, "packageId") == Some("tval-pflege-tdl")
                    }) {
                    selected_tariff(selected.ok_or(TargetError::InvalidInput)?)?
                } else {
                    current_tariff(e)
                };
                if !(reviewed(&family) && family["kind"] == selected_target["kind"]) {
                    selected_target = family
                }
            } else if let Some(s) = selected {
                if text(s, "kind") == Some("tariff")
                    && !(employment.is_some()
                        && text(s, "packageId") == Some("tval-pflege-tdl")
                        && !replaces
                        && !corrected_tariff
                        && matches!(
                            text(&selected_target, "kind"),
                            Some("TVAL_COMMON" | "TVAL_GENERAL" | "TVAL_KR")
                        )
                        && selected_target["kind"] != selected_tariff(s)?["kind"])
                {
                    let family = selected_tariff(s)?;
                    if !(reviewed(&family) && family["kind"] == selected_target["kind"]) {
                        selected_target = family
                    }
                } else if original.is_none() {
                    selected_target = selected_tariff(s)?
                }
            }
            let standard_fixed = text(&period["model"], "kind") == Some("FIXED_WEEK")
                && period["model"]["weekdayMinutes"]
                    == derive_working_time_forecast_model(
                        &json!({"sundayHolidayWorkEligible":false}),
                        original_week,
                    )["weekdayMinutes"];
            let changed_fixed = original.is_some()
                && text(&period["model"], "kind") == Some("FIXED_WEEK")
                && !(employment.is_some() && standard_fixed)
                && new_week != original_week;
            let model = if changed_fixed {
                json!({"kind":"UNKNOWN"})
            } else if corrected_week && standard_fixed && !corrected_sunday {
                derive_working_time_forecast_model(
                    &json!({"sundayHolidayWorkEligible":false}),
                    new_week,
                )
            } else {
                let inherit = employment.as_ref().is_some_and(|_| {
                    (replaces
                        || corrected_sunday
                        || baseline.is_some_and(|b| {
                            merge(profile, b).is_ok_and(|v| {
                                derive_working_time_forecast_model(
                                    &v,
                                    b["weeklyMinutes"].as_i64().unwrap_or(0),
                                )["kind"]
                                    == period["model"]["kind"]
                            })
                        }))
                        && (text(&period["model"], "kind") != Some("FIXED_WEEK") || standard_fixed)
                });
                if inherit
                    || original.is_none()
                    || text(&period["model"], "kind") == Some("UNKNOWN")
                {
                    derive_working_time_forecast_model(
                        employment.as_ref().unwrap_or(profile),
                        new_week,
                    )
                } else {
                    period["model"].clone()
                }
            };
            if changed_fixed {
                notices.push(TargetNotice {
                    date: Some((*valid_from).to_owned()),
                    code: "FIXED_DISTRIBUTION_CHANGED".into(),
                    affects_target: true,
                    message: super::rules::profile_notice("FIXED_DISTRIBUTION_CHANGED")?.into(),
                })
            }
            let mut next = merge(
                period,
                &json!({"validFrom":valid_from,"validTo":valid_to,"weeklyMinutes":new_week,"model":model,"tariff":selected_target}),
            )?;
            if let Some(e) = employment {
                next["federalState"] = e["federalState"].clone();
                next["holidayRegion"] = e["holidayRegion"].clone();
            }
            periods.push(next);
        }
    }
    let mut days = original
        .and_then(|o| o.get("days"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for day in &mut days {
        let on = text(day, "date").ok_or(TargetError::InvalidInput)?;
        let covers = |p: &&Value| {
            text(p, "validFrom").is_some_and(|from| from <= on)
                && text(p, "validTo").is_none_or(|to| on <= to)
        };
        let before = sources.iter().find(covers);
        let after = periods.iter().find(covers);
        if before.zip(after).is_some_and(|(b, a)| {
            b["weeklyMinutes"] != a["weeklyMinutes"]
                || !stringify_equal(&b["tariff"], &a["tariff"])
                || !stringify_equal(&b["model"], &a["model"])
        }) {
            *day = merge(
                day,
                &json!({"rosterStatus":"DRAFT","lostMinutes":null,"mustWorkElsewhere":null}),
            )?
        }
    }
    let context = merge(
        original.unwrap_or(&json!({})),
        &json!({"periods":periods,"days":days}),
    )?;
    let mut input = json!({"status":"ready","notices":notices,"mode":"FORECAST","context":context});
    if youth.is_some() || youth_status != InputStatus::Ready {
        input["youthProtection"] = json!(youth);
        input["youthProtectionStatus"] = json!(youth_status)
    }
    merge(
        profile,
        &json!({"employmentTimeline":history,"workingTimeTarget":input}),
    )
    .map_err(ProjectionError::Target)
}

fn canonical_json(value: &Value) -> Result<String, TargetError> {
    fn ordered(value: &Value) -> Value {
        match value {
            Value::Object(object) => {
                let mut keys: Vec<_> = object.keys().collect();
                keys.sort();
                Value::Object(
                    keys.into_iter()
                        .map(|key| (key.clone(), ordered(&object[key])))
                        .collect(),
                )
            }
            Value::Array(values) => Value::Array(values.iter().map(ordered).collect()),
            Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => value.clone(),
        }
    }
    serde_json::to_string(&ordered(value)).map_err(|_| TargetError::InvalidInput)
}

fn validate_plan(shifts: &[Value]) -> Result<(), TargetError> {
    if shifts.len() > 100_000 {
        return Err(TargetError::InvalidInput);
    }
    let mut previous: Option<(&str, &str)> = None;
    for shift in shifts {
        for key in ["id", "date", "updated_at", "type"] {
            if text(shift, key).is_none() {
                return Err(TargetError::InvalidInput);
            }
        }
        let date = text(shift, "date").ok_or(TargetError::InvalidInput)?;
        valid_date(date)?;
        let id = text(shift, "id").ok_or(TargetError::InvalidInput)?;
        if previous.is_some_and(|before| before > (date, id)) {
            return Err(TargetError::InvalidInput);
        }
        previous = Some((date, id));
        for key in ["revision", "all_day", "break_minutes"] {
            if shift.get(key).and_then(Value::as_i64).is_none() {
                return Err(TargetError::InvalidInput);
            }
        }
        for key in ["start_time", "end_time"] {
            if shift
                .get(key)
                .is_none_or(|v| !v.is_null() && !v.is_string())
            {
                return Err(TargetError::InvalidInput);
            }
        }
    }
    Ok(())
}

/// Same SQL-projected plan rows as readPlan: date/id sorted, all deleted entries excluded.
/// Title, colour, notes and revision-only edits intentionally do not alter modern day evidence.
pub fn target_plan_day_signature(
    time_zone: Option<&str>,
    shifts: &[Value],
    date: &str,
    context: &Value,
    legacy: bool,
) -> Result<String, TargetError> {
    let plan = PreparedPlan::new(time_zone, shifts)?;
    super::validate_saved_target_context(context)?;
    plan.signature(date, context, legacy)
}

struct PreparedPlan<'a> {
    time_zone: Option<&'a str>,
    by_date: BTreeMap<&'a str, Vec<&'a Value>>,
}
impl<'a> PreparedPlan<'a> {
    fn new(time_zone: Option<&'a str>, shifts: &'a [Value]) -> Result<Self, TargetError> {
        validate_plan(shifts)?;
        let mut by_date: BTreeMap<&str, Vec<&Value>> = BTreeMap::new();
        for shift in shifts {
            by_date
                .entry(text(shift, "date").ok_or(TargetError::InvalidInput)?)
                .or_default()
                .push(shift);
        }
        Ok(Self { time_zone, by_date })
    }
    fn signature(&self, date: &str, context: &Value, legacy: bool) -> Result<String, TargetError> {
        let previous = valid_date(date)?
            .checked_sub(jiff::ToSpan::days(1))
            .map_err(|_| TargetError::InvalidInput)?
            .to_string();
        let previous_rows = self
            .by_date
            .get(previous.as_str())
            .into_iter()
            .flatten()
            .copied()
            .filter(|s| {
                legacy
                    || s["all_day"] == 0
                        && text(s, "start_time")
                            .zip(text(s, "end_time"))
                            .is_some_and(|(start, end)| end <= start)
            });
        let current_rows = self.by_date.get(date).into_iter().flatten().copied();
        let rows:Vec<Value>=previous_rows.chain(current_rows).map(|s|{
        if legacy{json!({"id":s["id"],"date":s["date"],"revision":s["revision"],"updated_at":s["updated_at"],"start_time":s["start_time"],"end_time":s["end_time"]})}else{json!({"id":s["id"],"date":s["date"],"type":s["type"],"all_day":s["all_day"],"break_minutes":s["break_minutes"],"start_time":s["start_time"],"end_time":s["end_time"]})}
    }).collect();
        let work: Vec<Value> = context["periods"]
            .as_array()
            .ok_or(TargetError::InvalidInput)?
            .iter()
            .filter(|p| {
                text(p, "validFrom").is_some_and(|from| from <= date)
                    && text(p, "validTo").is_none_or(|to| date <= to)
            })
            .map(|p| {
                let mut work = p.as_object().cloned().unwrap_or_default();
                work.remove("validFrom");
                work.remove("validTo");
                Value::Object(work)
            })
            .collect();
        let employed = context.get("employment").is_none_or(|b| {
            text(b, "from").is_some_and(|from| from <= date)
                && text(b, "to").is_none_or(|to| date <= to)
        });
        let mut value =
            json!({"timeZone":self.time_zone,"work":work,"employed":employed,"shifts":rows});
        if !legacy {
            value["bindingVersion"] = json!(2)
        }
        canonical_json(&value)
    }
}

fn validate_saved_record(saved: &Value) -> Result<(), TargetError> {
    super::validate_saved_target_settings(saved.get("settings").ok_or(TargetError::InvalidInput)?)?;
    let revision = saved["revision"]
        .as_u64()
        .ok_or(TargetError::InvalidInput)?;
    if revision == 0 || revision > super::super::contract::MAX_SAFE_REVISION {
        return Err(TargetError::InvalidInput);
    }
    let created = text(saved, "createdAt")
        .and_then(crate::input::precise_instant_nanoseconds)
        .ok_or(TargetError::InvalidInput)?;
    let updated = text(saved, "updatedAt")
        .and_then(crate::input::precise_instant_nanoseconds)
        .ok_or(TargetError::InvalidInput)?;
    if created > updated {
        return Err(TargetError::InvalidInput);
    }
    Ok(())
}

/// Pure read projection. The app owns SQL and atomic writer guards; no evidence is reconfirmed.
pub fn project_saved_target_snapshot(
    saved: Option<&Value>,
    time_zone: Option<&str>,
    shifts: &[Value],
) -> Result<Value, TargetError> {
    let plan = PreparedPlan::new(time_zone, shifts)?;
    let plan_revision = canonical_json(&json!({"timeZone":time_zone,"shifts":shifts}))?;
    let mut result = json!({"saved":saved,"staleDates":[],"planRevision":plan_revision});
    let Some(saved) = saved else {
        return Ok(result);
    };
    validate_saved_record(saved)?;
    let settings = &saved["settings"];
    let context = &settings["context"];
    let mut stale = vec![];
    for binding in settings["planBindings"]
        .as_array()
        .ok_or(TargetError::InvalidInput)?
    {
        let date = text(binding, "date").ok_or(TargetError::InvalidInput)?;
        let signature = text(binding, "signature").ok_or(TargetError::InvalidInput)?;
        if signature != plan.signature(date, context, false)?
            && signature != plan.signature(date, context, true)?
        {
            stale.push(date.to_owned());
        }
    }
    let stale_set: BTreeSet<_> = stale.iter().map(String::as_str).collect();
    let mut projected = context.clone();
    for day in projected["days"]
        .as_array_mut()
        .ok_or(TargetError::InvalidInput)?
    {
        if text(day, "date").is_some_and(|date| stale_set.contains(date)) {
            *day = merge(
                day,
                &json!({"rosterStatus":"DRAFT","lostMinutes":null,"mustWorkElsewhere":null}),
            )?
        }
    }
    result["context"] = super::validate_saved_target_context(&projected)?;
    result["staleDates"] = json!(stale);
    Ok(result)
}

/// Proposes only signatures whose old evidence still matches. SQL composition may commit these
/// with revision/timestamp checks, unless test backups exist; this function never changes revision.
pub fn propose_unchanged_target_bindings(
    saved: &Value,
    time_zone: Option<&str>,
    shifts: &[Value],
) -> Result<Option<Value>, TargetError> {
    validate_saved_record(saved)?;
    let plan = PreparedPlan::new(time_zone, shifts)?;
    let context = &saved["settings"]["context"];
    let mut settings = saved["settings"].clone();
    let mut changed = false;
    for binding in settings["planBindings"]
        .as_array_mut()
        .ok_or(TargetError::InvalidInput)?
    {
        let date = text(binding, "date").ok_or(TargetError::InvalidInput)?;
        let signature = plan.signature(date, context, false)?;
        if binding["signature"] != signature
            && binding["signature"] == plan.signature(date, context, true)?
        {
            binding["signature"] = json!(signature);
            changed = true;
        }
    }
    if changed {
        Ok(Some(super::validate_saved_target_settings(&settings)?))
    } else {
        Ok(None)
    }
}
