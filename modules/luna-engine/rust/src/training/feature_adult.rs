//! Adult-only evidence retains the original whole-period and service boundaries.
use super::{PreparedTrainingProfiles, TrainingError, days::profile_age};
use crate::{calendar::parse_date, compliance::average::add_days};
use serde_json::Value;
use std::collections::BTreeMap;
pub(super) struct AdultEvidence<'a> {
    profiles: &'a PreparedTrainingProfiles,
    ages: BTreeMap<String, bool>,
    shifts: BTreeMap<&'a str, Vec<&'a Value>>,
}
impl<'a> AdultEvidence<'a> {
    pub fn new(profiles: &'a PreparedTrainingProfiles, shifts: &'a [Value]) -> Self {
        let mut index = BTreeMap::<&str, Vec<&Value>>::new();
        for shift in shifts {
            if shift.get("deletedAt").is_some_and(Value::is_null)
                && let Some(id) = shift["id"].as_str()
            {
                index.entry(id).or_default().push(shift);
            }
        }
        Self {
            profiles,
            ages: BTreeMap::new(),
            shifts: index,
        }
    }
    pub fn is_adult_on(&mut self, date: &str) -> Result<bool, TrainingError> {
        if let Some(known) = self.ages.get(date) {
            return Ok(*known);
        }
        let adult = match self.profiles.for_date(date)? {
            Some(row) => profile_age(&row["data"], date)?.is_some_and(|age| age >= 18),
            None => false,
        };
        self.ages.insert(date.into(), adult);
        Ok(adult)
    }
    pub fn is_adult_range(&mut self, range: &Value) -> bool {
        let mut evaluate = || -> Result<bool, TrainingError> {
            let from = range["from"]
                .as_str()
                .ok_or_else(super::helpers::temporal)?;
            let through = range["through"]
                .as_str()
                .ok_or_else(super::helpers::temporal)?;
            let mut date = parse_date(from).map_err(|_| super::helpers::temporal())?;
            let end = parse_date(through).map_err(|_| super::helpers::temporal())?;
            if date > end {
                return Ok(false);
            }
            while date <= end {
                if !self.is_adult_on(&date.to_string())? {
                    return Ok(false);
                }
                date = add_days(date, 1).map_err(|_| super::helpers::temporal())?;
            }
            Ok(true)
        };
        evaluate().unwrap_or(false)
    }
    pub fn retain_finding(&mut self, finding: &Value) -> Result<bool, TrainingError> {
        if finding["kind"] == "PLANNING" {
            return Ok(true);
        }
        if finding["kind"] != "LEGAL" {
            return Ok(false);
        }
        let Some(date) = finding["date"].as_str() else {
            return Ok(false);
        };
        if !self.is_adult_on(date)? {
            return Ok(false);
        }
        let Some(ids) = finding["relatedShiftIds"].as_array() else {
            return Ok(false);
        };
        let scoped = matches!(
            finding["rule"].as_str(),
            Some(
                "ARBZG_3_MAX_10H"
                    | "ARBZG_4_BREAK"
                    | "ARBZG_4_INTERRUPTION"
                    | "ARBZG_4_CONTINUOUS"
                    | "ARBZG_5_REST_10H"
                    | "TIME_PLAUSIBILITY"
            )
        );
        if scoped && !ids.is_empty() && self.references_are_adult(ids, true)? {
            return Ok(true);
        }
        let Some(ranges) = finding["assessmentRanges"]
            .as_array()
            .filter(|r| !r.is_empty())
        else {
            return Ok(false);
        };
        if !ranges.iter().all(|range| self.is_adult_range(range)) {
            return Ok(false);
        }
        self.references_are_adult(ids, false)
    }
    fn references_are_adult(
        &mut self,
        ids: &[Value],
        service: bool,
    ) -> Result<bool, TrainingError> {
        for id in ids {
            let Some(entries) = id
                .as_str()
                .and_then(|id| self.shifts.get(id))
                .filter(|entries| entries.len() == 1)
            else {
                return Ok(false);
            };
            let shift = entries[0];
            let Some(date) = shift["date"].as_str() else {
                return Ok(false);
            };
            if !self.is_adult_on(date)? {
                return Ok(false);
            }
            let start = shift.get("startTime");
            let end = shift.get("endTime");
            if start.is_some_and(Value::is_null) || end.is_some_and(Value::is_null) {
                if service {
                    return Ok(false);
                }
                continue;
            }
            if end.and_then(Value::as_str) == Some("00:00") {
                continue;
            }
            if let (Some(start), Some(end)) =
                (start.and_then(Value::as_str), end.and_then(Value::as_str))
                && end > start
            {
                continue;
            }
            let next = add_days(parse_date(date).map_err(|_| super::helpers::temporal())?, 1)
                .map_err(|_| super::helpers::temporal())?;
            if !self.is_adult_on(&next.to_string())? {
                return Ok(false);
            }
        }
        Ok(true)
    }
}
