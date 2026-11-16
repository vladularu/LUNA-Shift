//! Structural sort facts only; independent of salary readiness and all rules.
use crate::{
    calendar::parse_date, credit::duty::project_duty_work, report::cache_budget::serialized_bytes,
};
use jiff::ToSpan;
use serde_json::Value;
use std::{collections::BTreeSet, fmt};

const MAX_STRINGS: usize = crate::contract::MAX_SOURCE_ITEMS as usize;
const MAX_STRING_BYTES: usize = 300_000;
const MAX_RANK_WIRE_BYTES: u64 = crate::contract::MAX_INPUT_BYTES as u64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FinancialCandidateError {
    InvalidEntry,
    InputLimit,
    CandidateLimit,
    TextLimit,
}
impl fmt::Display for FinancialCandidateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidEntry => "FINANCIAL_CANDIDATES_INVALID",
            Self::InputLimit => "FINANCIAL_CANDIDATES_INPUT_LIMIT",
            Self::CandidateLimit => "FINANCIAL_CANDIDATES_LIMIT",
            Self::TextLimit => "FINANCIAL_CANDIDATES_TEXT_LIMIT",
        })
    }
}
impl std::error::Error for FinancialCandidateError {}
pub struct FinancialCollationCandidates {
    additional: BTreeSet<String>,
    total_count: usize,
    rank_wire_upper_bound: u64,
}
impl FinancialCollationCandidates {
    pub fn prepare(
        entries: &[Value],
        base: &BTreeSet<String>,
    ) -> Result<Self, FinancialCandidateError> {
        if entries.len() > MAX_STRINGS {
            return Err(FinancialCandidateError::InputLimit);
        }
        let mut budget = Budget {
            base,
            additional: BTreeSet::new(),
            wire: 4096,
        };
        if base.len() > MAX_STRINGS {
            return Err(FinancialCandidateError::CandidateLimit);
        }
        for text in base {
            budget.account(text)?;
        }
        for label in super::presentation::static_collation_candidates() {
            budget.add(label)?;
        }
        for entry in entries {
            if string(entry, "kind")? != "SHIFT" || entry.get("deletedAt") != Some(&Value::Null) {
                continue;
            }
            let id = string(entry, "id")?;
            let date = string(entry, "date")?;
            budget.add(id.to_owned())?;
            budget.add(date.to_owned())?;
            budget.add(match entry.get("startTime") {
                None | Some(Value::Null) => String::new(),
                Some(Value::String(s)) => s.clone(),
                _ => return Err(FinancialCandidateError::InvalidEntry),
            })?;
            let Some(duty) = entry.get("specialDuty").filter(|v| !v.is_null()) else {
                continue;
            };
            let parts = duty
                .get("parts")
                .and_then(Value::as_array)
                .filter(|v| v.len() <= 8)
                .ok_or(FinancialCandidateError::InvalidEntry)?;
            let callouts = duty
                .get("callouts")
                .and_then(Value::as_array)
                .filter(|v| v.len() <= 64)
                .ok_or(FinancialCandidateError::InvalidEntry)?;
            let end_day = duty
                .get("endDay")
                .and_then(Value::as_i64)
                .filter(|n| (0..=14).contains(n))
                .ok_or(FinancialCandidateError::InvalidEntry)?;
            match string(duty, "kind")? {
                "SPLIT" => {
                    let mut time = serde_json::Map::new();
                    for key in ["date", "startTime", "endTime", "breakMinutes"] {
                        let value = entry
                            .get(key)
                            .ok_or(FinancialCandidateError::InvalidEntry)?;
                        if key == "breakMinutes" && !value.as_f64().is_some_and(f64::is_finite) {
                            return Err(FinancialCandidateError::InvalidEntry);
                        }
                        if key != "breakMinutes" && !value.is_null() && !value.is_string() {
                            return Err(FinancialCandidateError::InvalidEntry);
                        }
                        time.insert(key.into(), value.clone());
                    }
                    // Ignore private/unknown metadata. Only the existing duty
                    // projector determines part dates and local clock strings.
                    let small_parts = parts
                        .iter()
                        .map(|part| {
                            let start = minute(part, "start")?;
                            let end = minute(part, "end")?;
                            let pause = part
                                .get("breakMinutes")
                                .filter(|v| v.as_f64().is_some_and(f64::is_finite))
                                .ok_or(FinancialCandidateError::InvalidEntry)?;
                            Ok(serde_json::json!({"start":start,"end":end,"breakMinutes":pause}))
                        })
                        .collect::<Result<Vec<_>, FinancialCandidateError>>()?;
                    time.insert(
                        "specialDuty".into(),
                        serde_json::json!({"kind":"SPLIT","endDay":end_day,"parts":small_parts}),
                    );
                    let projected = project_duty_work(&Value::Object(time))
                        .map_err(|_| FinancialCandidateError::InvalidEntry)?;
                    for (index, part) in projected.iter().enumerate() {
                        budget.add(format!("{id}:part:{index}"))?;
                        budget.add(string(part, "date")?.to_owned())?;
                        budget.add(string(part, "startTime")?.to_owned())?;
                    }
                }
                "ON_CALL" => {
                    for index in 0..callouts.len() {
                        budget.add(format!("duty-callout:{id}:{index}"))?;
                    }
                    // Tax-only fallback rows can refer to a work day inside the
                    // parent. Enumerate calendar dates, without pricing calls.
                    let day =
                        parse_date(date).map_err(|_| FinancialCandidateError::InvalidEntry)?;
                    for offset in 0..=end_day {
                        budget.add(
                            day.checked_add(offset.days())
                                .map_err(|_| FinancialCandidateError::InvalidEntry)?
                                .to_string(),
                        )?;
                    }
                }
                "STANDBY" => {}
                _ => return Err(FinancialCandidateError::InvalidEntry),
            }
        }
        Ok(Self {
            total_count: base.len() + budget.additional.len(),
            additional: budget.additional,
            rank_wire_upper_bound: budget.wire,
        })
    }
    pub fn additional(&self) -> &BTreeSet<String> {
        &self.additional
    }
    pub fn into_additional(self) -> BTreeSet<String> {
        self.additional
    }
    pub fn total_count(&self) -> usize {
        self.total_count
    }
    pub fn rank_wire_upper_bound(&self) -> u64 {
        self.rank_wire_upper_bound
    }
}

fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, FinancialCandidateError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or(FinancialCandidateError::InvalidEntry)
}
fn minute(value: &Value, key: &str) -> Result<i64, FinancialCandidateError> {
    value
        .get(key)
        .and_then(Value::as_i64)
        .filter(|n| (0..=14 * 1440).contains(n))
        .ok_or(FinancialCandidateError::InvalidEntry)
}
struct Budget<'a> {
    base: &'a BTreeSet<String>,
    additional: BTreeSet<String>,
    wire: u64,
}
impl Budget<'_> {
    fn account(&mut self, text: &str) -> Result<(), FinancialCandidateError> {
        if text.len() > MAX_STRING_BYTES {
            return Err(FinancialCandidateError::TextLimit);
        }
        // Exact JSON string bytes, plus conservative colon/rank/comma overhead.
        let bytes = serialized_bytes(&text, MAX_RANK_WIRE_BYTES)
            .ok_or(FinancialCandidateError::TextLimit)?;
        self.wire = self
            .wire
            .checked_add(bytes + 16)
            .filter(|n| *n <= MAX_RANK_WIRE_BYTES)
            .ok_or(FinancialCandidateError::TextLimit)?;
        Ok(())
    }
    fn add(&mut self, text: String) -> Result<(), FinancialCandidateError> {
        if self.base.contains(&text) || self.additional.contains(&text) {
            return Ok(());
        }
        if self.base.len() + self.additional.len() >= MAX_STRINGS {
            return Err(FinancialCandidateError::CandidateLimit);
        }
        self.account(&text)?;
        self.additional.insert(text);
        Ok(())
    }
}
