use super::{
    TrainingError,
    helpers::{self, exact, nullable_integer},
};
use serde_json::{Value, json};
#[derive(Clone)]
struct Interval {
    start: String,
    end: String,
    from: i128,
    until: i128,
}
impl Interval {
    fn json(&self) -> Value {
        json!({"start":self.start,"end":self.end})
    }
}
fn intervals(value: &Value, allow_empty: bool) -> Result<Vec<Interval>, TrainingError> {
    let values = value
        .as_array()
        .filter(|v| v.len() <= 96 && (allow_empty || !v.is_empty()))
        .ok_or_else(|| TrainingError::invalid("Zeitintervalle fehlen oder sind ungültig."))?;
    let mut previous = None;
    let mut result = Vec::new();
    for value in values {
        let raw = exact(value, &["start", "end"])?;
        let start = helpers::instant(&raw["start"], "Beginn")?;
        let end = helpers::instant(&raw["end"], "Ende")?;
        let invalid = || {
            TrainingError::invalid(
                "Zeitintervalle müssen minutengenau, geordnet und überschneidungsfrei sein.",
            )
        };
        let from = helpers::millis(&raw["start"]).ok_or_else(invalid)?;
        let until = helpers::millis(&raw["end"]).ok_or_else(invalid)?;
        if from % 60000 != 0
            || until % 60000 != 0
            || until <= from
            || previous.is_some_and(|v| from < v)
            || until - from > 25 * 60 * 60000
        {
            return Err(invalid());
        }
        previous = Some(until);
        result.push(Interval {
            start,
            end,
            from,
            until,
        });
    }
    Ok(result)
}
fn overlap(a: &Interval, b: &Interval) -> bool {
    a.from < b.until && b.from < a.until
}
fn located(value: &Value, minutes: &Value) -> Result<Option<Interval>, TrainingError> {
    if value.is_null() {
        return Ok(None);
    }
    let interval = intervals(&json!([value]), false)?
        .pop()
        .expect("one interval");
    if minutes.is_null()
        || minutes.as_f64() != Some((interval.until - interval.from) as f64 / 60000.0)
    {
        return Err(TrainingError::invalid(
            "Verorteter Weg und bestätigte Wegezeit stimmen nicht überein.",
        ));
    }
    Ok(Some(interval))
}
fn travel_check(
    from: Option<&Interval>,
    to: Option<&Interval>,
    active: &[Interval],
    pauses: Option<&[Interval]>,
    school: bool,
) -> Result<(), TrainingError> {
    for interval in [from, to].into_iter().flatten() {
        if active
            .iter()
            .chain(pauses.unwrap_or_default())
            .any(|other| overlap(interval, other))
        {
            return Err(TrainingError::invalid(if school {
                "Schulweg darf sich nicht mit Unterricht oder Pause überschneiden."
            } else {
                "Prüfungsweg darf sich nicht mit Teilnahme oder Pause überschneiden."
            }));
        }
    }
    if let (Some(from), Some(to)) = (from, to)
        && overlap(from, to)
    {
        return Err(TrainingError::invalid(if school {
            "Schulwege dürfen sich nicht überschneiden."
        } else {
            "Prüfungswege dürfen sich nicht überschneiden."
        }));
    }
    if from.is_some_and(|from| from.until > active[0].from)
        || to.is_some_and(|to| to.from < active[active.len() - 1].until)
    {
        return Err(TrainingError::invalid(if school {
            "Schulwege müssen vor oder nach dem Unterricht liegen."
        } else {
            "Prüfungswege müssen vor oder nach der Teilnahme liegen."
        }));
    }
    Ok(())
}
pub fn validate_shift_training_data(value: &Value) -> Result<Value, TrainingError> {
    let version = helpers::version(value)
        .filter(|v| [1, 2, 3].contains(v))
        .ok_or_else(|| TrainingError::invalid("Unbekannte Schul-/Pausenversion."))?;
    let raw = exact(
        value,
        if version == 1 {
            &["version", "pauses", "school"]
        } else {
            &["version", "pauses", "school", "exam"]
        },
    )?;
    let pauses = if raw["pauses"].is_null() {
        None
    } else {
        Some(intervals(&raw["pauses"], true)?)
    };
    let school = if !raw["school"].is_null() {
        let mut keys = vec![
            "lessons",
            "travelToWorkMinutes",
            "travelFromWorkMinutes",
            "block",
        ];
        if version == 3 {
            keys.extend(["travelToWorkInterval", "travelFromWorkInterval"]);
        }
        let s = exact(&raw["school"], &keys)?;
        let lessons = intervals(&s["lessons"], false)?;
        let to_minutes = nullable_integer(&s["travelToWorkMinutes"], 0, 720)?;
        let from_minutes = nullable_integer(&s["travelFromWorkMinutes"], 0, 720)?;
        let to = if version == 3 {
            located(&s["travelToWorkInterval"], &to_minutes)?
        } else {
            None
        };
        let from = if version == 3 {
            located(&s["travelFromWorkInterval"], &from_minutes)?
        } else {
            None
        };
        let block = if s["block"].is_null() {
            Value::Null
        } else {
            let b = exact(&s["block"], &["startDate", "endDate"])?;
            let start = helpers::date(&b["startDate"])?;
            let end = helpers::date(&b["endDate"])?;
            if end < start {
                return Err(TrainingError::invalid("Ungültiger Schulblock."));
            }
            json!({"startDate":start,"endDate":end})
        };
        for lesson in &lessons {
            for pause in pauses.as_deref().unwrap_or_default() {
                if overlap(lesson, pause) {
                    return Err(TrainingError::invalid(
                        "Unterricht und Pause dürfen sich nicht überschneiden.",
                    ));
                }
            }
        }
        travel_check(
            from.as_ref(),
            to.as_ref(),
            &lessons,
            pauses.as_deref(),
            true,
        )?;
        let mut out = json!({"lessons":lessons.iter().map(Interval::json).collect::<Vec<_>>(),"block":block,"travelToWorkMinutes":to_minutes,"travelFromWorkMinutes":from_minutes});
        if version == 3 {
            let o = out.as_object_mut().expect("constructed school");
            o.insert(
                "travelToWorkInterval".into(),
                to.as_ref().map(Interval::json).unwrap_or(Value::Null),
            );
            o.insert(
                "travelFromWorkInterval".into(),
                from.as_ref().map(Interval::json).unwrap_or(Value::Null),
            );
        }
        out
    } else {
        Value::Null
    };
    let pauses_json = pauses
        .as_ref()
        .map(|p| p.iter().map(Interval::json).collect::<Vec<_>>());
    if version == 1 {
        return Ok(json!({"version":1,"pauses":pauses_json,"school":school}));
    }
    let exam = if !raw["exam"].is_null() {
        let mut keys = vec![
            "kind",
            "requiredByRuleOrContract",
            "finalWritten",
            "precedingWorkDate",
            "participation",
            "travelToWorkMinutes",
            "travelFromWorkMinutes",
        ];
        if version == 3 {
            keys.extend(["travelToWorkInterval", "travelFromWorkInterval"]);
        }
        let e = exact(&raw["exam"], &keys)?;
        if !matches!(e["kind"].as_str(), Some("EXAM" | "EXTERNAL_TRAINING")) {
            return Err(TrainingError::invalid("Unbekannte Prüfungsart."));
        }
        if !e["requiredByRuleOrContract"].is_null() && !e["requiredByRuleOrContract"].is_boolean()
            || !e["finalWritten"].is_null() && !e["finalWritten"].is_boolean()
            || e["kind"] == "EXTERNAL_TRAINING" && !e["finalWritten"].is_null()
            || e["finalWritten"] != true && !e["precedingWorkDate"].is_null()
            || !school.is_null()
        {
            return Err(TrainingError::invalid(
                "Prüfung und Berufsschule müssen getrennt erfasst werden.",
            ));
        }
        let participation = intervals(&e["participation"], false)?;
        let to_minutes = nullable_integer(&e["travelToWorkMinutes"], 0, 720)?;
        let from_minutes = nullable_integer(&e["travelFromWorkMinutes"], 0, 720)?;
        let to = if version == 3 {
            located(&e["travelToWorkInterval"], &to_minutes)?
        } else {
            None
        };
        let from = if version == 3 {
            located(&e["travelFromWorkInterval"], &from_minutes)?
        } else {
            None
        };
        for segment in &participation {
            for pause in pauses.as_deref().unwrap_or_default() {
                if overlap(segment, pause) {
                    return Err(TrainingError::invalid(
                        "Prüfungsteilnahme und Pause dürfen sich nicht überschneiden.",
                    ));
                }
            }
        }
        travel_check(
            from.as_ref(),
            to.as_ref(),
            &participation,
            pauses.as_deref(),
            false,
        )?;
        let preceding = if e["precedingWorkDate"].is_null() {
            None
        } else {
            Some(helpers::date(&e["precedingWorkDate"])?)
        };
        let mut out = json!({"kind":e["kind"],"requiredByRuleOrContract":e["requiredByRuleOrContract"],"finalWritten":e["finalWritten"],"precedingWorkDate":preceding,"participation":participation.iter().map(Interval::json).collect::<Vec<_>>(),"travelToWorkMinutes":to_minutes,"travelFromWorkMinutes":from_minutes});
        if version == 3 {
            let o = out.as_object_mut().expect("constructed exam");
            o.insert(
                "travelToWorkInterval".into(),
                to.as_ref().map(Interval::json).unwrap_or(Value::Null),
            );
            o.insert(
                "travelFromWorkInterval".into(),
                from.as_ref().map(Interval::json).unwrap_or(Value::Null),
            );
        }
        out
    } else {
        Value::Null
    };
    Ok(json!({"version":version,"pauses":pauses_json,"school":school,"exam":exam}))
}
