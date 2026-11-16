use super::{PresentationError, facts, identity, tariff_evidence, text};
use crate::calendar::recurrence::CollationRanks;
use crate::time::{self, ShiftTime};
use jiff::{
    ToSpan,
    civil::{Date, Time},
    tz::{Disambiguation, TimeZone},
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

type Ids<'a> = BTreeSet<&'a str>;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GroupError {
    InvalidInput,
    MissingCollation,
}
impl From<PresentationError> for GroupError {
    fn from(_: PresentationError) -> Self {
        Self::InvalidInput
    }
}
impl std::fmt::Display for GroupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidInput => "Invalid check grouping input",
            Self::MissingCollation => "Check display collation is incomplete",
        })
    }
}
impl std::error::Error for GroupError {}
struct Work<'a> {
    index: usize,
    ids: Ids<'a>,
}
struct Night<'a> {
    work: Work<'a>,
    identity: String,
    evidence: String,
}
struct Tariff<'a> {
    work: Work<'a>,
    identity: String,
    from: &'a str,
    until: &'a str,
}
fn truthy(value: Option<&Value>) -> bool {
    crate::credit::summary::truthy(value)
}
pub(super) fn priority(value: &Value) -> Result<u8, PresentationError> {
    match text(value, "severity") {
        "critical" => Ok(0),
        "warning" => Ok(1),
        "info" => Ok(2),
        _ => Err(PresentationError),
    }
}
fn observation(value: &Value) -> u8 {
    match text(value, "rule") {
        "PLANNING_7_DAYS" => 0,
        "PLANNING_NIGHT_SERIES" => 1,
        _ => 2,
    }
}
fn night_rule(value: &Value) -> bool {
    matches!(
        text(value, "rule"),
        "PLANNING_NIGHT_SERIES" | "PLANNING_NIGHT_RECOVERY"
    )
}
fn rank(ranks: &CollationRanks, value: &str) -> Result<u32, GroupError> {
    ranks.rank(value).map_err(|_| GroupError::MissingCollation)
}
fn utf16_strings<'a>(values: impl Iterator<Item = &'a str>) -> Vec<&'a str> {
    let mut values = values.collect::<Vec<_>>();
    values.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    values
}
fn dates<'a>(related: &[&'a Value]) -> Vec<&'a str> {
    utf16_strings(
        related
            .iter()
            .copied()
            .map(|s| text(s, "date"))
            .collect::<BTreeSet<_>>()
            .into_iter(),
    )
}
fn consecutive(dates: &[&str]) -> bool {
    dates.iter().enumerate().all(|(index, day)| {
        facts::date(&json!(day)).is_some()
            && (index == 0
                || crate::calendar::parse_date(dates[index - 1])
                    .ok()
                    .and_then(|d| d.checked_add(1.days()).ok())
                    .is_some_and(|previous| previous.to_string() == *day))
    })
}
fn complete<'a>(
    issue: &Value,
    by_id: &BTreeMap<&str, Option<&'a Value>>,
) -> Option<Vec<&'a Value>> {
    let ids = issue["relatedShiftIds"]
        .as_array()?
        .iter()
        .map(Value::as_str)
        .collect::<Option<Ids<'_>>>()?;
    if ids.is_empty() {
        return None;
    }
    let mut related = Vec::new();
    for id in ids {
        let shift = by_id.get(id).copied().flatten()?;
        if shift.get("deletedAt") != Some(&Value::Null)
            || truthy(shift.get("allDay"))
            || truthy(shift.get("specialDuty"))
            || !matches!(
                text(shift, "type"),
                "EARLY" | "LATE" | "NIGHT" | "DAY" | "TRAINING" | "CUSTOM"
            )
            || facts::date(&shift["date"]).is_none()
            || time::clock(shift["startTime"].as_str()?).is_err()
            || time::clock(shift["endTime"].as_str()?).is_err()
        {
            return None;
        }
        related.push(shift);
    }
    // A Set in the source retains the original related-ID insertion order.
    related.sort_by_key(|shift| {
        issue["relatedShiftIds"]
            .as_array()
            .unwrap()
            .iter()
            .position(|id| id == &shift["id"])
            .unwrap()
    });
    Some(related)
}
fn midnight(day: Date, zone: &TimeZone) -> Option<f64> {
    zone.to_ambiguous_zoned(day.to_datetime(Time::midnight()))
        .disambiguate(Disambiguation::Compatible)
        .and_then(|z| z.start_of_day())
        .ok()
        .map(|z| z.timestamp().as_millisecond() as f64 / 60_000.0)
}
fn consistent(issue: &Value, related: &[&Value], zone: Option<&str>) -> bool {
    let Some(zone_name) = zone.filter(|zone| !zone.is_empty()) else {
        return false;
    };
    let Ok(zone) = time::zone(zone_name) else {
        return false;
    };
    let tariff = &issue["tariff"];
    let Some(recorded) = tariff["recordedDates"].as_array() else {
        return false;
    };
    let Some(from) = facts::date(&tariff["period"]["from"]) else {
        return false;
    };
    let Some(until) = facts::date(&tariff["period"]["until"]) else {
        return false;
    };
    let days = if tariff["ruleId"] == "TARIFF_WEEK_DAYS" {
        7
    } else {
        14
    };
    if from.weekday().to_monday_one_offset() != 1
        || until.weekday().to_monday_one_offset() != 7
        || until.since(from).ok().map(|s| s.get_days()) != Some(days - 1)
    {
        return false;
    }
    let recorded = recorded
        .iter()
        .filter_map(Value::as_str)
        .collect::<BTreeSet<_>>();
    if Some(recorded.len() as i64) != facts::integer(&tariff["count"])
        || recorded.len() != tariff["recordedDates"].as_array().unwrap().len()
    {
        return false;
    }
    let mut proved = BTreeSet::new();
    for &shift in related {
        let Some(pause) = facts::integer(&shift["breakMinutes"]) else {
            return false;
        };
        let raw = ShiftTime {
            date: text(shift, "date").into(),
            start_time: Some(text(shift, "startTime").into()),
            end_time: Some(text(shift, "endTime").into()),
            break_minutes: pause,
            all_day: false,
            special_duty: None,
        };
        let Some(bounds) = time::shift_bounds(&raw, zone_name).ok().flatten() else {
            return false;
        };
        if tariff["ruleId"] == "TARIFF_WEEK_DAYS" {
            if text(shift, "date") < text(&tariff["period"], "from")
                || text(shift, "date") > text(&tariff["period"], "until")
                || bounds.end_epoch_minutes - bounds.start_epoch_minutes <= pause
            {
                return false;
            }
            proved.insert(text(shift, "date").to_owned());
            continue;
        }
        let mut contributes = false;
        for offset in 0..days {
            let Some(day) = from.checked_add(i64::from(offset).days()).ok() else {
                return false;
            };
            if tariff["ruleId"] == "TARIFF_FREE_SUNDAY" && day.weekday().to_monday_one_offset() != 7
            {
                continue;
            }
            let Some((lower, upper)) = midnight(day, &zone).zip(
                day.checked_add(1.days())
                    .ok()
                    .and_then(|next| midnight(next, &zone)),
            ) else {
                return false;
            };
            let overlap = (bounds.end_epoch_minutes as f64).min(upper)
                - (bounds.start_epoch_minutes as f64).max(lower);
            if overlap > pause as f64 {
                contributes = true;
                proved.insert(day.to_string());
            }
        }
        if !contributes {
            return false;
        }
    }
    proved.len() == recorded.len() && recorded.iter().all(|date| proved.contains(*date))
}
fn find(parent: &[usize], mut index: usize) -> usize {
    while parent[index] != index {
        index = parent[index];
    }
    index
}
fn join(parent: &mut [usize], left: usize, right: usize) {
    let left = find(parent, left);
    let right = find(parent, right);
    parent[right] = left;
}

/// Native components are prepared once. Additional comparison strings are
/// outputs for the host locale boundary, never calculated business inputs.
pub struct GroupDraft {
    groups: Vec<Value>,
}
pub fn base_collation_candidates(issues: &[Value]) -> Result<BTreeSet<String>, GroupError> {
    let mut result = BTreeSet::new();
    for issue in issues {
        for key in ["id", "date"] {
            result.insert(issue[key].as_str().ok_or(PresentationError)?.to_owned());
        }
    }
    Ok(result)
}
impl GroupDraft {
    pub fn prepare(
        issues: &[Value],
        shifts: &[Value],
        zone: Option<&str>,
        ranks: &CollationRanks,
    ) -> Result<Self, GroupError> {
        let mut by_id = BTreeMap::new();
        for shift in shifts {
            if let Some(id) = shift["id"].as_str() {
                let item = if by_id.contains_key(id) {
                    None
                } else {
                    Some(shift)
                };
                by_id.insert(id, item);
            }
        }
        let mut counts = BTreeMap::new();
        for issue in issues {
            let id = issue["id"].as_str().ok_or(PresentationError)?;
            priority(issue)?;
            if !issue["date"].is_string() {
                return Err(GroupError::InvalidInput);
            }
            *counts.entry(id).or_insert(0usize) += 1;
        }
        let mut works = Vec::new();
        let mut nights = Vec::new();
        let mut tariffs = Vec::new();
        for (index, issue) in issues.iter().enumerate() {
            let tariff = &issue["tariff"];
            if issue["kind"] == "LEGAL"
                && issue["severity"] == "info"
                && counts[text(issue, "id")] == 1
                && facts::date(&issue["date"]).is_some()
                && truthy(issue.get("tariff"))
                && tariff["ruleId"] == issue["rule"]
                && matches!(
                    text(issue, "rule"),
                    "TARIFF_WEEK_DAYS" | "TARIFF_FREE_DAYS" | "TARIFF_FREE_SUNDAY"
                )
                && matches!(text(tariff, "status"), "REVIEW" | "PENDING")
                && tariff_evidence::valid(tariff, Some(text(issue, "rule")))
                && text(&tariff["period"], "from") <= text(issue, "date")
                && text(issue, "date") <= text(&tariff["period"], "until")
                && facts::integer(&tariff["count"]).is_some()
                && tariff["recordedDates"].as_array().is_some_and(|dates| {
                    !dates.is_empty()
                        && dates.iter().all(|date| {
                            date.as_str().is_some_and(|date| {
                                date >= text(&tariff["period"], "from")
                                    && date <= text(&tariff["period"], "until")
                            })
                        })
                })
                && let Some(related) = complete(issue, &by_id)
                && consistent(issue, &related, zone)
            {
                tariffs.push(Tariff {
                    work: Work {
                        index,
                        ids: related.iter().map(|s| text(s, "id")).collect(),
                    },
                    from: text(&tariff["period"], "from"),
                    until: text(&tariff["period"], "until"),
                    identity: identity::stringify(&json!([
                        &text(issue, "date")[..7],
                        issue["rule"],
                        issue["severity"],
                        tariff["status"],
                        tariff["tariffLabel"],
                        tariff["source"],
                        tariff["ruleText"],
                        tariff["requirements"],
                        tariff["count"],
                        tariff.get("limit")
                    ]))?,
                });
            }
            if issue["kind"] != "PLANNING"
                || truthy(issue.get("tariff"))
                || issue["severity"] == "critical"
                || counts[text(issue, "id")] != 1
                || facts::date(&issue["date"]).is_none()
            {
                continue;
            }
            let Some(facts) = facts::valid(&issue["facts"], text(issue, "rule")) else {
                continue;
            };
            if !matches!(
                text(facts, "rule"),
                "PLANNING_7_DAYS" | "PLANNING_NIGHT_SERIES" | "PLANNING_NIGHT_RECOVERY"
            ) {
                continue;
            }
            let Some(count) = facts::integer(&facts["count"]).filter(|n| *n > 0) else {
                continue;
            };
            let Some(related) = complete(issue, &by_id) else {
                continue;
            };
            if facts["rule"] == "PLANNING_7_DAYS" {
                let days = dates(&related);
                if days.len() as i64 == count
                    && consecutive(&days)
                    && Some(text(issue, "date")) == days.last().copied()
                {
                    works.push(Work {
                        index,
                        ids: related.iter().map(|s| text(s, "id")).collect(),
                    });
                }
                continue;
            }
            let sequence = facts.get("nightSequence");
            let duties = related
                .iter()
                .copied()
                .filter(|shift| sequence.is_none_or(|s| shift["id"] != s["nextShiftId"]))
                .collect::<Vec<_>>();
            let ids = duties.iter().map(|s| text(s, "id")).collect::<Ids<'_>>();
            let days = dates(&duties);
            if days.len() as i64 != count || !consecutive(&days) {
                continue;
            }
            if let Some(sequence) = sequence {
                if !sequence["nextShiftId"].is_null()
                    && !issue["relatedShiftIds"]
                        .as_array()
                        .unwrap()
                        .contains(&sequence["nextShiftId"])
                {
                    continue;
                }
                let offset = crate::calendar::parse_date(days[0])
                    .map_err(|_| PresentationError)?
                    .since(facts::date(&sequence["firstNight"]).ok_or(PresentationError)?)
                    .map_err(|_| PresentationError)?
                    .get_days();
                if !matches!(offset, 0 | 1)
                    || !ids.contains(text(sequence, "lastShiftId"))
                    || text(issue, "date") < text(sequence, "firstNight")
                    || text(issue, "date") > text(sequence, "lastNight")
                    || by_id
                        .get(text(sequence, "lastShiftId"))
                        .copied()
                        .flatten()
                        .map(|s| text(s, "date"))
                        != days.last().copied()
                    || facts::date(&sequence["lastNight"])
                        .and_then(|day| day.checked_add(offset.days()).ok())
                        .map(|d| d.to_string())
                        .as_deref()
                        != days.last().copied()
                {
                    continue;
                }
            } else if Some(text(issue, "date")) != days.last().copied() {
                continue;
            }
            let ordered_ids = utf16_strings(ids.iter().copied());
            let identity_value = sequence
                .map(|s| {
                    json!([
                        &text(issue, "date")[..7],
                        s["policyVersion"],
                        s["firstNight"],
                        s["lastNight"]
                    ])
                })
                .unwrap_or_else(|| {
                    json!([
                        &text(issue, "date")[..7],
                        "legacy",
                        facts["count"],
                        days,
                        ordered_ids
                    ])
                });
            let evidence = sequence
                .map(|s| {
                    json!([
                        s["policyVersion"],
                        s["firstNight"],
                        s["lastNight"],
                        s["countIsMinimum"],
                        s["recoveryStatus"],
                        s["restMinutes"],
                        s["lastShiftId"],
                        s["nextShiftId"],
                        ordered_ids
                    ])
                })
                .unwrap_or_else(|| json!(["legacy", facts["count"], ordered_ids]));
            nights.push(Night {
                work: Work { index, ids },
                identity: identity::stringify(&identity_value)?,
                evidence: identity::stringify(&evidence)?,
            });
        }
        let mut parent = (0..issues.len()).collect::<Vec<_>>();
        let mut ordered = tariffs
            .iter()
            .map(|tariff| {
                Ok((
                    tariff,
                    (
                        rank(ranks, text(&issues[tariff.work.index], "date"))?,
                        rank(ranks, text(&issues[tariff.work.index], "id"))?,
                    ),
                ))
            })
            .collect::<Result<Vec<_>, GroupError>>()?;
        ordered.sort_by_key(|row| row.1);
        let mut tariff_groups: Vec<Vec<&Tariff<'_>>> = Vec::new();
        for (tariff, _) in ordered {
            if let Some(same) = tariff_groups.iter_mut().find(|group| {
                group.iter().all(|member| {
                    member.identity == tariff.identity
                        && member.from <= tariff.until
                        && tariff.from <= member.until
                        && tariff
                            .work
                            .ids
                            .iter()
                            .any(|id| member.work.ids.contains(id))
                })
            }) {
                join(&mut parent, same[0].work.index, tariff.work.index);
                same.push(tariff);
            } else {
                tariff_groups.push(vec![tariff]);
            }
        }
        let mut sequences: BTreeMap<&str, Vec<&Night<'_>>> = BTreeMap::new();
        let mut owners: BTreeMap<&str, Vec<&Night<'_>>> = BTreeMap::new();
        let mut ambiguous = BTreeSet::new();
        for night in &nights {
            sequences.entry(&night.identity).or_default().push(night);
            for id in &night.work.ids {
                owners.entry(id).or_default().push(night);
            }
        }
        for owners in owners.values() {
            if owners
                .iter()
                .map(|n| &n.identity)
                .collect::<BTreeSet<_>>()
                .len()
                > 1
            {
                ambiguous.extend(owners.iter().map(|n| n.work.index));
            }
        }
        for sequence in sequences.values() {
            if sequence.len() < 2 {
                continue;
            }
            let rules = sequence
                .iter()
                .map(|n| text(&issues[n.work.index], "rule"))
                .collect::<BTreeSet<_>>();
            if sequence.len() != 2
                || rules.len() != 2
                || sequence[0].evidence != sequence[1].evidence
                || sequence.iter().any(|n| ambiguous.contains(&n.work.index))
            {
                ambiguous.extend(sequence.iter().map(|n| n.work.index));
                continue;
            }
            join(&mut parent, sequence[0].work.index, sequence[1].work.index);
        }
        for night in &nights {
            if ambiguous.contains(&night.work.index) {
                continue;
            }
            let containers = works
                .iter()
                .filter(|work| {
                    text(&issues[work.index], "date")[..7]
                        == text(&issues[night.work.index], "date")[..7]
                        && night.work.ids.iter().all(|id| work.ids.contains(id))
                })
                .collect::<Vec<_>>();
            if containers.len() == 1 {
                join(&mut parent, containers[0].index, night.work.index);
            }
        }
        let mut grouped: Vec<(usize, Vec<&Value>)> = Vec::new();
        for (index, issue) in issues.iter().enumerate() {
            let key = find(&parent, index);
            if let Some((_, members)) = grouped.iter_mut().find(|row| row.0 == key) {
                members.push(issue);
            } else {
                grouped.push((key, vec![issue]));
            }
        }
        let mut groups = Vec::new();
        for (_, members) in grouped {
            let mut ordered = members
                .iter()
                .map(|&issue| {
                    Ok((
                        issue,
                        (
                            observation(issue),
                            rank(ranks, text(issue, "date"))?,
                            rank(ranks, text(issue, "id"))?,
                        ),
                    ))
                })
                .collect::<Result<Vec<_>, GroupError>>()?;
            ordered.sort_by(|(a, ka), (b, kb)| {
                ka.0.cmp(&kb.0)
                    .then_with(|| {
                        if truthy(a.get("tariff")) && truthy(b.get("tariff")) {
                            kb.1.cmp(&ka.1)
                        } else {
                            ka.1.cmp(&kb.1)
                        }
                    })
                    .then_with(|| ka.2.cmp(&kb.2))
            });
            let id = format!(
                "check-group:{}",
                identity::stringify(&json!(utf16_strings(
                    members.iter().map(|issue| text(issue, "id"))
                )))?
            );
            let date = utf16_strings(members.iter().map(|issue| text(issue, "date")))
                .last()
                .ok_or(PresentationError)?
                .to_string();
            groups.push(json!({"id":id,"date":date,"primary":ordered[0].0,"relatedIssues":ordered.iter().skip(1).map(|row|row.0).collect::<Vec<_>>()}));
        }
        Ok(Self { groups })
    }
    pub fn collation_candidates(&self) -> Result<BTreeSet<String>, PresentationError> {
        let mut values = BTreeSet::new();
        for group in &self.groups {
            values.insert(text(group, "id").to_owned());
            values.insert(text(group, "date").to_owned());
            values.insert(identity::stringify(&group["primary"])?);
        }
        Ok(values)
    }
    pub fn finish(&self, ranks: &CollationRanks) -> Result<Value, GroupError> {
        let mut ordered = self
            .groups
            .iter()
            .map(|group| {
                let severity = std::iter::once(&group["primary"])
                    .chain(group["relatedIssues"].as_array().unwrap())
                    .map(priority)
                    .collect::<Result<Vec<_>, _>>()?
                    .into_iter()
                    .min()
                    .ok_or(PresentationError)?;
                Ok((
                    group,
                    (
                        rank(ranks, text(group, "date"))?,
                        severity,
                        rank(ranks, text(group, "id"))?,
                        rank(ranks, &identity::stringify(&group["primary"])?)?,
                    ),
                ))
            })
            .collect::<Result<Vec<_>, GroupError>>()?;
        ordered.sort_by_key(|row| row.1);
        let mut used = BTreeMap::new();
        let mut result = Vec::new();
        for (group, _) in ordered {
            let count = used.entry(text(group, "id")).or_insert(0usize);
            let mut group = group.clone();
            if *count > 0 {
                group["id"] = json!(format!("{}:{count}", text(&group, "id")));
            }
            *count += 1;
            result.push(group);
        }
        Ok(Value::Array(result))
    }
}
pub fn group(
    issues: &[Value],
    shifts: &[Value],
    zone: Option<&str>,
    ranks: &CollationRanks,
) -> Result<Value, GroupError> {
    GroupDraft::prepare(issues, shifts, zone, ranks)?.finish(ranks)
}
pub fn planning(
    issues: &[Value],
    shifts: &[Value],
    ranks: &CollationRanks,
) -> Result<Value, GroupError> {
    let planning = issues
        .iter()
        .filter(|issue| issue["kind"] == "PLANNING")
        .collect::<Vec<_>>();
    let nights = planning
        .iter()
        .filter(|issue| night_rule(issue))
        .map(|issue| (*issue).clone())
        .collect::<Vec<_>>();
    let mut values=planning.iter().filter(|issue|!night_rule(issue)).map(|primary|json!({"id":primary["id"],"date":primary["date"],"primary":primary,"relatedIssues":[]})).collect::<Vec<_>>();
    values.extend(
        group(&nights, shifts, None, ranks)?
            .as_array()
            .unwrap()
            .iter()
            .cloned(),
    );
    let mut ordered = values
        .into_iter()
        .map(|value| {
            let order = if value["primary"]["rule"] == "PLANNING_7_DAYS" {
                0
            } else if night_rule(&value["primary"]) {
                1
            } else {
                2
            };
            let key = (
                rank(ranks, text(&value, "date"))?,
                order,
                rank(ranks, text(&value, "id"))?,
            );
            Ok((value, key))
        })
        .collect::<Result<Vec<_>, GroupError>>()?;
    ordered.sort_by_key(|row| row.1);
    Ok(Value::Array(ordered.into_iter().map(|row| row.0).collect()))
}
pub fn projection(input: &Value) -> Result<Value, GroupError> {
    let issues = input["issues"].as_array().ok_or(PresentationError)?;
    let prerequisites = match input.get("prerequisites") {
        None | Some(Value::Null) => &[][..],
        Some(value) => value.as_array().ok_or(PresentationError)?.as_slice(),
    };
    let mut counts = BTreeMap::new();
    for issue in issues.iter().chain(prerequisites) {
        let id = issue["id"].as_str().ok_or(PresentationError)?;
        *counts.entry(id).or_insert(0usize) += 1;
    }
    let known = |issue: &Value| {
        counts.get(text(issue, "id")) == Some(&1)
            && issue["kind"] == "LEGAL"
            && issue["severity"] == "info"
            && truthy(issue.get("tariff"))
            && issue["tariff"]["ruleId"] == issue["rule"]
            && matches!(
                text(issue, "rule"),
                "TARIFF_SCOPE" | "TARIFF_WEEK_DAYS" | "TARIFF_FREE_DAYS" | "TARIFF_FREE_SUNDAY"
            )
            && tariff_evidence::valid(&issue["tariff"], Some(text(issue, "rule")))
    };
    let pending = prerequisites
        .iter()
        .filter(|issue| known(issue) && issue["tariff"]["status"] == "PENDING")
        .collect::<Vec<_>>();
    let unavailable = issues
        .iter()
        .filter(|issue| known(issue) && issue["tariff"]["status"] == "UNAVAILABLE")
        .collect::<Vec<_>>();
    let visible = issues
        .iter()
        .filter(|issue| !unavailable.iter().any(|other| std::ptr::eq(*other, *issue)))
        .chain(pending.iter().copied())
        .collect::<Vec<_>>();
    let needed = prerequisites
        .iter()
        .filter(|issue| !pending.iter().any(|other| std::ptr::eq(*other, *issue)))
        .chain(unavailable.iter().copied())
        .collect::<Vec<_>>();
    Ok(json!({"issues":visible,"prerequisites":needed,"unavailable":!unavailable.is_empty()}))
}
