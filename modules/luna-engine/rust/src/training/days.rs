//! Native day selection and clipping; no host-created day or credit constructor.
use super::{PreparedTrainingProfiles, PreparedYouthEntries, TrainingError, YouthEntry};
use crate::rules::{RulePackage, RuleResolver};
use crate::{calendar::parse_date, time};
use jiff::{
    ToSpan, Unit,
    civil::{Date, Time},
    tz::Disambiguation,
};
use serde_json::{Value, json};
use std::sync::OnceLock;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SchoolMode {
    Youth,
    AdultBbig,
}
pub struct TrainingDay<'a> {
    pub(super) date: String,
    pub(super) week: String,
    pub(super) age: i64,
    pub(super) adult: bool,
    pub(super) training: &'a Value,
    pub(super) facts_context: &'a Value,
    pub(super) facts_from: &'a str,
    pub(super) legal: &'a RulePackage,
    pub(super) school_rules: &'a Value,
    pub(super) minimum_pause: f64,
    pub(super) entries: Vec<YouthEntry>,
}
impl TrainingDay<'_> {
    pub fn date(&self) -> &str {
        &self.date
    }
    pub fn week(&self) -> &str {
        &self.week
    }
    pub fn age(&self) -> i64 {
        self.age
    }
    pub fn adult(&self) -> bool {
        self.adult
    }
    pub fn training(&self) -> &Value {
        self.training
    }
    pub fn legal(&self) -> &RulePackage {
        self.legal
    }
    pub fn school_rules(&self) -> &Value {
        self.school_rules
    }
    pub fn minimum_pause_minutes(&self) -> f64 {
        self.minimum_pause
    }
    pub fn entries(&self) -> &[YouthEntry] {
        &self.entries
    }
    pub fn school_entries(&self) -> Vec<&YouthEntry> {
        self.entries
            .iter()
            .filter(|e| e.school().is_some())
            .collect()
    }
    pub fn work_entries(&self) -> Vec<&YouthEntry> {
        self.entries
            .iter()
            .filter(|e| e.school().is_none() && e.exam().is_none())
            .collect()
    }
    pub fn facts(&self) -> Value {
        let mut facts = self.facts_context.clone();
        facts
            .as_object_mut()
            .expect("native normalized facts")
            .insert("effectiveFrom".into(), json!(self.facts_from));
        facts
    }
}
pub(super) fn unknown_context() -> &'static Value {
    static UNKNOWN: OnceLock<Value> = OnceLock::new();
    UNKNOWN.get_or_init(||json!({"careInstitution":null,"medicalEmergencyService":null,"multiShiftOperation":null,"otherExceptions":null,"allWorkAndSchoolRecorded":null,"pausesPredefined":null,"averageDailyTrainingMinutes":null,"averageWeeklyTrainingMinutes":null,"shortenedWorkingDays":[],"blockTrainingShiftIds":[],"holidayLostMinutes":{}}))
}
pub(super) fn amount(value: &Value, key: &str) -> Result<f64, TrainingError> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .ok_or_else(|| TrainingError::invalid("Ungültiger Ausbildungsregelstand."))
}
pub(super) fn native_adult_day<'a>(
    date: &str,
    age: i64,
    training: &'a Value,
    prepared: &PreparedYouthEntries<'_>,
    legal: &'a RulePackage,
) -> Result<TrainingDay<'a>, TrainingError> {
    let policy = &legal.rules()["adultTraining"];
    Ok(TrainingDay {
        date: date.into(),
        week: super::week_start(date)?,
        age,
        adult: age as f64 >= amount(policy, "minimumAge")?,
        training,
        facts_context: training
            .get("youth")
            .filter(|v| !v.is_null())
            .unwrap_or_else(|| unknown_context()),
        facts_from: training["effectiveFrom"]
            .as_str()
            .expect("normalized effective date"),
        legal,
        school_rules: &policy["bbig"]["school"],
        minimum_pause: amount(&legal.rules()["breaks"], "minimumSegmentMinutes")?,
        entries: prepared
            .entries()
            .iter()
            .filter(|e| e.shift()["date"] == date)
            .map(|e| (*e).clone())
            .collect(),
    })
}
fn day_start(date: Date, zone: &str) -> Result<i64, TrainingError> {
    time::zone(zone)
        .map_err(|_| super::helpers::temporal())?
        .to_ambiguous_zoned(date.to_datetime(Time::midnight()))
        .disambiguate(Disambiguation::Compatible)
        .and_then(|z| z.start_of_day())
        .map(|z| z.timestamp().as_millisecond())
        .map_err(|_| super::helpers::temporal())
}
pub(super) struct YouthDays<'a> {
    pub days: Vec<TrainingDay<'a>>,
    pub preliminary: Vec<super::youth_report::Prelude<'a>>,
}
pub(super) fn profile_age(data: &Value, date: &str) -> Result<Option<i64>, TrainingError> {
    let Some(birth) = data["birthDate"].as_str() else {
        return Ok(None);
    };
    let birth = parse_date(birth).map_err(|_| super::helpers::temporal())?;
    let date = parse_date(date).map_err(|_| super::helpers::temporal())?;
    birth
        .until((Unit::Year, date))
        .map(|span| Some(i64::from(span.get_years())))
        .map_err(|_| super::helpers::temporal())
}
pub(super) fn prepare_youth_days<'a>(
    prepared: &PreparedYouthEntries<'_>,
    profiles: &'a PreparedTrainingProfiles,
    month: &str,
    resolver: &'a RuleResolver,
) -> Result<YouthDays<'a>, TrainingError> {
    use super::youth_report::{Context, notice};
    let first = parse_date(&format!("{month}-01")).map_err(|_| super::helpers::temporal())?;
    let mut date = first
        .checked_sub(14.days())
        .map_err(|_| super::helpers::temporal())?;
    let end = first
        .checked_add(1.months().days(14))
        .map_err(|_| super::helpers::temporal())?;
    let mut out = YouthDays {
        days: vec![],
        preliminary: vec![],
    };
    while date < end {
        let id = date.to_string();
        let build=||->Result<(Option<TrainingDay<'a>>,Vec<super::youth_report::Prelude<'a>>),TrainingError>{
            let training=profiles.for_date(&id)?.map(|p|&p["data"]);
            let Some(training)=training.filter(|p|p["birthDate"].as_str().is_some())else{return Ok((None,vec![notice(&id,None,"BIRTH_DATE_MISSING","Ein bestätigtes Geburtsdatum mit passendem Gültigkeitszeitraum fehlt.","§ 2 JArbSchG",vec![])]))};
            let legal=resolver.resolve_legal(&id).ok().filter(|p|p.engine_contract_version>=9&&p.rules().get("youthProtection").is_some());
            let Some(legal)=legal else{return Ok((None,vec![notice(&id,None,"YOUTH_RULES_MISSING","Für diesen Tag ist kein unterstütztes Jugendregelpaket im aktiven Katalog verfügbar.","JArbSchG",vec![])]))};
            let rules=&legal.rules()["youthProtection"];let age=profile_age(training,&id)?.expect("confirmed birth date");
            if age as f64>=amount(rules,"adultAge")? {return Ok((None,vec![]))}
            let facts=training.get("youth").filter(|v|!v.is_null()).unwrap_or_else(||unknown_context());let context=Context{legal,facts};
            let zone=prepared.profile()["timeZone"].as_str().ok_or_else(super::helpers::temporal)?;let start=day_start(date,zone)?;let end=day_start(date.checked_add(1.days()).map_err(|_|super::helpers::temporal())?,zone)?;
            if (age as f64)<amount(rules,"minimumAge")?||training["fullTimeCompulsorySchooling"]!=false {return Ok((None,vec![notice(&id,Some(context),"SPECIAL_AGE_OR_SCHOOL_DUTY","Unter 15 Jahren, bei Vollzeitschulpflicht oder ungeklärter Schulpflicht ist keine vereinfachte Jugend-Standardprüfung möglich.","§§ 2, 5–7 JArbSchG",vec![])]))}
            let entries=prepared.entries().iter().filter(|e|e.start_epoch_milliseconds()<end&&e.end_epoch_milliseconds()>start).map(|e|e.clipped(start,end)).collect();
            let day=TrainingDay{date:id.clone(),week:super::week_start(&id)?,age,adult:false,training,facts_context:facts,facts_from:training["effectiveFrom"].as_str().expect("normalized effective date"),legal,school_rules:&rules["school"],minimum_pause:amount(&rules["breaks"],"minimumSegmentMinutes")?,entries};
            let notices=prepared.problems().iter().filter(|p|p.date()==id).map(|p|notice(&id,Some(context),p.code(),p.message(),"§§ 4, 11 JArbSchG",vec![p.shift_id().into()])).collect();
            Ok((Some(day),notices))
        };
        let (day, notices) = build()?;
        if let Some(day) = day {
            out.days.push(day)
        }
        out.preliminary.extend(notices);
        date = date
            .checked_add(1.days())
            .map_err(|_| super::helpers::temporal())?;
    }
    Ok(out)
}
pub fn prepare_school_days<'a>(
    mode: SchoolMode,
    prepared: &PreparedYouthEntries<'_>,
    profiles: &'a PreparedTrainingProfiles,
    month: &str,
    resolver: &'a RuleResolver,
) -> Result<Vec<TrainingDay<'a>>, TrainingError> {
    if mode == SchoolMode::Youth {
        return Ok(prepare_youth_days(prepared, profiles, month, resolver)?.days);
    }
    let first = parse_date(&format!("{month}-01")).map_err(|_| super::helpers::temporal())?;
    let mut date = first
        .checked_sub(7.days())
        .map_err(|_| super::helpers::temporal())?;
    let end = first
        .checked_add(1.months().days(7))
        .map_err(|_| super::helpers::temporal())?;
    let mut days = vec![];
    while date < end {
        let id = date.to_string();
        if let Some(saved) = profiles.for_date(&id)? {
            let data = &saved["data"];
            if data["status"] == "training"
                && data["training"]["legalBasis"] == "BBIG"
                && let Some(age) = profile_age(data, &id)?
                && let Ok(legal) = resolver.resolve_legal(&id)
                && legal.rules().get("adultTraining").is_some()
                && data["training"]["startedOn"]
                    .as_str()
                    .expect("normalized training start")
                    <= id.as_str()
            {
                days.push(native_adult_day(&id, age, data, prepared, legal)?);
            }
        }
        date = date
            .checked_add(1.days())
            .map_err(|_| super::helpers::temporal())?;
    }
    Ok(days)
}
