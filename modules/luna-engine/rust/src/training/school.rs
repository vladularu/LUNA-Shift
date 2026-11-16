//! School-day and block-week credit, calculated from native prepared entries.
use super::interval_math::{plain, union_minutes};
use super::{SchoolMode, TrainingDay, TrainingError, TrainingEvent};
use serde_json::{Value, json};
use std::collections::BTreeMap;
#[derive(Default)]
pub struct SchoolCredits {
    pub daily: BTreeMap<String, Option<f64>>,
    pub block_weekly: BTreeMap<String, Option<f64>>,
    pub events: Vec<TrainingEvent>,
}
impl SchoolCredits {
    pub fn to_json(&self) -> Value {
        json!({"daily":{"$type":"Map","entries":self.daily.iter().collect::<Vec<_>>()},"blockWeekly":{"$type":"Map","entries":self.block_weekly.iter().collect::<Vec<_>>()}})
    }
}
fn number(value: &Value, key: &str) -> Result<f64, TrainingError> {
    value[key]
        .as_f64()
        .ok_or_else(|| TrainingError::invalid("Ungültiger Ausbildungsregelstand."))
}
pub(super) fn spans(value: &Value) -> Result<Vec<super::YouthSpan>, TrainingError> {
    value
        .as_array()
        .ok_or_else(|| TrainingError::invalid("Ungültige Unterrichtsintervalle."))?
        .iter()
        .map(|v| {
            let start = super::helpers::millis(&v["start"])
                .and_then(|v| i64::try_from(v).ok())
                .ok_or_else(super::helpers::temporal)?;
            let end = super::helpers::millis(&v["end"])
                .and_then(|v| i64::try_from(v).ok())
                .ok_or_else(super::helpers::temporal)?;
            Ok(plain(start, end))
        })
        .collect()
}
fn work(day: &TrainingDay<'_>) -> Option<f64> {
    let work = day.work_entries();
    if work.iter().any(|e| e.pauses().is_none()) {
        None
    } else {
        Some(union_minutes(
            &work
                .iter()
                .flat_map(|e| e.work_spans(day.minimum_pause))
                .collect::<Vec<_>>(),
        ))
    }
}
fn lesson_count(day: &TrainingDay<'_>) -> Result<usize, TrainingError> {
    let minimum = number(day.school_rules, "minimumLessonMinutes")?;
    let mut count = 0;
    for e in day.school_entries() {
        count += spans(&e.school().expect("selected school")["lessons"])?
            .iter()
            .filter(|s| {
                (s.end_epoch_milliseconds() - s.start_epoch_milliseconds()) as f64 / 60000.0
                    >= minimum
            })
            .count();
    }
    Ok(count)
}
pub fn school_credits(
    days: &[TrainingDay<'_>],
    month: &str,
    mode: SchoolMode,
) -> Result<SchoolCredits, TrainingError> {
    school_credits_refs(&days.iter().collect::<Vec<_>>(), month, mode)
}
pub(super) fn school_credits_refs(
    days: &[&TrainingDay<'_>],
    month: &str,
    mode: SchoolMode,
) -> Result<SchoolCredits, TrainingError> {
    let mut result = SchoolCredits::default();
    let section = if mode == SchoolMode::Youth {
        "§ 9 JArbSchG"
    } else {
        "§ 15 BBiG"
    };
    let event = |day: &TrainingDay<'_>, code, severity, message, shift_ids| TrainingEvent {
        day_date: day.date.clone(),
        date: day.date.clone(),
        code,
        severity,
        message: String::from(message),
        section,
        shift_ids,
    };
    let work = days.iter().map(|day| work(day)).collect::<Vec<_>>();
    for (index, day) in days.iter().enumerate() {
        let mut minutes = work[index];
        for e in day.school_entries() {
            let school = e.school().expect("selected school");
            if school["travelToWorkMinutes"].is_null()
                || school["travelFromWorkMinutes"].is_null()
                || e.pauses().is_none()
            {
                minutes = None;
                result.events.push(event(
                    day,
                    "SCHOOL_CREDIT_MISSING",
                    "INCOMPLETE",
                    "Für die Schul-Anrechnung fehlen bestätigte Pausen oder notwendige Wegezeiten.",
                    vec![e.shift()["id"].as_str().expect("native entry id").into()],
                ));
            } else if let Some(previous) = minutes {
                let mut all = spans(&school["lessons"])?;
                all.extend(
                    e.pauses()
                        .expect("checked pauses")
                        .iter()
                        .filter(|p| {
                            p.start_epoch_milliseconds() >= e.start_epoch_milliseconds()
                                && p.end_epoch_milliseconds() <= e.end_epoch_milliseconds()
                        })
                        .cloned(),
                );
                minutes = Some(
                    previous
                        + (union_minutes(&all)
                            + number(school, "travelToWorkMinutes")?
                            + number(school, "travelFromWorkMinutes")?),
                );
            }
        }
        result.daily.insert(day.date.clone(), minutes);
    }
    let mut weeks = BTreeMap::<&str, Vec<usize>>::new();
    for (i, day) in days.iter().enumerate() {
        weeks.entry(&day.week).or_default().push(i);
    }
    for (week, indices) in weeks {
        let school_days = indices
            .iter()
            .copied()
            .filter(|i| !days[*i].school_entries().is_empty())
            .collect::<Vec<_>>();
        let Some(first_index) = school_days.first().copied() else {
            continue;
        };
        let first = &days[first_index];
        let block_days = school_days
            .iter()
            .copied()
            .filter(|i| {
                days[*i]
                    .school_entries()
                    .iter()
                    .any(|e| !e.school().expect("selected school")["block"].is_null())
            })
            .collect::<Vec<_>>();
        let target = &days[indices
            .iter()
            .copied()
            .find(|i| days[*i].date.starts_with(month))
            .unwrap_or(first_index)];
        let block_lessons = block_days
            .iter()
            .map(|i| lesson_count(days[*i]))
            .collect::<Result<Vec<_>, _>>()?
            .iter()
            .sum::<usize>();
        if block_days.len() as f64 >= number(first.school_rules, "blockDays")?
            && block_lessons as f64 >= number(first.school_rules, "blockLessonCount")?
        {
            let weekly = first.facts_context["averageWeeklyTrainingMinutes"].as_f64();
            let added = indices
                .iter()
                .try_fold(0.0, |sum, i| work[*i].map(|n| sum + n));
            result
                .block_weekly
                .insert(week.into(), weekly.zip(added).map(|(w, a)| w + a));
            for i in &block_days {
                result.daily.insert(
                    days[*i].date.clone(),
                    days[*i].facts_context["averageDailyTrainingMinutes"]
                        .as_f64()
                        .zip(work[*i])
                        .map(|(a, w)| a + w),
                );
            }
            if weekly.is_none()
                || block_days
                    .iter()
                    .any(|i| days[*i].facts_context["averageDailyTrainingMinutes"].is_null())
            {
                result.events.push(event(target,"BLOCK_AVERAGE_MISSING","INCOMPLETE","Für die Anrechnung des Schulblocks fehlen bestätigte durchschnittliche Ausbildungszeiten.",vec![]));
            }
            if block_days
                .iter()
                .any(|i| days[*i].facts_context["averageWeeklyTrainingMinutes"].as_f64() != weekly)
            {
                result.block_weekly.insert(week.into(), None);
                result.events.push(event(target,"BLOCK_AVERAGE_CHANGED","INCOMPLETE","Die Ausbildungszeit ändert sich innerhalb der Blockwoche. Die Anrechnungsgrundlage muss geklärt werden.",vec![]));
            }
            let extra = indices
                .iter()
                .flat_map(|i| days[*i].work_entries().into_iter().map(move |e| (*i, e)))
                .collect::<Vec<_>>();
            if !extra.is_empty() {
                let confirmed = extra.iter().all(|(i, e)| {
                    e.block_training_binding().is_some_and(|b| {
                        days[*i].facts_context["blockTrainingShiftIds"]
                            .as_array()
                            .expect("normalized bindings")
                            .iter()
                            .any(|v| v == b)
                    })
                });
                let maximum_additional = number(first.school_rules, "additionalTrainingMinutes")?;
                let within = added.is_some_and(|a| a <= maximum_additional);
                if !(mode == SchoolMode::AdultBbig && confirmed && within) {
                    result.events.push(event(target,"WORK_IN_SCHOOL_BLOCK",if confirmed&&within{"INCOMPLETE"}else{"WARNING"},if confirmed{"Zusätzliche Ausbildungszeit im Schulblock: Grenze und Anrechnung einschließlich tariflicher Ausbildungszeit fachlich prüfen."}else{"Beschäftigung im geschützten Schulblock ist nur als ausdrücklich bestätigte zusätzliche Ausbildungsveranstaltung im gesetzlichen Umfang möglich."},extra.iter().map(|(_,e)|e.shift()["id"].as_str().expect("native entry id").into()).collect()));
                }
            }
            continue;
        }
        let mut candidates = vec![];
        for i in &school_days {
            if lesson_count(days[*i])? as f64
                >= number(days[*i].school_rules, "protectedDayLessonCount")?
            {
                candidates.push(*i)
            }
        }
        let protected = candidates
            .iter()
            .copied()
            .find(|i| days[*i].work_entries().is_empty())
            .or_else(|| candidates.first().copied());
        if let Some(i) = protected {
            let day = &days[i];
            let average = day.facts_context["averageDailyTrainingMinutes"].as_f64();
            result
                .daily
                .insert(day.date.clone(), average.zip(work[i]).map(|(a, w)| a + w));
            if average.is_none() {
                result.events.push(event(day,"SCHOOL_AVERAGE_MISSING","INCOMPLETE","Die durchschnittliche tägliche Ausbildungszeit für den geschützten Schultag fehlt.",vec![]));
            }
            let entries = day.work_entries();
            if !entries.is_empty() {
                result.events.push(event(day,"PROTECTED_SCHOOL_DAY","WARNING","Mindestens einer der langen Berufsschultage dieser Woche muss von zusätzlicher Beschäftigung frei bleiben.",entries.iter().map(|e|e.shift()["id"].as_str().expect("native entry id").into()).collect()));
            }
        }
    }
    Ok(result)
}
