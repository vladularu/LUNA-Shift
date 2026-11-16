use super::super::{TrainingDay, TrainingError, YouthEntry};
use super::{
    AdultTrainingResult,
    book::{Book, Spec, id},
};
use std::collections::BTreeMap;
fn emit(
    book: &mut Book<'_>,
    days: &[TrainingDay<'_>],
    day: &TrainingDay<'_>,
    entry: &YouthEntry,
    section: &'static str,
    spec: (&'static str, &'static str, &'static str),
) {
    book.report(
        days,
        Some(day),
        &day.date,
        Spec::new(spec.0, spec.1, spec.2, section, vec![id(entry)]),
    );
}
pub(super) fn assess(
    days: &[TrainingDay<'_>],
    book: &mut Book<'_>,
    result: &mut AdultTrainingResult,
) -> Result<(), TrainingError> {
    let by_date = days
        .iter()
        .map(|d| (d.date.as_str(), d))
        .collect::<BTreeMap<_, _>>();
    for day in days.iter().filter(|d| d.adult) {
        for entry in day.entries.iter().filter(|e| e.exam().is_some()) {
            let exam = entry.exam().expect("selected exam");
            let basis = day.training["training"]["legalBasis"]
                .as_str()
                .expect("normalized training basis");
            let section = if basis == "BBIG" {
                "§ 15 BBiG"
            } else {
                "§§ 18, 63 PflBG"
            };
            let policy = day.legal.rules()["adultTraining"]["bbig"].get("exam");
            if basis != "BBIG" || day.legal.engine_contract_version < 10 || policy.is_none() {
                if basis == "PFLBG"
                    && day.legal.rules()["adultTraining"]["pflbg"]["examRelease"] == true
                    && day.work_entries().iter().any(|w| {
                        w.start_epoch_milliseconds() < entry.end_epoch_milliseconds()
                            && entry.start_epoch_milliseconds() < w.end_epoch_milliseconds()
                    })
                {
                    emit(
                        book,
                        days,
                        day,
                        entry,
                        section,
                        (
                            "EXAM_RELEASE_OVERLAP",
                            "WARNING",
                            "Ein Dienst überschneidet sich mit der Prüfung. Sofern § 18 PflBG gilt, ist die Freistellung nicht gewährleistet; Ausnahmen nach § 25 sind gesondert zu prüfen.",
                        ),
                    );
                }
                emit(
                    book,
                    days,
                    day,
                    entry,
                    section,
                    (
                        "EXAM_ASSESSMENT_PENDING",
                        "INCOMPLETE",
                        if basis == "PFLBG" {
                            "Die Prüfungsfreistellung nach PflBG ist erfasst; eine BBiG-Anrechnung wird nicht unterstellt."
                        } else {
                            "Für diesen Ausbildungsgang fehlt ein unterstützter Prüfungs-Anrechnungsvertrag."
                        },
                    ),
                );
                result.daily_credits.insert(day.date.clone(), None);
                if exam["kind"] == "EXAM" && exam["finalWritten"] == true {
                    if basis == "BBIG"
                        && let Some(prior) = exam["precedingWorkDate"].as_str()
                    {
                        book.report(days,Some(by_date.get(prior).copied().unwrap_or(day)),prior,Spec::new("EXAM_PRECEDING_DAY_PENDING","INCOMPLETE","Der vorausgehende Arbeitstag der schriftlichen Abschlussprüfung benötigt eine gesonderte Freistellungsprüfung.",section,vec![id(entry)]));
                        result.daily_credits.insert(prior.into(), None);
                    } else {
                        emit(
                            book,
                            days,
                            day,
                            entry,
                            section,
                            (
                                if basis == "PFLBG" {
                                    "EXAM_PFLBG_PRECEDING_DAY_NOT_ASSUMED"
                                } else {
                                    "EXAM_PRECEDING_WORKDAY_UNKNOWN"
                                },
                                "INCOMPLETE",
                                "Ein pauschaler freier Tag vor der Prüfung wird für diese Ausbildungsgrundlage nicht angenommen.",
                            ),
                        );
                    }
                }
                continue;
            }
            let start = entry.shift()["startTime"].as_str();
            let end = entry.shift()["endTime"].as_str();
            if start.is_none() || end.is_none() || end <= start {
                emit(
                    book,
                    days,
                    day,
                    entry,
                    section,
                    (
                        "EXAM_CROSS_DAY_UNSUPPORTED",
                        "INCOMPLETE",
                        "Eine Prüfung über Mitternacht wird ohne tagesgenaue Intervalle nicht angerechnet.",
                    ),
                );
                result.daily_credits.insert(day.date.clone(), None);
                continue;
            }
            if exam["requiredByRuleOrContract"] != true {
                emit(
                    book,
                    days,
                    day,
                    entry,
                    section,
                    (
                        "EXAM_BASIS_UNCONFIRMED",
                        "INCOMPLETE",
                        "Die öffentlich-rechtliche oder vertragliche Grundlage der externen Teilnahme ist nicht bestätigt.",
                    ),
                );
                result.daily_credits.insert(day.date.clone(), None);
            } else if entry.pauses().is_none()
                || exam["participation"]
                    .as_array()
                    .expect("normalized participation")
                    .is_empty()
                || exam["travelToWorkMinutes"].is_null()
                || exam["travelFromWorkMinutes"].is_null()
            {
                emit(
                    book,
                    days,
                    day,
                    entry,
                    section,
                    (
                        "EXAM_CREDIT_MISSING",
                        "INCOMPLETE",
                        "Für die Anrechnung fehlen Teilnahme-, Pausen- oder notwendige Wegezeiten.",
                    ),
                );
                result.daily_credits.insert(day.date.clone(), None);
            } else if !day.school_entries().is_empty() {
                emit(
                    book,
                    days,
                    day,
                    entry,
                    section,
                    (
                        "EXAM_SCHOOL_COMBINATION",
                        "INCOMPLETE",
                        "Prüfung und Berufsschule am selben Tag benötigen eine getrennte Anrechnungsprüfung.",
                    ),
                );
                result.daily_credits.insert(day.date.clone(), None);
            } else if day.entries.iter().filter(|e| e.exam().is_some()).count() > 1 {
                emit(
                    book,
                    days,
                    day,
                    entry,
                    section,
                    (
                        "EXAM_MULTIPLE_ENTRIES",
                        "INCOMPLETE",
                        "Mehrere Prüfungs- oder Ausbildungsmaßnahmen am selben Tag werden nicht doppelt angerechnet.",
                    ),
                );
                result.daily_credits.insert(day.date.clone(), None);
            } else {
                let mut spans = super::super::school::spans(&exam["participation"])?;
                spans.extend_from_slice(entry.pauses().expect("checked pauses"));
                let covered = super::super::union_minutes(&spans);
                if covered
                    < (entry.end_epoch_milliseconds() - entry.start_epoch_milliseconds()) as f64
                        / 60000.0
                {
                    emit(
                        book,
                        days,
                        day,
                        entry,
                        section,
                        (
                            "EXAM_INTERVAL_GAP_UNCLASSIFIED",
                            "INCOMPLETE",
                            "Zwischen Teilnahme und bestätigten Pausen bleibt eine Zeitspanne ungeklärt.",
                        ),
                    );
                    result.daily_credits.insert(day.date.clone(), None);
                }
                if day.work_entries().iter().any(|w| {
                    w.start_epoch_milliseconds() < entry.end_epoch_milliseconds()
                        && entry.start_epoch_milliseconds() < w.end_epoch_milliseconds()
                }) {
                    emit(
                        book,
                        days,
                        day,
                        entry,
                        section,
                        (
                            "EXAM_RELEASE_OVERLAP",
                            "WARNING",
                            "Ein Dienst überschneidet sich mit der bestätigten Prüfungsteilnahme.",
                        ),
                    );
                    result.daily_credits.insert(day.date.clone(), None);
                } else if !matches!(result.daily_credits.get(&day.date), Some(None)) {
                    let previous = result
                        .daily_credits
                        .get(&day.date)
                        .copied()
                        .flatten()
                        .unwrap_or(0.0);
                    result.daily_credits.insert(
                        day.date.clone(),
                        Some(
                            previous
                                + covered
                                + exam["travelToWorkMinutes"]
                                    .as_f64()
                                    .expect("normalized travel")
                                + exam["travelFromWorkMinutes"]
                                    .as_f64()
                                    .expect("normalized travel"),
                        ),
                    );
                }
                if exam["travelToWorkMinutes"]
                    .as_f64()
                    .expect("normalized travel")
                    > 0.0
                    || exam["travelFromWorkMinutes"]
                        .as_f64()
                        .expect("normalized travel")
                        > 0.0
                {
                    emit(
                        book,
                        days,
                        day,
                        entry,
                        section,
                        (
                            "EXAM_TRAVEL_POSITION",
                            "INCOMPLETE",
                            "Notwendige Wegezeit ist angerechnet, aber zeitlich nicht verortet.",
                        ),
                    );
                }
            }
            if result.block_weekly_credits.contains_key(&day.week) {
                result.block_weekly_credits.insert(day.week.clone(), None);
                emit(
                    book,
                    days,
                    day,
                    entry,
                    section,
                    (
                        "EXAM_BLOCK_COMBINATION",
                        "INCOMPLETE",
                        "Prüfung und geschützter Schulblock benötigen eine gesonderte Wochenanrechnung.",
                    ),
                );
            }
            if exam["kind"] != "EXAM" || exam["finalWritten"] == false {
                continue;
            }
            if exam["finalWritten"].is_null() || exam["precedingWorkDate"].is_null() {
                emit(
                    book,
                    days,
                    day,
                    entry,
                    section,
                    (
                        "EXAM_PRECEDING_WORKDAY_UNKNOWN",
                        "INCOMPLETE",
                        "Der Arbeitstag vor einer schriftlichen Abschlussprüfung ist nicht bestätigt.",
                    ),
                );
                continue;
            }
            let prior_date = exam["precedingWorkDate"]
                .as_str()
                .expect("normalized preceding date");
            let prior = by_date.get(prior_date).copied().filter(|prior| {
                prior.adult
                    && prior.training["training"]["legalBasis"] == "BBIG"
                    && prior.legal.engine_contract_version >= 10
                    && prior.legal.rules()["adultTraining"]["bbig"]
                        .get("exam")
                        .is_some()
            });
            let Some(prior) = prior else {
                emit(
                    book,
                    days,
                    day,
                    entry,
                    section,
                    (
                        "EXAM_PRECEDING_DAY_PENDING",
                        "INCOMPLETE",
                        "Der vorausgehende Arbeitstag liegt außerhalb einer bestätigten volljährigen BBiG-Regelgrundlage.",
                    ),
                );
                result.daily_credits.insert(prior_date.into(), None);
                continue;
            };
            let work = prior.work_entries();
            if !work.is_empty() {
                book.report(days,Some(prior),&prior.date,Spec::new("EXAM_PRECEDING_WORKDAY_NOT_FREE","WARNING","Am bestätigten Arbeitstag vor der schriftlichen Abschlussprüfung ist ein Dienst geplant.",section,std::iter::once(entry).chain(work).map(id).collect()));
            }
            if !prior.school_entries().is_empty()
                || prior.entries.iter().any(|e| e.exam().is_some())
            {
                book.report(days,Some(prior),&prior.date,Spec::new("EXAM_PRECEDING_DAY_COMBINATION","INCOMPLETE","Weitere Ausbildungszeit am vorausgehenden Arbeitstag benötigt eine gesonderte Anrechnungsprüfung.",section,vec![id(entry)]));
                result.daily_credits.insert(prior.date.clone(), None);
            } else if prior.facts_context["averageDailyTrainingMinutes"].is_null() {
                book.report(
                    days,
                    Some(prior),
                    &prior.date,
                    Spec::new(
                        "EXAM_PRECEDING_AVERAGE_MISSING",
                        "INCOMPLETE",
                        "Die bestätigte durchschnittliche tägliche Ausbildungszeit fehlt.",
                        section,
                        vec![id(entry)],
                    ),
                );
                result.daily_credits.insert(prior.date.clone(), None);
            } else {
                result.daily_credits.insert(
                    prior.date.clone(),
                    prior.facts_context["averageDailyTrainingMinutes"].as_f64(),
                );
            }
        }
    }
    Ok(())
}
