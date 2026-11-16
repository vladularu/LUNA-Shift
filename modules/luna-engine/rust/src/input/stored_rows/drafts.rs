//! Original import parent joins over native-mapped raw rows, never source admission.
use super::Parents;
use crate::{
    input::{self, InputError, draft_rows::DraftRowsKind as D},
    remuneration::{
        self,
        base::{BaseError, shift_days::remuneration_shift_days},
        context::model::ContextError,
        service_facts as tvl,
    },
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
fn fail(message: &str) -> InputError {
    InputError::source(message, "Error")
}
fn service_error(error: tvl::ServiceFactsError) -> InputError {
    match error {
        tvl::ServiceFactsError::Input(error) => error,
        tvl::ServiceFactsError::Employment(error) => input::employment::employment_error(error),
        other => {
            let name = if other.class_name() == "RangeError" {
                "RangeError"
            } else {
                "Error"
            };
            InputError::source(other.to_string(), name)
        }
    }
}
fn base_error(error: BaseError) -> InputError {
    match error {
        BaseError::Context(ContextError::Employment(e)) => input::employment::employment_error(e),
        BaseError::Engine(_) => InputError::source(error.to_string(), "RangeError"),
        _ => fail(&error.to_string()),
    }
}
fn profile<'a>(value: &Value, profiles: &'a [Value], key: &str) -> Option<&'a Value> {
    profiles.iter().find(|p| p["effectiveFrom"] == value[key])
}
fn future(value: &Value, a: &str, parent: &Value, b: &str) -> bool {
    value[a]
        .as_f64()
        .zip(parent[b].as_f64())
        .is_some_and(|(a, b)| a > b)
}
fn drk_training(value: &Value, profiles: &[Value], training: &[Value]) -> Result<(), InputError> {
    let remuneration = profile(value, profiles, "remunerationProfileEffectiveFrom");
    let training = training
        .iter()
        .find(|p| p["data"]["effectiveFrom"] == value["trainingProfileEffectiveFrom"]);
    let (Some(remuneration), Some(training)) = (remuneration, training) else {
        return Err(fail(
            "Ungültige Profilreferenz der DRK-Ausbildungsbestätigung.",
        ));
    };
    if future(
        value,
        "remunerationProfileRevision",
        remuneration,
        "revision",
    ) || future(value, "trainingProfileRevision", training, "revision")
    {
        return Err(fail(
            "Ungültige Profilreferenz der DRK-Ausbildungsbestätigung.",
        ));
    }
    if value["remunerationProfileRevision"].as_f64() == remuneration["revision"].as_f64()
        && value["trainingProfileRevision"].as_f64() == training["revision"].as_f64()
        && !remuneration::drk::saved::is_current_training(
            value,
            remuneration,
            training,
            value["ruleVersionId"].as_str().unwrap(),
        )
    {
        return Err(fail("Widersprüchliche DRK-Ausbildungstarifzuordnung."));
    }
    Ok(())
}
fn caritas_work(value: &Value, shift: Option<&Value>) -> Result<(), InputError> {
    let Some(shift) = shift else {
        return Err(fail("Ungültige Dienstreferenz der Caritas-Bestätigung."));
    };
    if shift["id"] != value["shiftId"] || future(value, "shiftRevision", shift, "revision") {
        return Err(fail("Ungültige Dienstreferenz der Caritas-Bestätigung."));
    }
    let zone = value["timeZone"].as_str().unwrap();
    if remuneration::caritas::saved::is_current_work_day(value, shift, zone)
        && !remuneration_shift_days(shift, zone)
            .map_err(base_error)?
            .iter()
            .any(|d| d.date == value["date"].as_str().unwrap())
    {
        return Err(fail(
            "Die Caritas-Bestätigung gehört nicht zu diesem Diensttag.",
        ));
    }
    Ok(())
}
fn caritas_overtime(
    value: &Value,
    shift: Option<&Value>,
    allocation: Option<&Value>,
    profiles: &[Value],
) -> Result<(), InputError> {
    let (Some(shift), Some(allocation), Some(profile)) = (
        shift,
        allocation,
        profile(value, profiles, "profileEffectiveFrom"),
    ) else {
        return Err(fail(
            "Ungültige Referenz der Caritas-Überstundenbestätigung.",
        ));
    };
    if future(value, "shiftRevision", shift, "revision")
        || future(value, "allocationRevision", allocation, "revision")
        || future(value, "profileRevision", profile, "revision")
        || allocation["shiftId"] != value["shiftId"]
    {
        return Err(fail(
            "Ungültige Referenz der Caritas-Überstundenbestätigung.",
        ));
    }
    let selection = &profile["data"]["selection"];
    if value["profileRevision"].as_f64() == profile["revision"].as_f64()
        && (selection["kind"] != "tariff"
            || selection["packageId"] != value["packageId"]
            || selection["variant"] != value["variantId"]
            || selection["region"] != value["regionId"])
    {
        return Err(fail("Widersprüchliche Caritas-Tarifzuordnung."));
    }
    Ok(())
}
fn tvl_parent(value: &Value, shift: Option<&Value>, profiles: &[Value]) -> Result<(), InputError> {
    let (Some(shift), Some(profile)) = (shift, profile(value, profiles, "profileEffectiveFrom"))
    else {
        return Err(fail(
            "Ungültige Dienst-/Profilreferenz der TV-L-Bestätigung.",
        ));
    };
    if shift["id"] != value["shiftId"]
        || future(value, "shiftRevision", shift, "revision")
        || future(value, "profileRevision", profile, "revision")
    {
        return Err(fail(
            "Ungültige Dienst-/Profilreferenz der TV-L-Bestätigung.",
        ));
    }
    if (value["shiftWork"].is_null() && value["burnCareIntervals"].is_null())
        || value["shiftRevision"].as_f64() != shift["revision"].as_f64()
        || value["shiftDate"] != shift["date"]
        || value["shiftUpdatedAt"] != shift["updatedAt"]
        || value["profileRevision"].as_f64() != profile["revision"].as_f64()
        || !shift["deletedAt"].is_null()
    {
        return Ok(());
    }
    let zone = value["timeZone"].as_str().unwrap();
    let selection = &profile["data"]["selection"];
    let mut owns_day = false;
    if crate::pay::pattern::is_pay_work_shift(shift)
        && selection["kind"] == "tariff"
        && matches!(
            selection["packageId"].as_str(),
            Some("tvl-kr-tdl" | "tval-pflege-tdl")
        )
    {
        for day in remuneration_shift_days(shift, zone).map_err(base_error)? {
            if crate::employment::resolve_remuneration_profile_ref(profiles, &day.date)
                .map_err(input::employment::employment_error)?
                .profile
                .is_some_and(|p| std::ptr::eq(p, profile))
            {
                owns_day = true;
                break;
            }
        }
    }
    if !owns_day {
        return Err(fail(
            "Diese TV-L-Bestätigung gehört nicht zu diesem Dienstzeitraum.",
        ));
    }
    let checked = tvl::validate_tvl_shift_work(value).map_err(service_error)?;
    if let remuneration::Presence::Value(intervals) = checked.burn_care_intervals {
        tvl::require_burn_care_interval_parents(&intervals, shift, zone, profile, profiles)
            .map_err(service_error)?
    }
    Ok(())
}
fn tvl_collection(values: &[&Value], shift: &Value, profiles: &[Value]) -> Result<(), InputError> {
    let current = values
        .iter()
        .copied()
        .filter(|v| {
            !v["burnCareIntervals"].is_null()
                && profile(v, profiles, "profileEffectiveFrom").is_some_and(|p| {
                    tvl::is_current_tvl_service_facts(v, shift, v["timeZone"].as_str().unwrap(), p)
                })
        })
        .collect::<Vec<_>>();
    let mut zones = Vec::new();
    for value in &current {
        let zone = value["timeZone"].as_str().unwrap();
        if !zones.contains(&zone) {
            zones.push(zone)
        }
    }
    for zone in zones {
        let total = current
            .iter()
            .filter(|v| v["timeZone"] == zone)
            .flat_map(|v| v["burnCareIntervals"].as_array().unwrap())
            .map(|i| i["until"].as_f64().unwrap() - i["from"].as_f64().unwrap())
            .sum::<f64>();
        let net = remuneration_shift_days(shift, zone)
            .map_err(base_error)?
            .iter()
            .map(|d| d.net_minutes)
            .sum::<f64>();
        if total > net {
            return Err(fail(
                "Schwerbrandpflegezeiten überschreiten zusammen die Dienstzeit ohne Pause.",
            ));
        }
    }
    Ok(())
}
pub(super) fn parents(
    kind: D,
    values: &[Value],
    raw: &Parents,
) -> Result<(), (InputError, Option<usize>)> {
    let profiles = if kind == D::CaritasWorkDay {
        Vec::new()
    } else {
        raw.remuneration_profiles
            .iter()
            .map(input::employment::map_remuneration_profile_row)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| (e, None))?
    };
    let training = if kind == D::DrkTraining {
        raw.training_profiles
            .iter()
            .map(input::training_rows::map_training_profile_row)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| (e, None))?
    } else {
        Vec::new()
    };
    let shifts = if matches!(
        kind,
        D::TvlShiftWork | D::CaritasWorkDay | D::CaritasOvertime | D::AnnexAPremium
    ) {
        raw.shifts
            .iter()
            .map(input::calendar_rows::map_shift)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| (e, None))?
    } else {
        Vec::new()
    };
    let shifts = shifts
        .iter()
        .map(|s| (s["id"].as_str().unwrap(), s))
        .collect::<BTreeMap<_, _>>();
    let allocations = if kind == D::CaritasOvertime {
        raw.overtime_allocations
            .iter()
            .map(input::remuneration_rows::map_overtime_allocation_row)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| (e, None))?
    } else {
        Vec::new()
    };
    let allocations = allocations
        .iter()
        .map(|a| (a["shiftId"].as_str().unwrap(), a))
        .collect::<BTreeMap<_, _>>();
    let mut seen = BTreeSet::new();
    let mut groups = BTreeMap::<&str, Vec<&Value>>::new();
    let mut group_order = Vec::new();
    for (index, value) in values.iter().enumerate() {
        let shift = shifts.get(value["shiftId"].as_str().unwrap_or("")).copied();
        let result = match kind {
            D::DrkTraining => drk_training(value, &profiles, &training),
            D::CaritasWorkDay => {
                let key = (
                    value["shiftId"].as_str().unwrap(),
                    value["date"].as_str().unwrap(),
                );
                if !seen.insert(key) {
                    return Err((super::invalid_backup(), Some(index)));
                }
                caritas_work(value, shift)
            }
            D::CaritasOvertime => caritas_overtime(
                value,
                shift,
                allocations.get(value["shiftId"].as_str().unwrap()).copied(),
                &profiles,
            ),
            D::TvlShiftWork => {
                let key = (
                    value["shiftId"].as_str().unwrap(),
                    value["profileEffectiveFrom"].as_str().unwrap(),
                );
                if !seen.insert(key) {
                    return Err((super::invalid_backup(), Some(index)));
                }
                tvl_parent(value, shift, &profiles).map_err(|e| (e, Some(index)))?;
                if !groups.contains_key(key.0) {
                    group_order.push(key.0)
                }
                groups.entry(key.0).or_default().push(value);
                Ok(())
            }
            _ => input::backup_profile_parents::require_profile_parent(kind, value, &profiles),
        };
        result.map_err(|e| (e, Some(index)))?;
        if kind == D::AnnexAPremium {
            for decision in value["dayDecisions"].as_array().unwrap() {
                let binding = input::raw_json::parse(decision["shiftBinding"].as_str().unwrap())
                    .map_err(|_| (super::invalid_backup(), Some(index)))?;
                if shifts
                    .get(decision["shiftId"].as_str().unwrap())
                    .is_none_or(|s| {
                        binding[1]
                            .as_f64()
                            .zip(s["revision"].as_f64())
                            .is_some_and(|(a, b)| a > b)
                    })
                {
                    return Err((
                        InputError::source(
                            "Ungültige Dienstreferenz in TVöD-Zuschlagsdaten.",
                            "LocalBackupValidationError",
                        ),
                        Some(index),
                    ));
                }
            }
        }
    }
    for id in group_order {
        tvl_collection(&groups[id], shifts[id], &profiles).map_err(|e| (e, None))?
    }
    Ok(())
}
