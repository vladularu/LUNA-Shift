mod common;
#[path = "support/snapshot.rs"]
mod snapshot;
#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{contract, ffi::*};
use serde_json::{Value, json};

fn take(buffer: EngineBuffer) -> Value {
    assert!(!buffer.bytes.is_null());
    // SAFETY: this descriptor remains allocated until its matching release.
    let value =
        serde_json::from_slice(unsafe { std::slice::from_raw_parts(buffer.bytes, buffer.length) })
            .unwrap();
    if buffer.handle != 0 {
        assert!(luna_engine_release_buffer(buffer.handle));
    }
    value
}
fn call(f: unsafe extern "C" fn(*const u8, usize) -> EngineBuffer, value: Value) -> Value {
    let bytes = serde_json::to_vec(&value).unwrap();
    // SAFETY: the vector is retained for the whole synchronous call.
    take(unsafe { f(bytes.as_ptr(), bytes.len()) })
}
fn envelope(command: Value) -> Value {
    json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"command":command})
}
fn ready(value: Value) -> Value {
    let data = if value.is_null() {
        json!({"kind":"NULL"})
    } else {
        json!({"kind":"VALUE","value":value})
    };
    json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":data}})
}
fn raw_groups(raw: &Value) -> Value {
    json!([
        {"kind":"WORK_PROFILE","source":ready(raw["profile"].clone())},
        {"kind":"REMUNERATION_PROFILES","source":ready(raw["historyRows"].clone())},
        {"kind":"WORK_PATTERN_SETTINGS","source":ready(raw["patternRows"].clone())}
    ])
}
fn clock_key(raw: &Value) -> String {
    let begin = call(
        luna_engine_snapshot_begin,
        json!({"ownerScope":"checks-details","ownerEpoch":1,"snapshotId":"private-m3","snapshotRevision":1,"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}}),
    );
    assert_eq!(begin["state"], "BUILDING", "{begin}");
    let id = begin["builderId"].as_u64().unwrap();
    for group in raw_groups(raw).as_array().unwrap() {
        let mut group = group.clone();
        let value = group["source"]["payload"]["data"]
            .as_object_mut()
            .unwrap()
            .remove("value");
        let body = value
            .map(|v| serde_json::to_vec(&v).unwrap())
            .unwrap_or_default();
        let header =
            serde_json::to_vec(&json!({"builderId":id,"target":"SOURCE","group":group})).unwrap();
        // SAFETY: header and body both outlive the native source call.
        let added = take(unsafe {
            luna_engine_snapshot_source(header.as_ptr(), header.len(), body.as_ptr(), body.len())
        });
        assert_eq!(added["state"], "SOURCE_ADDED", "{added}");
    }
    let metadata = call(
        luna_engine_snapshot_profile_clock,
        json!({"builderId":id,"epochMilliseconds":raw["epoch"]}),
    );
    assert_eq!(metadata["state"], "PROFILE_CLOCK_READY", "{metadata}");
    let key = metadata["sourceClockKey"].as_str().unwrap().to_owned();
    call(luna_engine_snapshot_abort, json!({"builderId":id}));
    take(luna_engine_collect_retired());
    key
}
fn request(identity: &Value, case: &Value, revision: u64) -> Value {
    let input = &case["input"];
    let raw = &input["rawSource"];
    let target = &input["rawTargetRead"];
    let loaded = match raw["targetState"].as_str().unwrap_or("READY") {
        "LOADING" => Value::Null,
        "FAILED" => json!({"revision":0,"state":"FAILED","read":null}),
        _ => {
            json!({"revision":0,"state":"READY","read":{"savedRow":target["savedRow"],"timeZone":target["timeZoneRow"]["time_zone"],"planRows":target["planRows"]}})
        }
    };
    let target_youth = raw["youthPreference"]["value"]
        .as_str()
        .map(|v| v == "true")
        .unwrap_or(false);
    envelope(json!({"kind":"CALCULATE","request":{
        "guard":{"snapshot":identity,"requestId":format!("detail-{revision}"),"requestRevision":revision},
        "periods":[{"kind":"MONTH","month":input["month"]}],
        "sections":{"time":false,"gross":false,"net":false,"checks":false},"perspective":"EARNED","priority":"INTERACTIVE",
        "checksDetails":{
            "basis":{"sourceClockKey":clock_key(raw),"sourceEpochMilliseconds":raw["epoch"],"sources":raw_groups(raw)},
            "children":{"targetRevision":0,"loadedTarget":loaded,"historyState":"READY","historyRows":raw["historyRows"],"youthProtection":target_youth,"youthState":"READY"},
            "observedEpochMilliseconds":input["epoch"],"youthProtection":input["youthProtection"],
            "entries":input["entries"],"ranks":case["platformCollationRanks"]
        }
    }}))
}
fn admit(value: &Value, lane: u8) -> Value {
    let bytes = serde_json::to_vec(value).unwrap();
    // SAFETY: request bytes remain readable throughout admission.
    take(unsafe { luna_engine_admit(bytes.as_ptr(), bytes.len(), lane) })
}

#[test]
fn original_m3_target_provider_inputs_cross_the_actual_checks_queue_without_main_cache_alias() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/compliance-details-source-golden.json"
    ));
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 696);
    call(
        luna_engine_bind_owner,
        json!({"ownerScope":"checks-details","ownerEpoch":1}),
    );
    let mut raw = snapshot::raw_snapshot(1, "checks-details", 1);
    // Deliberately no profile/calendar/target facts in the main snapshot. It is
    // solely the existing publication and catalog owner for this request.
    raw["catalogs"]["current"]["selectedPackageIds"] =
        json!({"tariff":["tvoed-vka-bt-k"],"legal":["de-arbzg-care"],"holiday":["de-holidays"]});
    for kind in ["tariff", "legal", "holiday"] {
        raw["catalogs"]["current"][kind] = ready(json!({"mode":"COMPILED_PREVIEW"}));
    }
    snapshot::seal(&mut raw);
    let identity = raw["identity"].clone();
    assert_eq!(
        call(
            luna_engine_execute,
            envelope(json!({"kind":"REGISTER_SNAPSHOT","snapshot":raw}))
        )["state"],
        "REGISTERED"
    );
    let mut first_request = None;
    for (index, case) in cases.iter().enumerate() {
        let request = request(&identity, case, index as u64 + 1);
        if first_request.is_none() {
            first_request = Some(request.clone());
        }
        let admitted = admit(&request, 1);
        assert_eq!(admitted["state"], "QUEUED", "{}: {admitted}", case["id"]);
        assert_eq!(take(luna_engine_run_next(0))["state"], "IDLE");
        let completed = take(luna_engine_run_next(1));
        assert_eq!(
            completed["state"], "COMPLETED",
            "{}: {completed}",
            case["id"]
        );
        let result = &completed["result"];
        assert_eq!(result["request"]["checksDetails"], true);
        assert!(!result.to_string().contains("sourceClockKey"));
        assert!(!result.to_string().contains("settings_json"));
        let sections = &result["reports"][0]["sections"];
        for field in ["time", "gross", "net", "checks"] {
            assert_eq!(sections[field]["state"], "NOT_REQUESTED");
        }
        let output = &sections["checksDetails"];
        if case["expected"]["state"] == "PROFILE_MISSING" {
            assert_eq!(output["state"], "UNAVAILABLE");
            continue;
        }
        assert_eq!(output["state"], "READY", "{}: {output}", case["id"]);
        for field in ["referenceDate", "window", "compliance"] {
            common::assert_json_eq(
                &output["value"][field],
                &case["expected"][field],
                &format!("{}.{field}", case["id"]),
            );
        }
    }
    let mut next = first_request.unwrap();
    // A normal checks writer has an independent slot even with a lower
    // revision and the exact same main snapshot/month identity.
    let mut ordinary = next.clone();
    ordinary["command"]["request"]
        .as_object_mut()
        .unwrap()
        .remove("checksDetails");
    ordinary["command"]["request"]["sections"]["checks"] = json!(true);
    ordinary["command"]["request"]["guard"]["requestId"] = json!("ordinary-checks");
    assert_eq!(admit(&ordinary, 1)["state"], "QUEUED");
    assert_eq!(take(luna_engine_run_next(1))["state"], "COMPLETED");
    let mut oversized = serde_json::to_vec(&ordinary).unwrap();
    oversized.extend(std::iter::repeat_n(b' ', 8193));
    // SAFETY: the padded valid request remains readable; ordinary admissions
    // still have the original 8KiB limit despite the explicit large variant.
    assert_eq!(
        take(unsafe { luna_engine_admit(oversized.as_ptr(), oversized.len(), 1) })["code"],
        "INPUT_TOO_LARGE"
    );
    for field in ["sourceClockKey", "sourceEpochMilliseconds", "sources"] {
        let mut invalid = next.clone();
        invalid["command"]["request"]["checksDetails"]["basis"]
            .as_object_mut()
            .unwrap()
            .remove(field);
        assert_eq!(admit(&invalid, 1)["ok"], false);
    }
    for field in ["loadedTarget", "youthProtection"] {
        let mut invalid = next.clone();
        invalid["command"]["request"]["checksDetails"]["children"]
            .as_object_mut()
            .unwrap()
            .remove(field);
        assert_eq!(admit(&invalid, 1)["ok"], false);
    }
    let mut ready_profile = next.clone();
    ready_profile["command"]["request"]["checksDetails"]["profile"] =
        cases[0]["expected"]["profile"].clone();
    assert_eq!(admit(&ready_profile, 1)["ok"], false);
    next["command"]["request"]["guard"]["requestRevision"] = json!(1000);
    next["command"]["request"]["guard"]["requestId"] = json!("cancelled");
    assert_eq!(admit(&next, 0)["code"], "INVALID_LANE");
    let queued = admit(&next, 1);
    assert_eq!(queued["state"], "QUEUED");
    call(luna_engine_cancel_job, json!({"jobId":queued["jobId"]}));
    let cancelled = take(luna_engine_run_next(1));
    assert_ne!(cancelled["state"], "COMPLETED");
    assert!(cancelled.get("result").is_none());
    next["command"]["request"]["guard"]["requestRevision"] = json!(1001);
    next["command"]["request"]["guard"]["requestId"] = json!("reset-pending");
    assert_eq!(admit(&next, 1)["state"], "QUEUED");
    call(
        luna_engine_bind_owner,
        json!({"ownerScope":"checks-details","ownerEpoch":1}),
    );
    let reset = take(luna_engine_run_next(1));
    assert_ne!(reset["state"], "COMPLETED");
    assert!(reset.get("result").is_none());
    // Same existing bounded stateless channel, with the complete Original
    // groups/timeline/rest/tariff-period results; no second monthly calculation.
    let models = value_pool::decode(include_str!(
        "../../reference/compliance-details-models-golden.json"
    ));
    for (index, case) in models["cases"].as_array().unwrap().iter().enumerate() {
        let header=serde_json::to_vec(&json!({"kind":"PRESENTATION","wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"checks-details","ownerEpoch":1,"requestId":"checks-models","draftRevision":index},"command":{"kind":"CHECKS_MODELS"}})).unwrap();
        let mut body = case["input"].clone();
        body["action"] = json!("FINISH");
        let body = serde_json::to_vec(&body).unwrap();
        // SAFETY: both original input buffers remain live until this call returns.
        let reply = take(unsafe {
            luna_engine_calendar_source(header.as_ptr(), header.len(), body.as_ptr(), body.len())
        });
        assert_eq!(
            reply["state"], "CALENDAR_PRESENTED",
            "{}:{reply}",
            case["id"]
        );
        common::assert_json_eq(
            &reply["value"],
            &case["expected"],
            case["id"].as_str().unwrap(),
        );
        assert_eq!(take(luna_engine_run_next(0))["state"], "IDLE");
        assert_eq!(take(luna_engine_run_next(1))["state"], "IDLE");
    }
}
