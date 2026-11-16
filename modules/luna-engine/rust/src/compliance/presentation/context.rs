//! Full grouped detail context, prepared from borrowed raw calendar rows once.
use super::{PresentationError, duty, planning, text, timeline::TimelineSource};
use crate::calendar::recurrence::CollationRanks;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
pub struct DetailSource<'a> {
    timeline: TimelineSource<'a>,
}
impl<'a> DetailSource<'a> {
    pub fn new(shifts: &'a [Value]) -> Self {
        Self {
            timeline: TimelineSource::new(shifts),
        }
    }
    pub fn prepare(
        &self,
        issue: &Value,
        related: &[Value],
        zone: &str,
        ranks: &CollationRanks,
    ) -> Result<Value, PresentationError> {
        let mut seen = BTreeSet::new();
        let mut members = Vec::new();
        for issue in std::iter::once(issue).chain(related) {
            let id = issue["id"].as_str().ok_or(PresentationError)?;
            if !seen.insert(id) {
                continue;
            }
            let model = self.timeline.prepare(issue, zone, ranks)?;
            let hint = if issue["kind"] == "PLANNING" {
                planning::present(issue, text(&model, "title"))
            } else {
                Value::Null
            };
            members.push(json!({"issue":issue,"model":model,"hint":hint}));
        }
        let grouped = members.len() > 1;
        let shared = grouped
            && !members
                .iter()
                .any(|member| crate::credit::summary::truthy(member["hint"].get("weekendPeriod")));
        let tariff = grouped
            && members
                .iter()
                .all(|member| crate::credit::summary::truthy(member["issue"].get("tariff")));
        let label = format!(
            "{} {}",
            members.len(),
            if tariff {
                "betroffene Zeiträume"
            } else {
                "Prüfpunkte"
            }
        );
        // Map.set replaces the value but retains the first insertion position.
        let mut by_id = BTreeMap::new();
        let mut all_related: Vec<&Value> = Vec::new();
        for member in &members {
            for shift in member["model"]["related"]
                .as_array()
                .ok_or(PresentationError)?
            {
                let id = shift["id"].as_str().ok_or(PresentationError)?;
                if let Some(index) = by_id.get(id) {
                    all_related[*index] = shift;
                } else {
                    by_id.insert(id, all_related.len());
                    all_related.push(shift);
                }
            }
        }
        let all_related = duty::ordered(all_related.into_iter(), ranks)?;
        Ok(
            json!({"members":members,"grouped":grouped,"shareDutyOverview":shared,"groupLabel":label,"allRelated":all_related}),
        )
    }
}
pub fn prepare(
    issue: &Value,
    related: &[Value],
    shifts: &[Value],
    zone: &str,
    ranks: &CollationRanks,
) -> Result<Value, PresentationError> {
    DetailSource::new(shifts).prepare(issue, related, zone, ranks)
}
