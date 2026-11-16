//! Native presentation of the original automatic contractual target page.
use super::{PreparedTargetSource, TargetError};
use crate::rules::RuleResolver;
use serde_json::{Value, json};

fn minute_text(minutes: i64) -> String {
    let absolute = i128::from(minutes).abs();
    format!(
        "{}{}:{:02}",
        if minutes < 0 { "−" } else { "" },
        absolute / 60,
        absolute % 60
    )
}
fn weekly_text(minutes: f64) -> String {
    let decimal = format!("{:.2}", minutes / 60.0);
    let number = decimal.parse::<f64>().expect("finite minute input");
    ryu_js::Buffer::new()
        .format_finite(number)
        .replace('.', ",")
}
fn state_label(state: &str) -> &'static str {
    match state {
        "BW" => "Baden-Württemberg",
        "BY" => "Bayern",
        "BE" => "Berlin",
        "BB" => "Brandenburg",
        "HB" => "Bremen",
        "HH" => "Hamburg",
        "HE" => "Hessen",
        "MV" => "Mecklenburg-Vorpommern",
        "NI" => "Niedersachsen",
        "NW" => "Nordrhein-Westfalen",
        "RP" => "Rheinland-Pfalz",
        "SL" => "Saarland",
        "SN" => "Sachsen",
        "ST" => "Sachsen-Anhalt",
        "SH" => "Schleswig-Holstein",
        "TH" => "Thüringen",
        _ => "undefined",
    }
}
fn field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}
fn has_code(result: Option<&Value>, codes: &[&str]) -> bool {
    result
        .and_then(|r| r.get("notices"))
        .and_then(Value::as_array)
        .is_some_and(|notices| {
            notices
                .iter()
                .any(|n| field(n, "code").is_some_and(|c| codes.contains(&c)))
        })
}
fn model_key(model: Option<&Value>) -> Result<Option<String>, TargetError> {
    // Only small raw models are serialized, preserving original property order.
    // The entire target input/day context is never serialized for comparison.
    model
        .map(serde_json::to_string)
        .transpose()
        .map_err(|_| TargetError::InvalidInput)
}
/// Both the prepared source and display profile are native-owned intermediates.
/// This is not a wire constructor or an admission of precomputed host targets.
pub fn overview(
    month: &str,
    source: &PreparedTargetSource,
    display_profile: &Value,
    resolver: &RuleResolver,
) -> Result<Value, TargetError> {
    let raw = source.profile();
    let input = raw.get("workingTimeTarget");
    let from = format!("{month}-01");
    let through = format!("{month}-31");
    let periods = input
        .and_then(|v| v.get("context"))
        .and_then(|v| v.get("periods"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|period| {
            field(period, "validFrom").is_some_and(|date| date <= through.as_str())
                && match period.get("validTo") {
                    Some(Value::Null) => true,
                    Some(Value::String(date)) => date >= &from,
                    _ => false,
                }
        })
        .collect::<Vec<_>>();
    let mut hours = Vec::new();
    let mut states = Vec::new();
    for period in &periods {
        if let Some(value) = period.get("weeklyMinutes")
            && !hours.contains(&value)
        {
            hours.push(value);
        }
        if let Some(value) = period.get("federalState")
            && !states.contains(&value)
        {
            states.push(value);
        }
    }
    let hours_label = if hours.len() > 1 {
        "Wochenstundenwechsel".into()
    } else {
        let minutes = hours
            .first()
            .copied()
            .or_else(|| display_profile.get("weeklyMinutes"))
            .and_then(Value::as_f64)
            .ok_or(TargetError::InvalidInput)?;
        if !minutes.is_finite() {
            return Err(TargetError::InvalidInput);
        }
        format!("{} Std./Woche", weekly_text(minutes))
    };
    let state = if states.len() > 1 {
        "Arbeitsortwechsel"
    } else {
        state_label(
            states
                .first()
                .copied()
                .or_else(|| display_profile.get("federalState"))
                .and_then(Value::as_str)
                .unwrap_or("undefined"),
        )
    };
    let employment_label = format!("{hours_label} · {state}");
    let model = periods.first().and_then(|period| period.get("model"));
    let first_key = model_key(model)?;
    let mut changed = false;
    for period in &periods {
        if model_key(period.get("model"))? != first_key {
            changed = true;
            break;
        }
    }
    let model_label = if changed {
        "Arbeitszeitmodell wechselt im Monat".to_owned()
    } else {
        match model.and_then(|v| field(v, "kind")) {
            Some("ROTATING_FIVE_IN_SEVEN") => format!(
                "Wechselnde Tage Mo–So{}",
                if model
                    .and_then(|v| v.get("sevenDayShiftPlanConfirmed"))
                    .and_then(Value::as_bool)
                    == Some(true)
                {
                    ""
                } else {
                    " · aus deinem Profil"
                }
            ),
            Some("FIXED_WEEK") => "Feste Wochentage".into(),
            _ => "Verteilung noch unbekannt".into(),
        }
    };
    let calculation = match source
        .base_profile()
        .and_then(|profile| profile.calculate(month, resolver, None))
    {
        Ok(value) => json!({"value":value,"error":null}),
        Err(error) => json!({"value":null,"error":error.to_string()}),
    };
    let result = calculation.get("value").filter(|v| !v.is_null());
    let training_guard = result
        .and_then(|v| v.get("notices"))
        .and_then(Value::as_array)
        .and_then(|notices| {
            notices
                .iter()
                .find(|n| field(n, "code").is_some_and(|code| code.starts_with("TRAINING_YOUTH_")))
        });
    let adjustments = result
        .and_then(|v| v.get("adjustments"))
        .and_then(Value::as_array);
    let projection = adjustments.is_some_and(|lines| {
        lines
            .iter()
            .any(|line| field(line, "status") == Some("PROFILE_ESTIMATE"))
    });
    let mut explanations = Vec::new();
    if let Some(notices) = result
        .and_then(|v| v.get("notices"))
        .and_then(Value::as_array)
    {
        for notice in notices {
            if matches!(
                field(notice, "code"),
                Some("CONDITIONAL_ROSTER_FREE_FORECAST" | "TARGET_RULE_FORECAST")
            ) {
                let message = field(notice, "message").ok_or(TargetError::InvalidInput)?;
                if !explanations.contains(&message) {
                    explanations.push(message);
                }
            }
        }
    }
    let mut rows = Vec::new();
    if let Some(adjustments) = adjustments {
        for line in adjustments {
            let date = field(line, "date").ok_or(TargetError::InvalidInput)?;
            let parts = date.split('-').collect::<Vec<_>>();
            let date_text = if parts.len() == 3 {
                format!("{}.{}.{}", parts[2], parts[1], parts[0])
            } else {
                return Err(TargetError::InvalidInput);
            };
            let amount_text = if field(line, "status") == Some("PENDING") {
                "Nicht eingerechnet · Berechnungsgrundlage fehlt".into()
            } else {
                format!(
                    "−{} h",
                    minute_text(
                        line.get("minutes")
                            .and_then(Value::as_i64)
                            .ok_or(TargetError::InvalidInput)?
                    )
                )
            };
            rows.push(json!({"dateText":date_text,"amountText":amount_text}));
        }
    }
    let target_text = match result
        .and_then(|v| v.get("targetMinutes"))
        .and_then(Value::as_i64)
    {
        Some(minutes) => format!("{} h", minute_text(minutes)),
        None => "Nicht verfügbar".into(),
    };
    let base_text = result
        .and_then(|v| v.get("baseMinutes"))
        .and_then(Value::as_i64)
        .map(minute_text);
    Ok(
        json!({"month":month,"calculation":calculation,"employmentLabel":employment_label,"modelLabel":model_label,"trainingGuard":training_guard,"projection":projection,"forecastExplanation":explanations.join(" "),"unsupported":has_code(result,&["TARIFF_UNSUPPORTED","TARIFF_VERSION_UNREVIEWED"]),"inputStatus":input.and_then(|v|v.get("status")),"targetText":target_text,"baseText":base_text,"adjustmentRows":rows,"showYouthRetry":training_guard.and_then(|v|field(v,"code"))==Some("TRAINING_YOUTH_PREFERENCE_ERROR"),"showCalculationRetry":input.and_then(|v|field(v,"status"))==Some("error"),"showHolidayRegion":has_code(result,&["HOLIDAY_REGION_UNKNOWN"]),"showTrainingArea":training_guard.is_none()&&periods.iter().any(|period|period.get("tariff").and_then(|v|field(v,"kind"))==Some("TVAL_COMMON")),"showReferenceNotice":has_code(result,&["WORK_MODEL_UNKNOWN","EMPLOYMENT_REFERENCE_UNCONFIRMED","FIXED_DISTRIBUTION_CHANGED"]),"showWorkProfile":result.and_then(|v|field(v,"status"))==Some("UNAVAILABLE")&&training_guard.is_none()}),
    )
}
