//! Monthly training merge accepts only native-created adult/training evidence.
use super::{PreparedTrainingProfiles, PreparedYouthEntries, TrainingError};
use crate::{
    EngineError, calendar::recurrence::CollationRanks, compliance::monthly::AssessedMonth,
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::collections::BTreeSet;
pub enum TrainingLoad<'a> {
    Loading,
    Error(Option<&'a str>),
    Ready {
        entries: &'a PreparedYouthEntries<'a>,
        profiles: &'a PreparedTrainingProfiles,
    },
}
#[derive(Debug)]
pub enum TrainingComplianceError {
    Training(TrainingError),
    Calculation(EngineError),
}
impl std::fmt::Display for TrainingComplianceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Training(e) => std::fmt::Display::fmt(e, f),
            Self::Calculation(e) => std::fmt::Display::fmt(e, f),
        }
    }
}
impl std::error::Error for TrainingComplianceError {}
impl From<TrainingError> for TrainingComplianceError {
    fn from(e: TrainingError) -> Self {
        Self::Training(e)
    }
}
impl From<EngineError> for TrainingComplianceError {
    fn from(e: EngineError) -> Self {
        Self::Calculation(e)
    }
}
impl TrainingComplianceError {
    pub fn source_error_name(&self) -> &str {
        match self {
            Self::Training(e) => e.name(),
            Self::Calculation(_) => "Error",
        }
    }
}
/// Opaque result: a host cannot deserialize a completed legal/training report.
pub struct AssessedTrainingMonth {
    result: Value,
}
impl AssessedTrainingMonth {
    pub fn result(&self) -> &Value {
        &self.result
    }
    pub fn into_json(self) -> Value {
        self.result
    }
}
pub fn calculate_training_compliance_for_state(
    month: &str,
    adult: Option<&AssessedMonth>,
    training: TrainingLoad<'_>,
    resolver: &RuleResolver,
    collation: &CollationRanks,
) -> Result<Option<AssessedTrainingMonth>, TrainingComplianceError> {
    let (entries, profiles) = match training {
        TrainingLoad::Loading => return Ok(None),
        TrainingLoad::Error(error) => {
            let date = format!("{month}-01");
            let description=error.unwrap_or("Ausbildungsdaten konnten nicht geladen werden. Bitte unter Mehr → Ausbildung & Alter erneut laden.");
            return Ok(Some(AssessedTrainingMonth {
                result: json!({"month":month,"trainingComplete":false,"criticalCount":0,"warningCount":0,"infoCount":1,"affectedDates":[date],"issues":[{"id":format!("TRAINING_LOAD:{month}"),"date":date,"severity":"info","kind":"LEGAL","rule":"Prüfungsgrundlage","title":"Arbeitszeitprüfung unvollständig","description":description,"relatedShiftIds":[]}]}),
            }));
        }
        TrainingLoad::Ready { entries, profiles } => (entries, profiles),
    };
    let first = crate::calendar::parse_date(&format!("{month}-01"))?;
    let mut dates = Vec::new();
    let mut date = first;
    while date.month() == first.month() {
        dates.push(date.to_string());
        date =
            crate::compliance::average::add_days(date, 1).map_err(|_| EngineError::InvalidDate)?;
    }
    let mut evidence = super::feature_adult::AdultEvidence::new(profiles, entries.raw_shifts());
    let adult_period_known = adult
        .and_then(|a| a.result().get("assessmentRange"))
        .is_some_and(|range| evidence.is_adult_range(range));
    let mut relevant = !profiles.profiles().is_empty() && !adult_period_known;
    for date in &dates {
        if let Some(row) = profiles.for_date(date)? {
            let data = &row["data"];
            relevant |= data["birthDate"].is_null()
                || data["status"] == "training"
                || super::days::profile_age(data, date)?.is_some_and(|age| age < 18);
        }
    }
    if !relevant {
        return Ok(adult.map(|a| AssessedTrainingMonth {
            result: a.result().clone(),
        }));
    }
    // This creates school/exam, daily, weekly and adult-training facts in Rust.
    // The preflight code ranks only finish the platform-dependent ordering.
    let youth =
        super::prepare_youth_compliance(month, entries, profiles, resolver)?.finish(collation)?;
    let mut has_youth_or_unknown = false;
    let mut adult_date = None;
    for date in &dates {
        let is_adult = evidence.is_adult_on(date)?;
        has_youth_or_unknown |= !is_adult;
        if is_adult && adult_date.is_none() {
            adult_date = Some(date.as_str());
        }
    }
    if !has_youth_or_unknown && adult.is_none() {
        return Ok(None);
    }
    let mut issues = Vec::new();
    if let Some(adult) = adult {
        let findings = adult.result()["issues"]
            .as_array()
            .ok_or_else(invalid_result)?;
        for finding in findings {
            if (!has_youth_or_unknown && adult_period_known) || evidence.retain_finding(finding)? {
                issues.push(finding.clone());
            }
        }
    }
    for finding in youth["findings"].as_array().ok_or_else(invalid_result)? {
        let date = required_text(finding, "date")?;
        let code = required_text(finding, "code")?;
        let section = required_text(finding, "section")?;
        let severity = required_text(finding, "severity")?;
        let title = if severity == "INCOMPLETE" {
            "Jugend-/Ausbildungsprüfung unvollständig"
        } else if severity == "RECOMMENDATION" {
            "Gesetzliche Soll-Regel"
        } else if section.contains("BBiG") || section.contains("PflBG") {
            "Ausbildungsfreistellung"
        } else {
            "Jugendarbeitsschutz"
        };
        let mut description = required_text(finding, "message")?.to_owned();
        if let Some(package) = finding["packageId"].as_str().filter(|v| !v.is_empty()) {
            let source_ids = finding["sourceIds"]
                .as_array()
                .ok_or_else(invalid_result)?
                .iter()
                .map(|v| v.as_str().ok_or_else(invalid_result))
                .collect::<Result<Vec<_>, _>>()?
                .join(", ");
            description.push_str(&format!(
                " Regelstand: {}/{}; Quellen: {}.",
                package,
                finding["versionId"].as_str().unwrap_or("null"),
                source_ids
            ));
        }
        issues.push(json!({"id":format!("YOUTH:{date}:{code}"),"date":date,"rule":section,"kind":"LEGAL","severity":if severity=="WARNING"{"warning"}else{"info"},"title":title,"description":description,"relatedShiftIds":finding["shiftIds"]}));
    }
    let adult_period_incomplete =
        adult_date.is_some() && (has_youth_or_unknown || !adult_period_known);
    if let Some(date) = adult_date.filter(|_| adult_period_incomplete) {
        let description = if let Some(adult) = adult {
            if let Some(range) = adult
                .result()
                .get("assessmentRange")
                .filter(|v| !v.is_null())
            {
                format!(
                    "Gesicherte Tages- und Periodenmeldungen bleiben sichtbar. Der Prüfzeitraum {} bis {} enthält minderjährige Tage oder ungeklärte Altersangaben. Altersübergreifende Ausgleichszeiträume und Jahresquoten sind nicht vollständig geprüft; keine Gesamtfreigabe.",
                    required_text(range, "from")?,
                    required_text(range, "through")?
                )
            } else {
                "Der Erwachsenenprüfung fehlen nachgewiesene Prüfzeiträume. Gesicherte Tagesmeldungen bleiben sichtbar; Ausgleichszeiträume und Jahresquoten sind unvollständig.".into()
            }
        } else {
            "Dieser Monat enthält volljährige Tage; deren Erwachsenenprüfung liegt noch nicht vor. Die bekannten Jugendmeldungen bleiben sichtbar; keine Gesamtfreigabe.".into()
        };
        issues.push(json!({"id":format!("YOUTH:ADULT_TRANSITION:{month}"),"date":date,"rule":"ArbZG / JArbSchG","kind":"LEGAL","severity":"info","title":"Prüfung des Übergangs unvollständig","description":description,"relatedShiftIds":[]}));
    }
    let affected = issues
        .iter()
        .map(|i| required_text(i, "date"))
        .collect::<Result<BTreeSet<_>, _>>()?;
    Ok(Some(AssessedTrainingMonth {
        result: json!({"month":month,"trainingComplete":youth["status"]!="INCOMPLETE"&&!adult_period_incomplete,"trainingTimeDays":youth["trainingTimeDays"],"criticalCount":issues.iter().filter(|i|i["severity"]=="critical").count(),"warningCount":issues.iter().filter(|i|i["severity"]=="warning").count(),"infoCount":issues.iter().filter(|i|i["severity"]=="info").count(),"affectedDates":affected,"issues":issues}),
    }))
}
fn invalid_result() -> TrainingComplianceError {
    TrainingError::invalid("Die nativen Prüfergebnisse sind unvollständig.").into()
}
fn required_text<'a>(value: &'a Value, key: &str) -> Result<&'a str, TrainingComplianceError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(invalid_result)
}
