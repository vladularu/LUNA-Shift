use super::model::{ComplianceError, ComplianceInterval, integer, minutes_between, text};
use crate::{EngineError, time};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub struct SplitDutyBreakCheck {
    split_ids: BTreeSet<String>,
    on_call_periods: Vec<(i64, i64)>,
}
impl SplitDutyBreakCheck {
    pub fn new(shifts: &[Value]) -> Result<Self, ComplianceError> {
        let split_ids = shifts
            .iter()
            .filter(|shift| {
                shift.get("deletedAt").is_some_and(Value::is_null)
                    && shift["specialDuty"]["kind"] == "SPLIT"
            })
            .map(|shift| text(shift, "id").map(str::to_owned))
            .collect::<Result<BTreeSet<_>, _>>()?;
        if split_ids.is_empty() {
            return Ok(Self {
                split_ids,
                on_call_periods: Vec::new(),
            });
        }
        let mut periods = Vec::new();
        for shift in shifts {
            let duty = &shift["specialDuty"];
            if !shift.get("deletedAt").is_some_and(Value::is_null) || duty["kind"] != "ON_CALL" {
                continue;
            }
            let (Some(start), Some(end)) = (shift["startTime"].as_str(), shift["endTime"].as_str())
            else {
                continue;
            };
            if start.is_empty() || end.is_empty() {
                continue;
            }
            let start = time::clock(start)?;
            let end = time::clock(end)?;
            let start = i64::from(start.hour()) * 60 + i64::from(start.minute());
            let end = i64::from(end.hour()) * 60 + i64::from(end.minute());
            let end = integer(duty, "endDay")?
                .checked_mul(1440)
                .and_then(|day| day.checked_add(end))
                .ok_or(EngineError::Overflow)?;
            let zone = time::zone(text(duty, "timeZone")?)?;
            let date = text(shift, "date")?;
            periods.push((
                time::duty_instant(date, start, &zone)?,
                time::duty_instant(date, end, &zone)?,
            ));
        }
        Ok(Self {
            split_ids,
            on_call_periods: periods,
        })
    }
    pub fn is_planned(
        &self,
        before: &ComplianceInterval,
        after: &ComplianceInterval,
    ) -> Result<bool, ComplianceError> {
        if self.split_ids.is_empty() {
            return Ok(false);
        }
        let id = text(&before.shift, "id")?;
        Ok(id == text(&after.shift, "id")?
            && self.split_ids.contains(id)
            && !self.on_call_periods.iter().any(|&(start, end)| {
                start < after.start.timestamp().as_millisecond()
                    && end > before.end.timestamp().as_millisecond()
            }))
    }
}
pub fn work_groups_by_recorded_date(
    intervals: &[ComplianceInterval],
) -> Result<Vec<Vec<&ComplianceInterval>>, ComplianceError> {
    let mut groups = Vec::<Vec<&ComplianceInterval>>::new();
    let mut indices = BTreeMap::<&str, usize>::new();
    for interval in intervals {
        let date = text(&interval.shift, "date")?;
        if let Some(&index) = indices.get(date) {
            groups[index].push(interval);
        } else {
            indices.insert(date, groups.len());
            groups.push(vec![interval]);
        }
    }
    Ok(groups)
}
#[derive(Debug, Serialize)]
pub struct InterruptionMinutes {
    pub planned: f64,
    pub unconfirmed: f64,
}
pub fn interruption_minutes(
    items: &[&ComplianceInterval],
    minimum_segment_minutes: i64,
    check: &SplitDutyBreakCheck,
    all: &[ComplianceInterval],
) -> Result<InterruptionMinutes, ComplianceError> {
    let mut result = InterruptionMinutes {
        planned: 0.0,
        unconfirmed: 0.0,
    };
    let Some(mut latest) = items.first().copied() else {
        return Ok(result);
    };
    for item in items.iter().skip(1) {
        let gap = minutes_between(&latest.end, &item.start)?;
        if gap >= minimum_segment_minutes as f64
            && !all.iter().any(|other| {
                other.start.timestamp() < item.start.timestamp()
                    && other.end.timestamp() > latest.end.timestamp()
            })
        {
            if check.is_planned(latest, item)? {
                result.planned += gap;
            } else {
                result.unconfirmed += gap;
            }
        }
        if item.end.timestamp() > latest.end.timestamp() {
            latest = item;
        }
    }
    Ok(result)
}
