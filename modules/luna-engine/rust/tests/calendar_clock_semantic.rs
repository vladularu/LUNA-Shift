mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::SourceState,
    employment::employment_overlay_from_profiles,
    input::{
        self, employment::RawEmploymentHistory, personal_context::CheckedWorkPatternSettings,
        profile_clock::prepare_profile_clock, stored_profile::checked_stored_work_profile,
    },
    runtime::calendar_only::CalendarClock,
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};

fn data() -> Value {
    value_pool::decode(include_str!(
        "../../reference/calendar-clock-role-golden.json"
    ))
}
fn location(base: &Value, overlay: Option<&Value>) -> Value {
    ["timeZone", "federalState", "holidayRegion"]
        .into_iter()
        .map(|key| {
            let v = overlay.and_then(|v| v.get(key)).or_else(|| base.get(key));
            (key.to_owned(), json!({"present":v.is_some(),"value":v}))
        })
        .collect()
}
fn observe(i: &Value) -> Result<Value, input::InputError> {
    let stored = (!i["profile"].is_null())
        .then(|| {
            checked_stored_work_profile(
                Arc::new(i["profile"]["profileRow"].clone()),
                Arc::new(i["profile"]["salaryRows"].as_array().unwrap().clone()),
            )
        })
        .transpose()?;
    let history = stored
        .as_ref()
        .map(|_| {
            RawEmploymentHistory::try_from_rows(Arc::new(
                i["historyRows"].as_array().unwrap().clone(),
            ))
        })
        .transpose()?;
    let p = prepare_profile_clock(
        stored.as_ref(),
        history.as_ref(),
        i["observedEpochMilliseconds"].as_i64().unwrap(),
    )?;
    let pattern = CheckedWorkPatternSettings::try_from_raw_rows(&i["patternRows"]).unwrap();
    let m = p.profile_metadata(Some(&pattern))?;
    let base = &m["calculationBaseProfile"];
    let mut clock = p.clock_metadata().clone();
    for key in [
        "observedEpochMilliseconds",
        "validUntilEpochMilliseconds",
        "onboarding",
    ] {
        clock.as_object_mut().unwrap().remove(key);
    }
    let mut locations = Vec::new();
    for date in [
        "2026-01-01",
        "2026-11-10",
        "2026-11-11",
        "2026-11-12",
        "2026-11-13",
        "2026-12-31",
        "2027-01-01",
    ] {
        let value = if base.is_null() {
            Value::Null
        } else {
            let rows = history.as_ref().unwrap().profiles();
            let overlay =
                employment_overlay_from_profiles(base.get("salaryBasisConflict"), rows, date)
                    .expect("checked original employment timeline");
            location(base, overlay)
        };
        locations.push(json!({"date":date,"location":value}));
    }
    Ok(
        json!({"clock":clock,"baseLocation":if base.is_null(){Value::Null}else{location(base,None)},"locations":locations}),
    )
}
fn state(value: &Value) -> SourceState {
    serde_json::from_value(json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},
        "payload":{"schemaVersion":1,"data":if value.is_null(){json!({"kind":"NULL"})}else{json!({"kind":"VALUE","value":value})}}})).unwrap()
}
fn key(i: &Value, owner: &str) -> String {
    CalendarClock::prepare(
        owner,
        &state(&i["profile"]),
        &state(&i["historyRows"]),
        i["observedEpochMilliseconds"].as_i64().unwrap(),
    )
    .unwrap()
    .key()
    .into()
}
#[test]
fn native_analysis_base_and_dated_locations_match_all_original_provider_roles() {
    let d = data();
    assert_eq!(d["cases"].as_array().unwrap().len(), 275);
    for c in d["cases"].as_array().unwrap() {
        let actual = match observe(&c["input"]) {
            Ok(v) => json!({"value":v}),
            Err(e) => json!({"error":{"name":e.name(),"message":e.message()}}),
        };
        common::assert_json_eq(&actual, &c["expected"], c["id"].as_str().unwrap());
    }
}
#[test]
fn money_and_housekeeping_reuse_but_base_or_dated_location_changes_invalidate() {
    let d = data();
    let cases: BTreeMap<_, _> = d["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| (v["id"].as_str().unwrap(), v))
        .collect();
    for p in d["pairs"].as_array().unwrap() {
        let a = &cases[p["before"].as_str().unwrap()]["input"];
        let b = &cases[p["after"].as_str().unwrap()]["input"];
        assert_eq!(
            key(a, "semantic-owner") == key(b, "semantic-owner"),
            p["relation"] == "SAME",
            "{}",
            p["id"]
        );
    }
    let seed = &cases["zone-1-instant-0-history-1"]["input"];
    assert_ne!(key(seed, "semantic-owner"), key(seed, "other-owner"));
}
