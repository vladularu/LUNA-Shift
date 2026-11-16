mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{contract, ffi::*};
use serde_json::{Value, json};
fn invoke(header: &Value, body: &Value) -> Value {
    let header = serde_json::to_vec(header).unwrap();
    let body = serde_json::to_vec(body).unwrap();
    let buffer = unsafe {
        luna_engine_calendar_source(header.as_ptr(), header.len(), body.as_ptr(), body.len())
    };
    let result =
        serde_json::from_slice(unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) })
            .unwrap();
    if buffer.handle != 0 {
        assert!(luna_engine_release_buffer(buffer.handle));
    }
    result
}
#[test]
fn recorded_provider_entries_and_raw_five_sources_reproduce_original_day_details() {
    let owner = br#"{"ownerScope":"day-presentation","ownerEpoch":1}"#;
    let buffer = unsafe { luna_engine_bind_owner(owner.as_ptr(), owner.len()) };
    assert!(luna_engine_release_buffer(buffer.handle));
    let mut header = json!({"kind":"PRESENTATION","wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"day-presentation","ownerEpoch":1,"requestId":"day","draftRevision":0},"command":{"kind":"DAY_DETAILS_CANDIDATES"}});
    let reads = value_pool::decode(include_str!(
        "../../reference/day-details-read-context-golden.json"
    ));
    let views = value_pool::decode(include_str!(
        "../../reference/day-details-provider-join-golden.json"
    ));
    let locale: Value = serde_json::from_str(include_str!(
        "../../reference/day-details-platform-ranks.json"
    ))
    .unwrap();
    let recurrence: Value = serde_json::from_str(include_str!(
        "../../reference/day-details-recurrence-ranks.json"
    ))
    .unwrap();
    let ranks = locale["cases"]
        .as_array()
        .unwrap()
        .iter()
        .chain(recurrence["cases"].as_array().unwrap())
        .collect::<Vec<_>>();
    let mut compared = 0;
    let mut contexts = std::collections::BTreeMap::new();
    for c in reads["cases"].as_array().unwrap() {
        let full = views["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["id"] == c["id"])
            .unwrap();
        if c["expected"].is_null() || full["expected"]["state"] == "LOADING" {
            continue;
        }
        let input = &c["input"];
        let raw = &input["rawSource"];
        let mut sources = Vec::new();
        for (kind, key) in [
            ("WORK_PROFILE", "profile"),
            ("REMUNERATION_PROFILES", "historyRows"),
            ("WORK_PATTERN_SETTINGS", "patternRows"),
            ("WORKING_TIME_TARGET", "rawTargetRead"),
            ("YOUTH_PREFERENCE", "youthPreference"),
        ] {
            let mut value = if kind == "WORKING_TIME_TARGET" {
                input[key].clone()
            } else {
                raw[key].clone()
            };
            let state = if kind == "WORKING_TIME_TARGET" {
                raw["targetState"].as_str().unwrap()
            } else {
                "READY"
            };
            if kind == "WORKING_TIME_TARGET" && !value["savedRow"].is_null() {
                let row = value["savedRow"].as_object_mut().unwrap();
                let text = row.remove("settings_json").unwrap();
                row.insert("settings_json_chunks".into(), json!([text]));
            }
            let mut group = json!({"kind":kind,"state":state,"presence":if value.is_null(){"NULL"}else{"VALUE"}});
            if state == "READY" && !value.is_null() {
                group["value"] = value;
            }
            sources.push(group);
        }
        let date = &full["input"]["date"];
        let context = json!({"observedEpochMilliseconds":raw["epoch"],"stamp":{"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35},"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"sources":sources,"catalogs":(["TARIFF","LEGAL","HOLIDAY"].map(|kind|json!({"kind":kind,"state":"READY","presence":"VALUE","value":{"mode":"COMPILED_LEGACY"}}))),"startDate":date,"endDate":date,"platformCollationRanks":{}});
        let mut body = json!({"context":context,"date":date,"records":{"kind":"RECORDED_ENTRIES","entries":full["input"]["entries"]},"calendars":[],"platformCollationRanks":{}});
        header["guard"]["draftRevision"] = json!(compared * 2);
        header["command"]["kind"] = json!("DAY_DETAILS_CANDIDATES");
        let candidates = invoke(&header, &body);
        assert_eq!(
            candidates["state"], "CALENDAR_PRESENTED",
            "{}:{candidates}",
            c["id"]
        );
        let platform = ranks.iter().find(|r| r["id"] == c["id"]).unwrap();
        for name in candidates["value"].as_array().unwrap() {
            assert!(
                platform["ranks"].get(name.as_str().unwrap()).is_some(),
                "{}:{name}",
                c["id"]
            );
        }
        body["platformCollationRanks"] = platform["ranks"].clone();
        header["guard"]["draftRevision"] = json!(compared * 2 + 1);
        header["command"]["kind"] = json!("DAY_DETAILS");
        let actual = invoke(&header, &body);
        assert_eq!(
            actual["state"], "CALENDAR_PRESENTED",
            "{}:{actual}",
            c["id"]
        );
        let mut observed = actual["value"]["view"].clone();
        observed["entries"] = actual["value"]["rows"].clone();
        let mut expected = full["expected"].clone();
        for row in expected["entries"].as_array_mut().unwrap() {
            row.as_object_mut().unwrap().remove("route");
        }
        common::assert_json_eq(&observed, &expected, c["id"].as_str().unwrap());
        assert_eq!(actual["value"]["shared"], json!([]));
        contexts
            .entry(c["expected"]["timeZone"].as_str().unwrap().to_owned())
            .or_insert_with(|| body.clone());
        if compared == 0 {
            let mut invalid = body.clone();
            invalid["platformCollationRanks"] = json!({});
            assert_eq!(
                invoke(&header, &invalid)["ok"],
                false,
                "Incomplete comparison facts must fail closed"
            );
            let mut bulk = body.clone();
            let entries = bulk["records"]["entries"].as_array_mut().unwrap();
            for n in entries.len()..50_000 {
                entries.push(json!({"kind":"APPOINTMENT","id":format!("outside-{n}"),"title":"Outside requested day","date":"4099-12-30","recurrence":null,"deletedAt":null}));
            }
            common::assert_json_eq(
                &invoke(&header, &bulk)["value"],
                &actual["value"],
                "50k source selection before recurrence/credit",
            );
        }
        compared += 1;
    }
    assert_eq!(compared, 342);
    let incoming = value_pool::decode(include_str!(
        "../../reference/incoming-calendar-golden.json"
    ));
    let mut shared_compared = 0;
    for c in incoming["cases"].as_array().unwrap() {
        let input = &c["input"];
        if !input["now"].is_null() || !input["window"].is_null() {
            continue;
        }
        let Some(group) = c["expected"].as_array().and_then(|groups| groups.first()) else {
            continue;
        };
        let Some(base) = contexts.get(input["timeZone"].as_str().unwrap()) else {
            continue;
        };
        let mut body = base.clone();
        body["date"] = group[0].clone();
        body["records"]["entries"] = json!([]);
        body["calendars"] = input["calendars"].clone();
        body["platformCollationRanks"] = json!({group[0].as_str().unwrap():0});
        let reply = invoke(&header, &body);
        assert_eq!(reply["state"], "CALENDAR_PRESENTED", "{}:{reply}", c["id"]);
        let expected=group[1].as_array().unwrap().iter().map(|r|json!({"calendarId":r["calendarId"],"calendarName":r["calendarName"],"id":r["entry"]["id"],"title":r["entry"]["title"],"when":r["when"],"color":r["entry"]["color"]})).collect::<Vec<_>>();
        common::assert_json_eq(
            &reply["value"]["shared"],
            &json!(expected),
            c["id"].as_str().unwrap(),
        );
        shared_compared += 1;
        if shared_compared == 12 {
            break;
        }
    }
    assert_eq!(shared_compared, 12);
}
