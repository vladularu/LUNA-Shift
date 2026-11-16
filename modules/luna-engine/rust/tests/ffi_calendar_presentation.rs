mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{contract, ffi::*};
use serde_json::{Value, json};
fn take(buffer: EngineBuffer) -> Value {
    let result =
        serde_json::from_slice(unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) })
            .unwrap();
    if buffer.handle != 0 {
        assert!(luna_engine_release_buffer(buffer.handle));
    }
    result
}
fn invoke(header: &Value, body: &Value) -> Value {
    let header = serde_json::to_vec(header).unwrap();
    let body = serde_json::to_vec(body).unwrap();
    take(unsafe {
        luna_engine_calendar_source(header.as_ptr(), header.len(), body.as_ptr(), body.len())
    })
}
#[test]
fn existing_raw_channel_runs_original_incoming_and_combined_policy_without_a_builder() {
    let owner = br#"{"ownerScope":"presentation-test","ownerEpoch":1}"#;
    assert_eq!(
        take(unsafe { luna_engine_bind_owner(owner.as_ptr(), owner.len()) })["ok"],
        true
    );
    let mut header = json!({"kind":"PRESENTATION","wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"presentation-test","ownerEpoch":1,"requestId":"calendar-display","draftRevision":0},"command":{"kind":"INCOMING_DAYS"}});
    let corpus = value_pool::decode(include_str!(
        "../../reference/incoming-calendar-golden.json"
    ));
    for (index, case) in corpus["cases"].as_array().unwrap().iter().enumerate() {
        header["guard"]["draftRevision"] = json!(index);
        let actual = invoke(&header, &case["input"]);
        assert_eq!(
            actual["state"], "CALENDAR_PRESENTED",
            "{}:{actual}",
            case["id"]
        );
        assert_eq!(actual["guard"], header["guard"]);
        common::assert_json_eq(
            &actual["value"],
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
    let corpus = value_pool::decode(include_str!(
        "../../reference/calendar-presentation-golden.json"
    ));
    header["command"]["kind"] = json!("COMBINED_PREVIEW");
    for (index, case) in corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| v["kind"] == "combined")
        .enumerate()
    {
        header["guard"]["draftRevision"] = json!(3000 + index);
        let actual = invoke(&header, &case["input"]);
        common::assert_json_eq(
            &actual["value"],
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
    header["command"]["kind"] = json!("MONTH_PRESENTATION");
    for (index, case) in corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| v["kind"] == "shift" && v.get("error").is_none())
        .enumerate()
    {
        header["guard"]["draftRevision"] = json!(5000 + index);
        let i = &case["input"];
        let body = json!({"days":[{"date":i["entry"]["date"],"own":[i["entry"]],"shared":[]}],"display":{"labelMode":"FULL","showShiftTimes":i["options"]["showShiftTimes"],"showShiftDuration":i["options"]["showShiftDuration"]},"timeZone":i["timeZone"],"weekHeight":1000,"entryRowHeight":12});
        let actual = invoke(&header, &body);
        assert_eq!(
            actual["state"], "CALENDAR_PRESENTED",
            "{}:{actual}",
            case["id"]
        );
        common::assert_json_eq(
            &actual["value"][0]["presentations"][0]["detail"],
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
    header["guard"]["draftRevision"] = json!(9000);
    let legacy = json!({"days":[{"date":"2026-03-13","own":[],"shared":[{"when":"21:00–07:30","entry":{"id":"legacy","title":"Nacht","startsAt":"2026-03-13T20:00:00Z","endsAt":"2026-03-14T06:30:00Z","allDay":false}}]}],"display":{"labelMode":"FULL","showShiftTimes":true,"showShiftDuration":false},"timeZone":"Europe/Berlin","weekHeight":80,"entryRowHeight":12});
    let actual = invoke(&header, &legacy);
    assert_eq!(actual["state"], "CALENDAR_PRESENTED", "{actual}");
    assert_eq!(actual["value"][0]["presentations"][0]["detail"], "21:00");
    assert_eq!(
        actual["value"][0]["presentations"][0]["label"]["text"],
        json!([78, 97, 99, 104, 116])
    );
    let raw = value_pool::decode(include_str!(
        "../../reference/day-details-read-context-golden.json"
    ));
    let input = &raw["cases"][0]["input"];
    let source = &input["rawSource"];
    let mut groups = Vec::new();
    for (kind, key) in [
        ("WORK_PROFILE", "profile"),
        ("REMUNERATION_PROFILES", "historyRows"),
        ("WORK_PATTERN_SETTINGS", "patternRows"),
        ("WORKING_TIME_TARGET", "rawTargetRead"),
        ("YOUTH_PREFERENCE", "youthPreference"),
    ] {
        let mut v = if kind == "WORKING_TIME_TARGET" {
            input[key].clone()
        } else {
            source[key].clone()
        };
        if kind == "WORKING_TIME_TARGET" && !v["savedRow"].is_null() {
            let row = v["savedRow"].as_object_mut().unwrap();
            let s = row.remove("settings_json").unwrap();
            row.insert("settings_json_chunks".into(), json!([s]));
        }
        groups.push(if v.is_null() {
            json!({"kind":kind,"state":"READY","presence":"NULL"})
        } else {
            json!({"kind":kind,"state":"READY","presence":"VALUE","value":v})
        });
    }
    let catalogs = ["TARIFF","LEGAL","HOLIDAY"].map(|kind| json!({"kind":kind,"state":"READY","presence":"VALUE","value":{"mode":"COMPILED_LEGACY"}}));
    let body = json!({"observedEpochMilliseconds":source["epoch"],"stamp":{"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35},"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"sources":groups,"catalogs":catalogs,"startDate":"2026-11-01","endDate":"2026-12-01","platformCollationRanks":{}});
    header["guard"]["draftRevision"] = json!(10000);
    header["command"]["kind"] = json!("CATALOG_CANDIDATES");
    assert_eq!(invoke(&header, &body)["value"], json!([]));
    header["guard"]["draftRevision"] = json!(10001);
    header["command"]["kind"] = json!("HIGHLIGHTS");
    let result = invoke(&header, &body);
    assert_eq!(result["state"], "CALENDAR_PRESENTED", "{result}");
    assert_eq!(result["value"]["months"].as_array().unwrap().len(), 2);
    assert!(result["value"]["labels"].as_array().unwrap().len() > 1);
    assert_eq!(
        result["value"]["observedEpochMilliseconds"],
        source["epoch"]
    );
    header["command"]["kind"] = json!("SHARED_ENTRY_DETAIL");
    let shared = value_pool::decode(include_str!(
        "../../reference/shared-entry-details-golden.json"
    ));
    for (index, case) in shared["cases"].as_array().unwrap().iter().enumerate() {
        header["guard"]["draftRevision"] = json!(11000 + index);
        let actual = invoke(&header, &case["input"]);
        assert_eq!(
            actual["state"], "CALENDAR_PRESENTED",
            "{}:{actual}",
            case["id"]
        );
        common::assert_json_eq(
            &actual["value"],
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
    }
    let source = shared["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["expected"].is_object())
        .unwrap();
    let mut calendars = source["input"]["calendars"].as_array().unwrap().clone();
    let entry = calendars[0]["entries"][0].clone();
    calendars[0]["entries"] = Value::Array(
        (0..20_000)
            .map(|index| {
                let mut row = entry.clone();
                row["id"] = json!(format!("entry-{index}"));
                row
            })
            .collect(),
    );
    header["command"]["kind"] = json!("INCOMING_DAYS");
    header["guard"]["draftRevision"] = json!(16000);
    let body = serde_json::to_vec(&json!({"calendars":calendars,"timeZone":source["input"]["timeZone"],"now":null,"window":null})).unwrap();
    let wire = serde_json::to_vec(&header).unwrap();
    let buffer = unsafe {
        luna_engine_calendar_source(wire.as_ptr(), wire.len(), body.as_ptr(), body.len())
    };
    assert!(
        buffer.length > 4 * 1024 * 1024 && buffer.length <= 32 * 1024 * 1024,
        "existing large presentation reply"
    );
    let actual = take(buffer);
    assert_eq!(actual["state"], "CALENDAR_PRESENTED");
    assert_eq!(
        actual["value"]
            .as_array()
            .unwrap()
            .iter()
            .map(|group| group[1].as_array().unwrap().len())
            .sum::<usize>(),
        20_000
    );
    header["guard"]["draftRevision"] = json!(16001);
    let wasm = luna_engine::wasm_transport::engine_invoke_calendar_source(
        &header.to_string(),
        std::str::from_utf8(&body).unwrap(),
    );
    assert!(wasm.len() > 4 * 1024 * 1024 && wasm.len() <= 32 * 1024 * 1024);
    let wasm: Value = serde_json::from_str(&wasm).unwrap();
    assert_eq!(wasm["state"], "CALENDAR_PRESENTED");
    assert_eq!(wasm["value"], actual["value"]);
    header["guard"]["draftRevision"] = json!(0);
    assert_eq!(
        invoke(&header, &json!({}))["code"],
        "STALE_OWNER_OR_REVISION"
    );
    header["guard"]["snapshot"] = json!({});
    assert_eq!(invoke(&header, &json!({}))["ok"], false);
}
