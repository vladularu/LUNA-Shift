//! The existing Schichtzulage screen's requested calculation, independent of
//! salary pricing, tax setup and payment timing.
use super::computation::Computation;
use crate::{
    employment::{self, profile_view::EmploymentProfileRef},
    pay::{
        families::{self, Family},
        month::{self, MonthPayError, MonthPayInput},
        pattern::{self, WorkPatternSettings},
    },
    rules::RuleResolver,
};
use jiff::ToSpan;
use serde_json::{Value, json};

pub fn calculate(
    month: &str,
    entries: &[Value],
    profile: &Value,
    settings: &WorkPatternSettings,
    decision: Option<&Value>,
    resolver: &RuleResolver,
) -> Result<Value, MonthPayError> {
    let date = format!("{month}-01");
    let settings: WorkPatternSettings = serde_json::from_value(
        employment::employment_work_pattern_at(profile, &json!(settings), &date)?,
    )
    .map_err(|_| MonthPayError::InvalidInput)?;
    // The screen chooses its observation window from the provided profile,
    // then dispatches the calculation using the month-effective profile.
    let selected = if truthy(&profile["tvhKrTariff"]) {
        Some(Family::Tvh)
    } else if truthy(&profile["tvlKrTariff"]) || truthy(&profile["tvalPflegeTariff"]) {
        Some(Family::Tvl)
    } else if truthy(&profile["vkaETariff"]) {
        Some(Family::VkaE)
    } else if truthy(&profile["nursingTrainingTariff"]) {
        Some(Family::Training)
    } else {
        None
    };
    let refs = if let Some(family) = selected {
        families::select_assessment_shifts(family, entries, month)?
    } else {
        let first = crate::calendar::parse_date(&date)?;
        let from = first
            .checked_sub(pattern::assessment_lookback_months(&date, resolver)?.months())
            .map_err(|_| MonthPayError::InvalidInput)?
            .to_string();
        let through = first.last_of_month().to_string();
        entries
            .iter()
            .filter(|e| {
                e["kind"] == "SHIFT"
                    && e.get("deletedAt") == Some(&Value::Null)
                    && e["date"]
                        .as_str()
                        .is_some_and(|d| d >= from.as_str() && d <= through.as_str())
            })
            .collect()
    };
    // Existing family kernels take a slice. Copy only the selected bounded
    // shift window; no full plan, history or target-capable profile is copied.
    let shifts: Vec<Value> = refs.into_iter().cloned().collect();
    let effective = EmploymentProfileRef::at(profile, &date)?;
    let mut compact = serde_json::Map::new();
    for key in [
        "timeZone",
        "tariff",
        "tvalPflegeTariff",
        "tvhKrTariff",
        "tvUkNursingTariff",
        "tvlKrTariff",
        "vkaETariff",
        "nursingTrainingTariff",
    ] {
        if let Some(value) = effective.get(key) {
            compact.insert(key.into(), value.clone());
        }
    }
    compact.insert(
        "workPattern".into(),
        json!({"workplaceCoverage":settings.workplace_coverage,"assignment":settings.assignment}),
    );
    let compact = Value::Object(compact);
    let result = match month::selected_family_from(|key| compact.get(key)) {
        Some(f @ (Family::VkaE | Family::Training)) => {
            families::vka_training::calculate_assessment(
                f, month, &shifts, &settings, resolver, &compact,
            )
            .map_err(MonthPayError::from)
        }
        Some(f @ (Family::Tvl | Family::Tval)) => {
            families::tvl_tval::calculate_assessment(f, month, &shifts, &settings, resolver)
                .map_err(MonthPayError::from)
        }
        Some(Family::Tvh) => families::tvh::calculate_assessment(
            month,
            &shifts,
            &settings,
            compact["timeZone"]
                .as_str()
                .ok_or(MonthPayError::InvalidInput)?,
        )
        .map_err(MonthPayError::from),
        Some(Family::Tvuk) => families::tvuk::calculate_assessment(month, &shifts, resolver)
            .map_err(MonthPayError::from),
        None => month::calculate_legacy_assessment(
            &MonthPayInput {
                month,
                shifts: &shifts,
                profile: &compact,
                decision: None,
                assessment_shifts: &shifts,
                settings: &settings,
            },
            resolver,
        ),
    };
    let calculation = match result {
        Ok(value) => Computation::Ready(value),
        Err(MonthPayError::Family(ref error)) if error.rule_failure().is_some() => {
            Computation::rule(
                error
                    .rule_failure()
                    .expect("checked structured rule failure"),
            )
        }
        Err(error) => return Err(error),
    };
    let show_night = profile["tariff"]["sector"] == "BT_K";
    let value = calculation
        .value()
        .filter(|v| v["available"] == true && !v["assessment"].is_null());
    let mut title = Value::Null;
    let mut caption = Value::Null;
    let mut night = Value::Null;
    if let Some(value) = value {
        let assessment = &value["assessment"];
        title = json!(if let Some(decision) = decision {
            allowance_label(
                decision["allowanceStatus"]
                    .as_str()
                    .ok_or(MonthPayError::InvalidInput)?,
            )?
        } else if assessment["suggestedAllowance"] != "NONE" {
            allowance_label(
                assessment["suggestedAllowance"]
                    .as_str()
                    .ok_or(MonthPayError::InvalidInput)?,
            )?
        } else if assessment["requiresConfirmation"] == true {
            "Bestätigung erforderlich"
        } else if assessment["alternatingShiftWork"] == "REVIEW" {
            "Wechselschicht noch nicht eindeutig"
        } else if assessment["shiftWork"] == "DETECTED" {
            "Schichtarbeit erkannt"
        } else {
            "Kein eindeutiges Schichtmuster"
        });
        caption = if decision.is_some() {
            json!("Für diesen Monat gilt deine Auswahl.")
        } else {
            assessment
                .get("estimateNote")
                .filter(|v| !v.is_null())
                .cloned()
                .unwrap_or_else(|| {
                    json!("Schätzung aus deinen Diensten, kein bestätigter Monatsanspruch.")
                })
        };
        if show_night {
            night = value
                .get("nightSequence")
                .filter(|v| !v.is_null())
                .cloned()
                .unwrap_or_else(|| {
                    profile["timeZone"]
                        .as_str()
                        .and_then(|zone| {
                            pattern::calendar_nights::explain_night_sequence(entries, month, zone)
                                .ok()
                        })
                        .and_then(|n| serde_json::to_value(n).ok())
                        .unwrap_or(Value::Null)
                });
        }
    }
    Ok(
        json!({"calculation":calculation,"showNightSequence":show_night,"title":title,"caption":caption,"nightExplanation":night}),
    )
}
fn truthy(v: &Value) -> bool {
    crate::net::js_truthy(v)
}
fn allowance_label(status: &str) -> Result<&'static str, MonthPayError> {
    Ok(match status {
        "NONE" => "Keine Zulage",
        "SHIFT_MONTHLY" => "Ständige Schichtarbeit",
        "SHIFT_HOURLY" => "Nichtständige Schichtarbeit",
        "ALTERNATING_MONTHLY" => "Ständige Wechselschicht",
        "ALTERNATING_HOURLY" => "Nichtständige Wechselschicht",
        _ => return Err(MonthPayError::InvalidInput),
    })
}
