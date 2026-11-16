use super::evidence::{self, EvidenceMap};
use crate::{
    EngineError,
    calendar::parse_date,
    compliance::{
        average::add_days,
        model::{ComplianceError, number, text},
        profile::ComplianceProfile,
        selection::same_signature,
    },
    time,
};
use jiff::{Timestamp, civil::Date};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
const POLICY_VERSION: &str = "2026-11-09-four-weeks";
#[derive(Clone)]
struct Context {
    zone: String,
    complete: bool,
}
fn context(
    date: &str,
    zone: &str,
    options: &Value,
    profile: Option<ComplianceProfile<'_>>,
) -> Result<Context, ComplianceError> {
    let profile = profile.filter(|v| v.truthy());
    let (zone, complete) = if let Some(profile) = profile {
        let fields = profile.fields_at(date)?;
        let field = |k| fields.get(k);
        let selected = match field("timeZone") {
            None | Some(Value::Null) => zone,
            Some(v) => v.as_str().ok_or(ComplianceError::InvalidInput)?,
        };
        (
            selected,
            field("allEmploymentWorkRecorded") == Some(&Value::Bool(true)),
        )
    } else {
        (
            zone,
            options.get("allEmploymentWorkRecorded") == Some(&Value::Bool(true)),
        )
    };
    Ok(Context {
        zone: zone.into(),
        complete,
    })
}
struct Latest<'a> {
    shift: &'a Value,
    ambiguous: Vec<&'a Value>,
}
fn latest(shifts: &[Value]) -> Result<Vec<Latest<'_>>, ComplianceError> {
    let mut result: Vec<Latest<'_>> = Vec::new();
    let mut indices = BTreeMap::new();
    for shift in shifts {
        let id = text(shift, "id")?;
        let Some(index) = indices.get(id).copied() else {
            indices.insert(id, result.len());
            result.push(Latest {
                shift,
                ambiguous: vec![],
            });
            continue;
        };
        let current: &mut Latest<'_> = &mut result[index];
        let old = current.shift;
        let revision = number(shift, "revision")?;
        let old_revision = number(old, "revision")?;
        let update = text(shift, "updatedAt")?;
        let old_update = text(old, "updatedAt")?;
        if revision > old_revision
            || revision == old_revision
                && (update > old_update
                    || update == old_update && !shift.get("deletedAt").is_some_and(Value::is_null))
        {
            current.shift = shift;
            current.ambiguous.clear();
        } else if revision == old_revision
            && update == old_update
            && old.get("deletedAt").is_some_and(Value::is_null)
            && shift.get("deletedAt").is_some_and(Value::is_null)
            && !same_signature(old, shift)
        {
            if current.ambiguous.is_empty() {
                current.ambiguous.push(old);
            }
            current.ambiguous.push(shift);
        }
    }
    Ok(result)
}
#[derive(Default)]
struct Group {
    occupied: BTreeSet<String>,
    unknown: BTreeSet<String>,
    reasons: BTreeSet<&'static str>,
}
type ZoneEvidence = BTreeMap<String, BTreeMap<String, Group>>;
fn zone_evidence(
    latest: &[Latest<'_>],
    contexts: &BTreeMap<String, Context>,
) -> Result<ZoneEvidence, ComplianceError> {
    let zones: BTreeSet<_> = contexts.values().map(|c| c.zone.clone()).collect();
    let mut result = BTreeMap::new();
    for zone in zones {
        let mut groups = BTreeMap::<String, Group>::new();
        for item in latest {
            let values = if item.ambiguous.is_empty() {
                evidence::weekend_evidence(item.shift, &zone)
            } else {
                let mut result = EvidenceMap::new();
                for alternative in &item.ambiguous {
                    result.extend(evidence::uncertain(alternative, "INVALID_DUTY"));
                }
                result
            };
            for (saturday, value) in values {
                let group = groups.entry(saturday).or_default();
                if value.occupied {
                    &mut group.occupied
                } else {
                    &mut group.unknown
                }
                .insert(text(item.shift, "id")?.into());
                group.reasons.insert(value.reason);
            }
        }
        result.insert(zone, groups);
    }
    Ok(result)
}
fn sorted_ids(ids: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut values: Vec<_> = ids
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    values.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    values
}
fn weekend(
    sunday: Date,
    contexts: &BTreeMap<String, Context>,
    zones: &ZoneEvidence,
    coverage_start: Option<&str>,
    coverage_end: Option<&str>,
) -> Result<Value, ComplianceError> {
    let saturday = add_days(sunday, -1)?;
    let monday = add_days(sunday, 1)?;
    let a = contexts
        .get(&saturday.to_string())
        .ok_or(ComplianceError::InvalidInput)?;
    let b = contexts
        .get(&sunday.to_string())
        .ok_or(ComplianceError::InvalidInput)?;
    let zone = time::zone(&a.zone)?;
    let lower = evidence::midnight(saturday, &zone)?;
    let upper = evidence::midnight(monday, &zone)?;
    let source_from = add_days(
        Timestamp::from_millisecond(lower)
            .map_err(|_| EngineError::InvalidTime)?
            .to_zoned(time::zone("-12:00")?)
            .date(),
        -14,
    )?
    .to_string();
    let before_upper = Timestamp::from_nanosecond(i128::from(upper) * 1_000_000 - 1)
        .map_err(|_| EngineError::InvalidTime)?;
    let source_until =
        add_days(before_upper.to_zoned(time::zone("+14:00")?).date(), 1)?.to_string();
    let group = zones
        .get(&a.zone)
        .and_then(|z| z.get(&saturday.to_string()));
    let mut reasons = group.map(|g| g.reasons.clone()).unwrap_or_default();
    if !a.complete || !b.complete {
        reasons.insert("WORK_NOT_CONFIRMED_COMPLETE");
    }
    if a.zone != b.zone || a.complete != b.complete {
        reasons.insert("EMPLOYMENT_CONTEXT_CHANGED");
    }
    if coverage_start.is_none_or(|v| v.is_empty() || source_from.as_str() < v)
        || coverage_end.is_none_or(|v| v.is_empty() || source_until.as_str() > v)
    {
        reasons.insert("OUTSIDE_COVERAGE");
    }
    let occupied = group.is_some_and(|g| !g.occupied.is_empty());
    let ids = sorted_ids(
        group
            .into_iter()
            .flat_map(|g| g.occupied.iter().chain(&g.unknown))
            .cloned(),
    );
    Ok(
        json!({"saturday":saturday.to_string(),"sunday":sunday.to_string(),"status":if occupied{"OCCUPIED"}else if !reasons.is_empty(){"UNKNOWN"}else{"FREE"},"relatedShiftIds":ids,"reasons":reasons.into_iter().collect::<Vec<_>>()}),
    )
}
fn counts(items: &[Value]) -> Value {
    json!({"freeCount":items.iter().filter(|v|v["status"]=="FREE").count(),"occupiedCount":items.iter().filter(|v|v["status"]=="OCCUPIED").count(),"unknownCount":items.iter().filter(|v|v["status"]=="UNKNOWN").count()})
}
fn append_counts(value: &mut Value, items: &[Value]) {
    value.as_object_mut().expect("constructed object").extend(
        counts(items)
            .as_object()
            .expect("constructed counts")
            .clone(),
    );
}
pub(super) fn check(
    month: &str,
    shifts: &[Value],
    time_zone: &str,
    options: &Value,
    coverage: Option<(&str, &str)>,
    profile: Option<ComplianceProfile<'_>>,
) -> Result<Value, ComplianceError> {
    let coverage_start = coverage
        .map(|v| v.0)
        .or_else(|| options.get("coverageStart").and_then(Value::as_str));
    let coverage_end = coverage
        .map(|v| v.1)
        .or_else(|| options.get("coverageEnd").and_then(Value::as_str));
    let first = parse_date(&format!("{month}-01"))?;
    let mut sunday = add_days(
        first,
        i64::from((7 - first.weekday().to_monday_one_offset()) % 7),
    )?;
    let mut ends = Vec::new();
    while sunday.month() == first.month() {
        ends.push(sunday);
        sunday = add_days(sunday, 7)?;
    }
    let latest = latest(shifts)?;
    let mut day = add_days(ends[0], -27)?;
    let last = *ends.last().ok_or(ComplianceError::InvalidInput)?;
    let mut contexts = BTreeMap::new();
    while day <= last {
        let date = day.to_string();
        contexts.insert(date.clone(), context(&date, time_zone, options, profile)?);
        day = add_days(day, 1)?;
    }
    let zones = zone_evidence(&latest, &contexts)?;
    let mut cached = BTreeMap::new();
    let mut windows = Vec::new();
    for until in &ends {
        let from = add_days(*until, -27)?;
        let mut items = Vec::new();
        for week in 0..4 {
            let sunday = add_days(*until, -(3 - week) * 7)?;
            let key = sunday.to_string();
            if !cached.contains_key(&key) {
                cached.insert(
                    key.clone(),
                    weekend(sunday, &contexts, &zones, coverage_start, coverage_end)?,
                );
            }
            items.push(cached[&key].clone());
        }
        let mut signatures = BTreeSet::new();
        let mut confirmed = true;
        let mut day = from;
        while day <= *until {
            let value = contexts
                .get(&day.to_string())
                .ok_or(ComplianceError::InvalidInput)?;
            signatures.insert((&value.zone, value.complete));
            confirmed &= value.complete;
            day = add_days(day, 1)?;
        }
        let complete = confirmed
            && signatures.len() == 1
            && coverage_start.is_some_and(|v| !v.is_empty() && from.to_string().as_str() >= v)
            && coverage_end.is_some_and(|v| {
                !v.is_empty() && add_days(*until, 1).is_ok_and(|d| d.to_string().as_str() <= v)
            })
            && items.iter().all(|v| {
                v["status"] != "UNKNOWN"
                    && !v["reasons"]
                        .as_array()
                        .expect("reasons")
                        .contains(&json!("OUTSIDE_COVERAGE"))
            });
        let mut window = json!({"from":from.to_string(),"until":until.to_string(),"weekends":items,"assessmentComplete":complete});
        append_counts(&mut window, &items);
        windows.push(window);
    }
    let items = ends
        .iter()
        .map(|d| {
            cached
                .get(&d.to_string())
                .cloned()
                .ok_or(ComplianceError::InvalidInput)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut assessment = json!({"policyVersion":POLICY_VERSION,"month":month,"weekends":items,"totalCount":items.len(),"windows":windows});
    append_counts(&mut assessment, &items);
    let affected = windows
        .iter()
        .filter(|w| {
            w["assessmentComplete"] == true
                && w["unknownCount"] == 0
                && w["freeCount"].as_u64().is_some_and(|n| n < 2)
        })
        .collect::<Vec<_>>();
    let issues = if let Some(latest) = affected.last() {
        let ids = sorted_ids(
            affected
                .iter()
                .flat_map(|w| w["weekends"].as_array().expect("weekends"))
                .flat_map(|w| w["relatedShiftIds"].as_array().expect("related IDs"))
                .map(|v| v.as_str().expect("ID").to_owned()),
        );
        vec![
            json!({"id":format!("PLANNING_WEEKEND_RECOVERY:{month}"),"kind":"PLANNING","severity":"info","rule":"PLANNING_WEEKEND_RECOVERY","date":latest["until"],"title":format!("{} von 4 Wochenenden frei",latest["freeCount"]),"description":"Die BAuA empfiehlt mindestens 2 vollständig freie Wochenenden (Samstag und Sonntag) in 4 Wochen.","relatedShiftIds":ids,"facts":{"rule":"PLANNING_WEEKEND_RECOVERY","assessment":assessment},"assessmentRanges":affected.iter().map(|w|json!({"from":w["from"],"through":w["until"]})).collect::<Vec<_>>()}),
        ]
    } else {
        vec![]
    };
    Ok(json!({"assessment":assessment,"issues":issues}))
}
