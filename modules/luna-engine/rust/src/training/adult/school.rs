use super::super::{SchoolMode, TrainingDay, TrainingError};
use super::{
    AdultTrainingResult,
    book::{Book, Spec, id},
};
use serde_json::Value;
pub(super) fn assess_day(
    days: &[TrainingDay<'_>],
    day: &TrainingDay<'_>,
    profile: &Value,
    problems: &[super::super::PreparationProblem],
    book: &mut Book<'_>,
    result: &mut AdultTrainingResult,
) -> Result<(), TrainingError> {
    let basis = day.training["training"]["legalBasis"]
        .as_str()
        .expect("normalized training basis");
    if matches!(basis, "UNKNOWN" | "OTHER") {
        book.report(days,Some(day),&day.date,Spec::new("TRAINING_BASIS_UNKNOWN","INCOMPLETE","Die Ausbildungsgrundlage ist nicht unterstützt oder noch ungeklärt. BBiG-Regeln werden nicht pauschal übernommen.","Ausbildungsgrundlage",vec![]));
        return Ok(());
    }
    let section = if basis == "BBIG" {
        "§ 15 BBiG"
    } else {
        "§§ 18, 63 PflBG"
    };
    for problem in problems.iter().filter(|p| p.date() == day.date) {
        book.report(
            days,
            Some(day),
            &day.date,
            Spec::new(
                problem.code(),
                "INCOMPLETE",
                problem.message(),
                section,
                vec![problem.shift_id().into()],
            ),
        );
    }
    if day.facts_context["allWorkAndSchoolRecorded"] != true
        || profile["allEmploymentWorkRecorded"] != true
    {
        book.report(days,Some(day),&day.date,Spec::new("TRAINING_SCOPE_INCOMPLETE","INCOMPLETE","Bitte bestätigen, dass alle Beschäftigungen und Ausbildungsveranstaltungen eingetragen sind.",section,vec![]));
    }
    let policy = &day.legal.rules()["adultTraining"];
    for school in day.school_entries() {
        let work = day.work_entries();
        let overlaps = work
            .iter()
            .copied()
            .filter(|w| {
                w.start_epoch_milliseconds() < school.end_epoch_milliseconds()
                    && w.end_epoch_milliseconds() > school.start_epoch_milliseconds()
            })
            .collect::<Vec<_>>();
        if !overlaps.is_empty() && (basis == "BBIG" || policy["pflbg"]["schoolRelease"] == true) {
            book.report(days,Some(day),&day.date,Spec::new("SCHOOL_RELEASE_OVERLAP","WARNING","Dienst und Unterricht überschneiden sich. Die Freistellung für die Teilnahme ist nicht gewährleistet.",section,std::iter::once(school).chain(overlaps).map(id).collect()));
        }
        if basis == "BBIG"
            && (super::super::clock_minutes(
                school.start_epoch_milliseconds(),
                profile["timeZone"]
                    .as_str()
                    .ok_or_else(super::super::helpers::temporal)?,
            )? as f64)
                < super::super::days::amount(&policy["bbig"]["school"], "earlyStartMinute")?
            && work
                .iter()
                .any(|w| w.start_epoch_milliseconds() < school.start_epoch_milliseconds())
        {
            book.report(days,Some(day),&day.date,Spec::new("WORK_BEFORE_EARLY_SCHOOL","WARNING","Vor dem früh beginnenden Berufsschulunterricht ist keine Beschäftigung zulässig.",section,std::iter::once(school).chain(work.iter().copied()).map(id).collect()));
        }
        let data = school.school().expect("selected school");
        if data["travelToWorkMinutes"].as_f64() != Some(0.0)
            || data["travelFromWorkMinutes"].as_f64() != Some(0.0)
        {
            book.report(days,Some(day),&day.date,Spec::new("SCHOOL_TRAVEL_POSITION","INCOMPLETE","Notwendige Schul-/Arbeitswege sind für Pausen und Ruhezeit noch zeitlich zu verorten. Die Dauer wird nicht als Ruhepause angenommen.",section,vec![id(school)]));
        }
        if basis == "PFLBG" {
            let amount = if school.pauses().is_none()
                || data["travelToWorkMinutes"].is_null()
                || data["travelFromWorkMinutes"].is_null()
            {
                None
            } else {
                let mut spans = super::super::school::spans(&data["lessons"])?;
                spans.extend_from_slice(school.pauses().expect("checked pauses"));
                Some(
                    super::super::union_minutes(&spans)
                        + data["travelToWorkMinutes"]
                            .as_f64()
                            .expect("normalized travel")
                        + data["travelFromWorkMinutes"]
                            .as_f64()
                            .expect("normalized travel"),
                )
            };
            let previous = result.daily_credits.get(&day.date).copied();
            result.daily_credits.insert(
                day.date.clone(),
                match (amount, previous) {
                    (Some(_), Some(None)) => None,
                    (Some(a), p) => Some(p.flatten().unwrap_or(0.0) + a),
                    _ => None,
                },
            );
            if amount.is_none() {
                book.report(days,Some(day),&day.date,Spec::new("SCHOOL_CREDIT_MISSING","INCOMPLETE","Für die dokumentierte Teilnahmezeit fehlen Pausen oder notwendige Wegezeiten.",section,vec![id(school)]));
            }
            if policy["pflbg"]["preparationTimeRequired"] == true && !work.is_empty() {
                book.report(days,Some(day),&day.date,Spec::new("PFLBG_PREPARATION","INCOMPLETE","Bei zusätzlichem Dienst müssen erforderliche Lern- und Vorbereitungszeiten berücksichtigt sein. Es wird kein pauschaler BBiG-Freitag angenommen.",section,std::iter::once(school).chain(work).map(id).collect()));
            }
        }
    }
    Ok(())
}
pub(super) fn apply_bbig(
    days: &[TrainingDay<'_>],
    book: &mut Book<'_>,
    result: &mut AdultTrainingResult,
) -> Result<(), TrainingError> {
    let bbig = days
        .iter()
        .filter(|d| d.training["training"]["legalBasis"] == "BBIG")
        .collect::<Vec<_>>();
    let credit =
        super::super::school::school_credits_refs(&bbig, book.month, SchoolMode::AdultBbig)?;
    for (date, minutes) in credit.daily {
        if bbig.iter().any(|d| d.date == date && d.adult) {
            result.daily_credits.insert(date, minutes);
        }
    }
    result.block_weekly_credits = credit.block_weekly;
    for e in credit.events {
        let day = days
            .iter()
            .find(|d| d.date == e.day_date)
            .expect("native school event day");
        book.report(
            days,
            Some(day),
            &e.date,
            Spec::new(e.code, e.severity, e.message, e.section, e.shift_ids),
        );
    }
    Ok(())
}
