mod common;
use luna_engine::{contract, ffi::*, wasm_transport};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
fn take(buffer: EngineBuffer) -> Value {
    let value =
        serde_json::from_slice(unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) })
            .unwrap();
    if buffer.handle != 0 {
        assert!(luna_engine_release_buffer(buffer.handle));
        assert!(!luna_engine_release_buffer(buffer.handle));
    }
    value
}
type Command = unsafe extern "C" fn(*const u8, usize) -> EngineBuffer;
fn command(f: Command, value: Value) -> Value {
    let raw = serde_json::to_vec(&value).unwrap();
    take(unsafe { f(raw.as_ptr(), raw.len()) })
}
fn begin(clock: bool, n: u64) -> Value {
    json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"ownerScope":"ffi-calendar","ownerEpoch":1,"sourceRevision":n,"intent":if clock{json!({"kind":"CLOCK","observedEpochMilliseconds":1794480000000_i64})}else{json!({"kind":"ROWS"})}})
}
fn source(builder: &Value, kind: &str, data: Value) {
    let mut read = json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":data}});
    let raw = if read["payload"]["data"]["kind"] == "VALUE" {
        serde_json::to_vec(
            &read["payload"]["data"]
                .as_object_mut()
                .unwrap()
                .remove("value")
                .unwrap(),
        )
        .unwrap()
    } else {
        vec![]
    };
    let header = serde_json::to_vec(
        &json!({"builderId":builder["builderId"],"group":{"kind":kind,"source":read}}),
    )
    .unwrap();
    let value = take(unsafe {
        luna_engine_calendar_source(header.as_ptr(), header.len(), raw.as_ptr(), raw.len())
    });
    assert_eq!(value["state"], "CALENDAR_SOURCE_ADDED");
}
#[test]
fn actual_c_calendar_sources_window_pages_and_copy_free_obey_owner_source_and_budget_fences() {
    command(
        luna_engine_bind_owner,
        json!({"ownerScope":"ffi-calendar","ownerEpoch":1}),
    );
    let builder = command(luna_engine_calendar_begin, begin(false, 1));
    assert_eq!(builder["state"], "CALENDAR_BUILDING");
    let corpus: Value = serde_json::from_str(include_str!(
        "../../reference/calendar-templates-golden.json"
    ))
    .unwrap();
    let case = &corpus["cases"][0];
    let mut input = case["input"].clone();
    input["platformCollationRanks"] = json!({});
    source(
        &builder,
        "CALENDAR_ENTRIES",
        json!({"kind":"VALUE","value":input}),
    );
    let registered = command(
        luna_engine_calendar_seal,
        json!({"builderId":builder["builderId"]}),
    );
    assert_eq!(registered["state"], "CALENDAR_ROWS_REGISTERED");
    assert_eq!(registered["availability"]["state"], "READY");
    let prepared = command(
        luna_engine_calendar_window_prepare,
        json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"ffi-calendar","ownerEpoch":1,"requestId":"month","draftRevision":1},"source":{"kind":"CALENDAR_ONLY","identity":registered["identity"]},"spec":{"kind":"PROTOTYPE_YEAR","year":"2026"},"options":{"showAppointments":true,"showShifts":true},"localeKey":"original-platform-default"}),
    );
    assert_eq!(prepared["state"], "CALENDAR_WINDOW_PREPARED");
    let mut after = Value::Null;
    let mut strings = Vec::new();
    loop {
        let page = command(
            luna_engine_calendar_window_candidates,
            json!({"resourceId":prepared["resourceId"],"candidateDigest":prepared["candidateDigest"],"after":after,"limit":2}),
        );
        strings.extend(
            page["page"]["candidates"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_owned()),
        );
        after = page["page"]["nextAfter"].clone();
        if after.is_null() {
            break;
        }
    }
    let authoritative = &case["input"]["platformCollationRanks"];
    let levels = strings
        .iter()
        .map(|s| authoritative[s].as_u64().unwrap())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let ranks = strings
        .into_iter()
        .map(|s| {
            let n = levels
                .binary_search(&authoritative[&s].as_u64().unwrap())
                .unwrap() as u32;
            (s, n)
        })
        .collect::<BTreeMap<_, _>>();
    let header = serde_json::to_vec(
        &json!({"resourceId":prepared["resourceId"],"candidateDigest":prepared["candidateDigest"]}),
    )
    .unwrap();
    let ranks = serde_json::to_vec(&ranks).unwrap();
    let ready = take(unsafe {
        luna_engine_calendar_window_finalize(
            header.as_ptr(),
            header.len(),
            ranks.as_ptr(),
            ranks.len(),
        )
    });
    assert_eq!(ready["state"], "CALENDAR_WINDOW_READY");
    let output = command(
        luna_engine_calendar_window_read,
        json!({"resourceId":prepared["resourceId"],"view":"EXPANDED","after":null,"limit":1024}),
    );
    common::assert_json_eq(
        &output["page"]["items"],
        &case["expected"],
        "C native CalendarOnly full original SQL rows",
    );
    let clock = command(luna_engine_calendar_begin, begin(true, 1));
    source(&clock, "WORK_PROFILE", json!({"kind":"NULL"}));
    source(&clock, "REMUNERATION_PROFILES", json!({"kind":"NULL"}));
    let clock = command(
        luna_engine_calendar_seal,
        json!({"builderId":clock["builderId"]}),
    );
    assert_eq!(clock["state"], "CALENDAR_CLOCK_REGISTERED");
    assert_eq!(clock["clock"]["cacheable"], true);
    assert_eq!(clock["clock"]["timeZone"], "Europe/Berlin");
    let aborted = command(
        luna_engine_calendar_window_abort,
        json!({"resourceId":prepared["resourceId"]}),
    );
    assert_eq!(aborted["aborted"], true);
    assert_eq!(
        command(
            luna_engine_calendar_window_read,
            json!({"resourceId":prepared["resourceId"],"view":"EXPANDED","after":null,"limit":1})
        )["ok"],
        false
    );
    for (f, limit) in [
        (luna_engine_calendar_begin as Command, 8192),
        (luna_engine_calendar_seal, 1024),
        (luna_engine_calendar_abort, 1024),
        (luna_engine_calendar_window_prepare, 8192),
        (luna_engine_calendar_window_candidates, 1024),
        (luna_engine_calendar_window_read, 1024),
        (luna_engine_calendar_window_abort, 1024),
    ] {
        assert_eq!(
            take(unsafe { f(std::ptr::null(), limit + 1) })["code"],
            "INPUT_TOO_LARGE"
        );
    }
    assert_eq!(
        take(unsafe {
            luna_engine_calendar_source(std::ptr::null(), 0, std::ptr::null(), 33_554_433)
        })["code"],
        "INPUT_TOO_LARGE"
    );
    assert_eq!(
        take(unsafe {
            luna_engine_calendar_window_finalize(std::ptr::null(), 0, std::ptr::null(), 33_554_433)
        })["code"],
        "INPUT_TOO_LARGE"
    );
    let info = take(luna_engine_info());
    assert_eq!(info["capabilities"]["fullCalculation"], false);
    assert_eq!(info["capabilities"]["calendarSourceAssembly"], true);
    assert_eq!(info["capabilities"]["calendarWindowResources"], true);
    let old = command(luna_engine_calendar_begin, begin(false, 2));
    command(
        luna_engine_bind_owner,
        json!({"ownerScope":"ffi-calendar","ownerEpoch":1}),
    );
    assert_eq!(
        command(
            luna_engine_calendar_seal,
            json!({"builderId":old["builderId"]})
        )["ok"],
        false
    );
    take(luna_engine_collect_retired());
    // Native tests exercise the exact string wrapper too. A real compiled Wasm
    // checkpoint/browser proof remains a separate platform gate.
    let wasm: Value = serde_json::from_str(&wasm_transport::engine_invoke(
        "calendarBegin",
        &begin(false, 1).to_string(),
    ))
    .unwrap();
    assert_eq!(wasm["state"], "CALENDAR_BUILDING");
    let state = json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE"}}});
    let group =
        json!({"builderId":wasm["builderId"],"group":{"kind":"CALENDAR_ENTRIES","source":state}})
            .to_string();
    let source =
        json!({"shiftRows":[],"appointmentRows":[],"platformCollationRanks":{}}).to_string();
    let added: Value = serde_json::from_str(&wasm_transport::engine_invoke_calendar_source(
        &group, &source,
    ))
    .unwrap();
    assert_eq!(added["state"], "CALENDAR_SOURCE_ADDED");
    let registered: Value = serde_json::from_str(&wasm_transport::engine_invoke(
        "calendarSeal",
        &json!({"builderId":wasm["builderId"]}).to_string(),
    ))
    .unwrap();
    assert_eq!(registered["availability"]["state"], "READY");
    let prepared:Value=serde_json::from_str(&wasm_transport::engine_invoke("calendarWindowPrepare",&json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"ffi-calendar","ownerEpoch":1,"requestId":"empty-wasm","draftRevision":1},"source":{"kind":"CALENDAR_ONLY","identity":registered["identity"]},"spec":{"kind":"DAY","date":"2026-03-01"},"options":{"showAppointments":true,"showShifts":true},"localeKey":"original-platform-default"}).to_string())).unwrap();
    assert_eq!(prepared["total"], 0);
    let ready:Value=serde_json::from_str(&wasm_transport::engine_invoke_calendar_window_finalize(&json!({"resourceId":prepared["resourceId"],"candidateDigest":prepared["candidateDigest"]}).to_string(),"{}")).unwrap();
    assert_eq!(ready["state"], "CALENDAR_WINDOW_READY");
}
