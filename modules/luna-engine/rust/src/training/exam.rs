//! Source-bound §10 youth exam release and training-time credit.
use super::{TrainingDay, TrainingError, TrainingEvent};
use std::collections::BTreeMap;
#[derive(Default)]
pub struct ExamCredits {
    pub daily: BTreeMap<String, Option<f64>>,
    pub events: Vec<TrainingEvent>,
}
fn event(
    day: &TrainingDay<'_>,
    date: &str,
    report: (&'static str, &'static str, &'static str, &'static str),
    shift_ids: Vec<String>,
) -> TrainingEvent {
    TrainingEvent {
        day_date: day.date.clone(),
        date: date.into(),
        code: report.0,
        severity: report.1,
        message: report.2.into(),
        section: report.3,
        shift_ids,
    }
}
fn emit(
    day: &TrainingDay<'_>,
    entry: &super::YouthEntry,
    code: &'static str,
    severity: &'static str,
    message: &'static str,
) -> TrainingEvent {
    event(
        day,
        &day.date,
        (code, severity, message, "§ 10 JArbSchG"),
        vec![
            entry.shift()["id"]
                .as_str()
                .expect("native entry id")
                .into(),
        ],
    )
}
fn has_exam_policy(day: &TrainingDay<'_>) -> bool {
    day.legal.engine_contract_version >= 10
        && day.legal.rules()["youthProtection"].get("exam").is_some()
}
pub fn assess_youth_exams(
    days: &[TrainingDay<'_>],
    base: &BTreeMap<String, Option<f64>>,
) -> Result<ExamCredits, TrainingError> {
    let mut result = ExamCredits {
        daily: base.clone(),
        events: vec![],
    };
    let by_date = days
        .iter()
        .map(|day| (day.date.as_str(), day))
        .collect::<BTreeMap<_, _>>();
    for day in days {
        for entry in day.entries.iter().filter(|entry| entry.exam().is_some()) {
            let exam = entry.exam().expect("selected exam");
            let start = entry.shift()["startTime"].as_str();
            let end = entry.shift()["endTime"].as_str();
            if start.is_none() || end.is_none() || end <= start {
                result.events.push(emit(day,entry,"EXAM_CROSS_DAY_UNSUPPORTED","INCOMPLETE","Eine Prüfung über Mitternacht wird ohne tagesgenau getrennte Teilnahme- und Wegezeiten nicht angerechnet."));
                result.daily.insert(day.date.clone(), None);
                continue;
            }
            if !has_exam_policy(day) {
                result.events.push(emit(day,entry,"EXAM_ASSESSMENT_PENDING","INCOMPLETE","Für Prüfung oder außerbetriebliche Ausbildungsmaßnahme fehlt ein unterstützter §-10-Regelstand."));
                result.daily.insert(day.date.clone(), None);
                if exam["kind"] == "EXAM" && exam["finalWritten"] == true {
                    if let Some(prior) = exam["precedingWorkDate"].as_str() {
                        result.events.push(event(by_date.get(prior).copied().unwrap_or(day),prior,("EXAM_PRECEDING_DAY_PENDING","INCOMPLETE","Der bestätigte Arbeitstag vor der schriftlichen Abschlussprüfung benötigt eine gesonderte Freistellungsprüfung.","§ 10 JArbSchG"),vec![entry.shift()["id"].as_str().expect("native entry id").into()]));
                        result.daily.insert(prior.into(), None);
                    } else {
                        result.events.push(emit(day,entry,"EXAM_PRECEDING_WORKDAY_UNKNOWN","INCOMPLETE","Der unmittelbar vorausgehende Arbeitstag ist unbekannt; er wird nicht als vorheriger Kalendertag geraten."));
                    }
                }
                continue;
            } else if exam["requiredByRuleOrContract"] != true {
                result.events.push(emit(day,entry,"EXAM_BASIS_UNCONFIRMED","INCOMPLETE","Die öffentlich-rechtliche oder vertragliche Grundlage der externen Teilnahme ist nicht bestätigt."));
                result.daily.insert(day.date.clone(), None);
            } else if entry.pauses().is_none()
                || exam["participation"]
                    .as_array()
                    .expect("native normalized exam participation")
                    .is_empty()
                || exam["travelToWorkMinutes"].is_null()
                || exam["travelFromWorkMinutes"].is_null()
            {
                result.events.push(emit(day,entry,"EXAM_CREDIT_MISSING","INCOMPLETE","Für die Prüfungsanrechnung fehlen Teilnahme-, Pausen- oder notwendige Wegezeiten."));
                result.daily.insert(day.date.clone(), None);
            } else if !day.school_entries().is_empty() {
                result.events.push(emit(day,entry,"EXAM_SCHOOL_COMBINATION","INCOMPLETE","Prüfung und Berufsschule am selben Tag benötigen eine getrennte Anrechnungsprüfung."));
                result.daily.insert(day.date.clone(), None);
            } else {
                let mut spans = super::school::spans(&exam["participation"])?;
                spans.extend_from_slice(entry.pauses().expect("checked pauses"));
                let covered = super::union_minutes(&spans);
                let credit = covered
                    + exam["travelToWorkMinutes"]
                        .as_f64()
                        .expect("normalized travel minutes")
                    + exam["travelFromWorkMinutes"]
                        .as_f64()
                        .expect("normalized travel minutes");
                if covered
                    < (entry.end_epoch_milliseconds() - entry.start_epoch_milliseconds()) as f64
                        / 60000.0
                {
                    result.events.push(emit(day,entry,"EXAM_INTERVAL_GAP_UNCLASSIFIED","INCOMPLETE","Zwischen bestätigten Teilnahme- und Pausenintervallen bleibt eine Zeitspanne ungeklärt."));
                    result.daily.insert(day.date.clone(), None);
                }
                let overlap = day.work_entries().iter().any(|w| {
                    w.start_epoch_milliseconds() < entry.end_epoch_milliseconds()
                        && entry.start_epoch_milliseconds() < w.end_epoch_milliseconds()
                });
                if overlap {
                    result.events.push(emit(day,entry,"EXAM_RELEASE_OVERLAP","WARNING","Ein Dienst überschneidet sich mit der bestätigten Prüfungsteilnahme; Freistellung ist nicht gewährleistet."));
                    result.daily.insert(day.date.clone(), None);
                } else if !matches!(result.daily.get(&day.date), Some(None)) {
                    let previous = result.daily.get(&day.date).copied().flatten();
                    result
                        .daily
                        .insert(day.date.clone(), previous.map(|p| p + credit));
                }
                let entries = day.entries.iter().collect::<Vec<_>>();
                if super::located_exam_travel(entry, &entries).is_none() {
                    result.events.push(emit(day,entry,"EXAM_TRAVEL_POSITION","INCOMPLETE","Die notwendige Wegezeit ist angerechnet, aber nicht zeitlich verortet; Ruhe- und Pausenlage bleiben offen."));
                }
            }
            if exam["kind"] != "EXAM" || exam["finalWritten"] == false {
                continue;
            }
            if exam["finalWritten"].is_null() {
                result.events.push(emit(
                    day,
                    entry,
                    "EXAM_FINAL_STATUS_UNKNOWN",
                    "INCOMPLETE",
                    "Ob es eine schriftliche Abschlussprüfung ist, wurde nicht bestätigt.",
                ));
                continue;
            }
            let Some(prior_date) = exam["precedingWorkDate"].as_str() else {
                result.events.push(emit(day,entry,"EXAM_PRECEDING_WORKDAY_UNKNOWN","INCOMPLETE","Der unmittelbar vorausgehende Arbeitstag ist unbekannt; er wird nicht als vorheriger Kalendertag geraten."));
                continue;
            };
            let prior = by_date.get(prior_date).copied();
            let Some(prior) = prior.filter(|prior| has_exam_policy(prior)) else {
                result.events.push(emit(day,entry,"EXAM_PRECEDING_DAY_PENDING","INCOMPLETE","Der bestätigte Arbeitstag vor der schriftlichen Abschlussprüfung ist im unterstützten Jugend-Regelstand nicht vollständig prüfbar."));
                result.daily.insert(prior_date.into(), None);
                continue;
            };
            let work = prior.work_entries();
            if !work.is_empty() {
                let ids = std::iter::once(entry)
                    .chain(work.iter().copied())
                    .map(|w| w.shift()["id"].as_str().expect("native entry id").into())
                    .collect();
                result.events.push(event(prior,&prior.date,("EXAM_PRECEDING_WORKDAY_NOT_FREE","WARNING","Am bestätigten Arbeitstag vor der schriftlichen Abschlussprüfung ist ein Dienst geplant; die Freistellung ist nicht gewährleistet.","§ 10 Abs. 1 Nr. 2 JArbSchG"),ids));
            }
            if !prior.school_entries().is_empty()
                || prior.entries.iter().any(|e| e.exam().is_some())
            {
                result.events.push(event(prior,&prior.date,("EXAM_PRECEDING_DAY_COMBINATION","INCOMPLETE","Weitere Ausbildungszeit am vorausgehenden Arbeitstag benötigt eine gesonderte Anrechnungsprüfung.","§ 10 Abs. 2 Nr. 2 JArbSchG"),vec![entry.shift()["id"].as_str().expect("native entry id").into()]));
                result.daily.insert(prior.date.clone(), None);
            } else if prior.facts_context["averageDailyTrainingMinutes"].is_null() {
                result.events.push(event(prior,&prior.date,("EXAM_PRECEDING_AVERAGE_MISSING","INCOMPLETE","Die bestätigte durchschnittliche tägliche Arbeitszeit für den vorausgehenden Arbeitstag fehlt.","§ 10 Abs. 2 Nr. 2 JArbSchG"),vec![entry.shift()["id"].as_str().expect("native entry id").into()]));
                result.daily.insert(prior.date.clone(), None);
            } else {
                result.daily.insert(
                    prior.date.clone(),
                    prior.facts_context["averageDailyTrainingMinutes"].as_f64(),
                );
            }
        }
    }
    Ok(result)
}
