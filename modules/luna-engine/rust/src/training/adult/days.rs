use super::super::{PreparedTrainingProfiles, PreparedYouthEntries, TrainingDay, TrainingError};
use super::{
    AdultTrainingResult,
    book::{Book, Spec},
};
use crate::{calendar::parse_date, rules::RuleResolver};
use jiff::{ToSpan, Unit};
pub(super) fn prepare<'a>(
    month: &str,
    entries: &PreparedYouthEntries<'_>,
    profiles: &'a PreparedTrainingProfiles,
    resolver: &'a RuleResolver,
    book: &mut Book<'_>,
    result: &mut AdultTrainingResult,
) -> Result<Vec<TrainingDay<'a>>, TrainingError> {
    let first =
        parse_date(&format!("{month}-01")).map_err(|_| super::super::helpers::temporal())?;
    let mut date = first
        .checked_sub(7.days())
        .map_err(|_| super::super::helpers::temporal())?;
    let end = first
        .checked_add(1.months().days(7))
        .map_err(|_| super::super::helpers::temporal())?;
    let mut days = vec![];
    while date < end {
        let id = date.to_string();
        if let Some(saved) = profiles.for_date(&id)? {
            let data = &saved["data"];
            if data["status"] == "training"
                && let Some(birth) = data["birthDate"].as_str()
            {
                let age = i64::from(
                    parse_date(birth)
                        .map_err(|_| super::super::helpers::temporal())?
                        .until((Unit::Year, date))
                        .map_err(|_| super::super::helpers::temporal())?
                        .get_years(),
                );
                let legal = resolver
                    .resolve_legal(&id)
                    .ok()
                    .filter(|legal| legal.rules().get("adultTraining").is_some());
                if let Some(legal) = legal {
                    let day = super::super::days::native_adult_day(&id, age, data, entries, legal)?;
                    if data["training"]["startedOn"]
                        .as_str()
                        .expect("normalized training start")
                        > id.as_str()
                    {
                        book.report(&days,Some(&day),&id,Spec::new("TRAINING_NOT_STARTED","INCOMPLETE","Der Ausbildungsstatus liegt vor dem angegebenen Ausbildungsbeginn.","Ausbildungsgrundlage",vec![]));
                    } else {
                        days.push(day);
                        super::school::assess_day(
                            &days,
                            days.last().expect("just appended"),
                            entries.profile(),
                            entries.problems(),
                            book,
                            result,
                        )?;
                    }
                } else if age >= 18 {
                    book.report(&days,None,&id,Spec::new("TRAINING_RULES_MISSING","INCOMPLETE","Für die Ausbildungsgrundlage fehlt ein unterstützter Regelstand im aktiven Katalog.","Ausbildungsrecht",vec![]));
                }
            }
        }
        date = date
            .checked_add(1.days())
            .map_err(|_| super::super::helpers::temporal())?;
    }
    Ok(days)
}
