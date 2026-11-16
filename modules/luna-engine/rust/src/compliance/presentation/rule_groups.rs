//! Default ID/date collation and explicit German title collation are distinct.
use super::{PresentationError, groups, text};
use crate::calendar::recurrence::CollationRanks;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuleGroupError {
    InvalidInput,
    MissingDefaultCollation,
    MissingGermanCollation,
}
impl From<PresentationError> for RuleGroupError {
    fn from(_: PresentationError) -> Self {
        Self::InvalidInput
    }
}
impl std::fmt::Display for RuleGroupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidInput => "Invalid check rule grouping input",
            Self::MissingDefaultCollation => "Default check collation is incomplete",
            Self::MissingGermanCollation => "German check title collation is incomplete",
        })
    }
}
impl std::error::Error for RuleGroupError {}
/// Pure-kernel seam. Runtime admission must independently bind the explicit
/// de-DE namespace/probe, candidate digest, snapshot owner and epoch.
pub struct GermanTitleRanks(CollationRanks);
impl GermanTitleRanks {
    pub fn from_explicit_de_de(ranks: CollationRanks) -> Self {
        Self(ranks)
    }
    fn rank(&self, title: &str) -> Result<u32, RuleGroupError> {
        self.0
            .rank(title)
            .map_err(|_| RuleGroupError::MissingGermanCollation)
    }
}
struct RuleGroup {
    value: Value,
    severity: u8,
    count: usize,
}
/// Computed native output only; no Deserialize or constructor from UI groups.
pub struct RuleGroupDraft {
    groups: Vec<RuleGroup>,
}
impl RuleGroupDraft {
    pub fn prepare(issues: &[Value], default: &CollationRanks) -> Result<Self, RuleGroupError> {
        let mut by_rule: BTreeMap<&str, usize> = BTreeMap::new();
        let mut buckets: Vec<(&str, Vec<&Value>)> = Vec::new();
        for issue in issues {
            for key in ["rule", "id", "date", "title", "description"] {
                if !issue[key].is_string() {
                    return Err(RuleGroupError::InvalidInput);
                }
            }
            groups::priority(issue)?;
            let rule = text(issue, "rule");
            if let Some(index) = by_rule.get(rule) {
                buckets[*index].1.push(issue);
            } else {
                by_rule.insert(rule, buckets.len());
                buckets.push((rule, vec![issue]));
            }
        }
        let mut groups = Vec::new();
        for (rule, issues) in buckets {
            let mut ordered = issues
                .into_iter()
                .map(|issue| {
                    let rank = |key: &str| {
                        default
                            .rank(text(issue, key))
                            .map_err(|_| RuleGroupError::MissingDefaultCollation)
                    };
                    Ok((issue, (rank("date")?, rank("id")?)))
                })
                .collect::<Result<Vec<_>, RuleGroupError>>()?;
            ordered.sort_by_key(|entry| entry.1);
            let representative = ordered[0].0;
            let severity = ordered
                .iter()
                .map(|entry| groups::priority(entry.0))
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .min()
                .ok_or(RuleGroupError::InvalidInput)?;
            let title = if crate::credit::summary::truthy(representative.get("tariff")) {
                super::tariff(&json!({"evidence":representative["tariff"],"title":representative["title"],"description":representative["description"]}))?["title"].clone()
            } else {
                representative["title"].clone()
            };
            let count = ordered.len();
            let value = json!({"rule":rule,"title":title,"severity":match severity{0=>"critical",1=>"warning",_=>"info"},"issues":ordered.into_iter().map(|entry|entry.0).collect::<Vec<_>>()});
            groups.push(RuleGroup {
                value,
                severity,
                count,
            });
        }
        Ok(Self { groups })
    }
    pub fn title_candidates(&self) -> BTreeSet<String> {
        self.groups
            .iter()
            .map(|group| text(&group.value, "title").to_owned())
            .collect()
    }
    pub fn finish(&self, german: &GermanTitleRanks) -> Result<Value, RuleGroupError> {
        let mut ordered = self
            .groups
            .iter()
            .map(|group| {
                Ok((
                    group,
                    (
                        group.severity,
                        std::cmp::Reverse(group.count),
                        german.rank(text(&group.value, "title"))?,
                    ),
                ))
            })
            .collect::<Result<Vec<_>, RuleGroupError>>()?;
        ordered.sort_by_key(|entry| entry.1);
        Ok(Value::Array(
            ordered
                .into_iter()
                .map(|entry| entry.0.value.clone())
                .collect(),
        ))
    }
}
pub fn group(
    issues: &[Value],
    default: &CollationRanks,
    german: &GermanTitleRanks,
) -> Result<Value, RuleGroupError> {
    RuleGroupDraft::prepare(issues, default)?.finish(german)
}
