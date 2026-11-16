//! Calendar semantic dependencies, streamed from checked native profile owners.
//! The actual source identity/CAS remains a separate mandatory admission fence.
use super::super::{profile_clock::ProfileClockEnvironment, report::ReportIssue};
use crate::contract::{CanonicalHashWriter, CanonicalValueRef};
use serde_json::Value;
use sha2::{Digest, Sha256};

const LOCATION_FIELDS: [&str; 3] = ["timeZone", "federalState", "holidayRegion"];
type Location<'a> = [Option<&'a Value>; 3];
fn field(hash: &mut Sha256, name: &str, value: Option<&Value>) -> Result<(), ReportIssue> {
    hash.update((name.len() as u64).to_be_bytes());
    hash.update(name.as_bytes());
    match value {
        None => hash.update(b"ABSENT\0"),
        Some(value) => {
            hash.update(b"PRESENT\0");
            serde_json::to_writer(CanonicalHashWriter(&mut *hash), &CanonicalValueRef(value))
                .map_err(|_| ReportIssue::new("CALENDAR_CLOCK_INVALID"))?;
        }
    }
    Ok(())
}
fn effective<'a>(base: &'a Value, row: Option<&'a Value>) -> Location<'a> {
    let overlay = row
        .and_then(|v| v.get("employment"))
        .filter(|v| crate::net::js_truthy(v));
    LOCATION_FIELDS.map(|key| overlay.and_then(|v| v.get(key)).or_else(|| base.get(key)))
}
fn location(hash: &mut Sha256, value: &Location<'_>) -> Result<(), ReportIssue> {
    for (name, value) in LOCATION_FIELDS.into_iter().zip(value) {
        field(hash, name, *value)?;
    }
    Ok(())
}
pub(super) fn update(hash: &mut Sha256, env: &ProfileClockEnvironment) -> Result<(), ReportIssue> {
    let clock = env.prepared.clock_metadata();
    // Instant/expiry are intentionally excluded. The native lease checks both;
    // these roles/dates remain stable throughout the genuine clock anchor.
    for key in [
        "selectionTimeZones",
        "savedTimeZone",
        "savedDate",
        "projectedBaseTimeZone",
        "projectedBaseDate",
        "providerTimeZone",
        "providerDate",
        "analysisTimeZone",
        "referenceDate",
        "month",
    ] {
        field(hash, key, clock.get(key))?;
    }
    let Some(base) = env.prepared.calendar_base() else {
        hash.update(b"NO_ANALYSIS_PROFILE\0");
        return Ok(());
    };
    hash.update(b"ANALYSIS_PROFILE\0");
    let base_location = effective(base, None);
    location(hash, &base_location)?;
    let rows = env
        .history
        .as_ref()
        .map(|v| v.profiles().as_slice())
        .unwrap_or_default();
    let active = !base
        .get("salaryBasisConflict")
        .is_some_and(crate::net::js_truthy)
        && rows
            .iter()
            .any(|v| v.get("employment").is_some_and(crate::net::js_truthy));
    // Resolve the same nullable baseline/date ordering as employment_profile_at.
    // Only borrowed pointers are sorted; salary payloads are never cloned/hashed.
    let mut ordered = if active {
        rows.iter().collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    ordered.sort_unstable_by(|a, b| {
        a.get("effectiveFrom")
            .and_then(Value::as_str)
            .cmp(&b.get("effectiveFrom").and_then(Value::as_str))
    });
    let baseline = ordered
        .first()
        .copied()
        .filter(|v| v["effectiveFrom"].is_null());
    let mut previous = effective(base, baseline);
    // A timeline whose effective locations are constant has the same semantic
    // identity as no timeline. New salary-only rows do not create transitions.
    location(hash, &previous)?;
    for row in ordered {
        let Some(date) = row.get("effectiveFrom").filter(|v| !v.is_null()) else {
            continue;
        };
        let current = effective(base, Some(row));
        if current != previous {
            hash.update(b"LOCATION_TRANSITION\0");
            field(hash, "effectiveFrom", Some(date))?;
            location(hash, &current)?;
            previous = current;
        }
    }
    hash.update(b"LOCATION_END\0");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn missing_overlay_fields_fall_back_but_explicit_null_and_empty_remain_distinct() {
        let base = json!({"timeZone":"Europe/Berlin","federalState":"NW","holidayRegion":"NONE"});
        let missing = json!({"employment":{}});
        let null = json!({"employment":{"holidayRegion":null}});
        let empty = json!({"employment":{"holidayRegion":""}});
        let digest = |row| {
            let mut hash = Sha256::new();
            location(&mut hash, &effective(&base, row)).unwrap();
            format!("{:x}", hash.finalize())
        };
        assert_eq!(digest(None), digest(Some(&missing)));
        assert_ne!(digest(None), digest(Some(&null)));
        assert_ne!(digest(Some(&null)), digest(Some(&empty)));
        let absent = json!({});
        let null_base = json!({"holidayRegion":null});
        let mut a = Sha256::new();
        let mut b = Sha256::new();
        location(&mut a, &effective(&absent, None)).unwrap();
        location(&mut b, &effective(&null_base, None)).unwrap();
        assert_ne!(a.finalize(), b.finalize());
    }
}
