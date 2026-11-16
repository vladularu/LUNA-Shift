use super::*;
use serde_json::json;
use std::collections::BTreeMap;
fn error(value: &InputError) -> Value {
    json!({"name":value.name(),"message":value.message(),"userFacing":value.user_facing_message().is_some(),"code":null})
}
#[test]
fn original_template_sql_values_results_and_clock_order() {
    let data = crate::test_value_pool::decode(include_str!(
        "../../../../reference/template-write-golden.json"
    ));
    assert_eq!(data["cases"].as_array().unwrap().len(), 135);
    let mut sql_boundaries = 0;
    let mut committed_decode_failures = 0;
    for case in data["cases"].as_array().unwrap() {
        let input = &case["input"];
        let source = NativeTemplateWriteSource::from_raw_rows(Arc::from(
            input["rows"].as_array().unwrap().clone(),
        ))
        .unwrap();
        let epochs = input["epochs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| n.as_f64().unwrap())
            .collect::<Vec<_>>();
        let attempt = source.prepare(
            serde_json::from_value(input["operation"].clone()).unwrap(),
            &input["payload"],
            &epochs,
            input["allocatedId"].as_str(),
        );
        let expected = &case["expected"];
        assert_eq!(
            json!(attempt.observed_epochs()),
            expected["observedEpochs"],
            "{} raw clock order",
            case["id"]
        );
        match attempt.result() {
            Err(failure) => {
                assert_eq!(
                    expected["result"]["ok"], false,
                    "{} must prepare original write",
                    case["id"]
                );
                assert_eq!(
                    error(failure),
                    expected["result"]["error"],
                    "{} native prewrite error",
                    case["id"]
                );
                assert_eq!(
                    input["rows"], expected["rows"],
                    "prewrite failure cannot claim a committed row"
                );
            }
            Ok(plan) => {
                assert_eq!(plan.value()["schemaVersion"], 1);
                assert_eq!(plan.value()["guards"], json!([]));
                let mutations = plan.value()["mutations"].as_array().unwrap();
                if expected["result"]["error"]["code"] == "SQLITE_CONSTRAINT_NOTNULL" {
                    // A raw intent is not successful SQL: the original SQLite
                    // NOT NULL constraint is required in the actual writer gate.
                    assert_eq!(case["id"], "field/sortOrder/null");
                    assert_eq!(mutations.len(), 1);
                    assert!(mutations[0]["row"]["sort_order"].is_null());
                    assert_eq!(input["rows"], expected["rows"]);
                    sql_boundaries += 1;
                    continue;
                }
                let mut rows = input["rows"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|row| (row["id"].as_str().unwrap().to_owned(), row.clone()))
                    .collect::<BTreeMap<_, _>>();
                for mutation in mutations {
                    assert!(
                        [
                            "UPSERT_SHIFT_TEMPLATE",
                            "TOMBSTONE_SHIFT_TEMPLATE",
                            "RESTORE_SHIFT_TEMPLATE",
                            "UPDATE_SHIFT_TEMPLATE_ORDER"
                        ]
                        .contains(&mutation["kind"].as_str().unwrap())
                    );
                    let row = &mutation["row"];
                    assert_eq!(
                        row.as_object().unwrap().len(),
                        17,
                        "closed physical template row"
                    );
                    rows.insert(row["id"].as_str().unwrap().to_owned(), row.clone());
                }
                assert_eq!(
                    json!(rows.into_values().collect::<Vec<_>>()),
                    expected["rows"],
                    "{} complete physical row intent",
                    case["id"]
                );
                match plan.postwrite_result() {
                    Ok(returned) => {
                        assert_eq!(
                            expected["result"]["ok"], true,
                            "{} original write result",
                            case["id"]
                        );
                        assert_eq!(
                            returned, &expected["result"]["value"],
                            "{} exact mapped receipt/JSON bytes",
                            case["id"]
                        );
                    }
                    Err(failure) => {
                        assert_eq!(expected["result"]["ok"], false);
                        assert_eq!(error(failure), expected["result"]["error"]);
                        assert_eq!(case["id"], "field/sortOrder/0.5");
                        assert_ne!(
                            input["rows"], expected["rows"],
                            "original source commits before post-read failure"
                        );
                        committed_decode_failures += 1;
                    }
                }
            }
        }
    }
    assert_eq!((sql_boundaries, committed_decode_failures), (1, 1));
}

fn small_row(id: &str) -> Value {
    json!({"id":id,"name":"x","type":"FREE","all_day":1,"start_time":null,"end_time":null,"break_minutes":0,"color":"#000000","symbol":"x","notification_json":null,"location_json":null,"sort_order":0,"special_duty_json":null,"revision":1,"created_at":"x","updated_at":"x","deleted_at":null})
}

#[test]
fn raw_template_sources_reject_foreign_flags_duplicates_and_shared_limits() {
    let mut foreign = small_row("one");
    foreign["ready"] = json!(true);
    assert!(NativeTemplateWriteSource::from_raw_rows(Arc::from(vec![foreign])).is_err());
    assert!(
        NativeTemplateWriteSource::from_raw_rows(Arc::from(vec![
            small_row("same"),
            small_row("same")
        ]))
        .is_err()
    );
    assert!(
        NativeTemplateWriteSource::from_raw_rows(Arc::from(vec![Value::Null; MAX_ROWS + 1]))
            .is_err()
    );
    let mut large = small_row("one");
    large["name"] = json!("x".repeat(MAX_BYTES as usize));
    assert!(NativeTemplateWriteSource::from_raw_rows(Arc::from(vec![large])).is_err());
}

#[test]
fn sparse_template_plan_releases_fifty_thousand_raw_row_owner() {
    let rows: Arc<[Value]> = Arc::from(
        (0..50_000)
            .map(|i| small_row(&format!("t{i}")))
            .collect::<Vec<_>>(),
    );
    let weak = Arc::downgrade(&rows);
    let source = NativeTemplateWriteSource::from_raw_rows(Arc::clone(&rows)).unwrap();
    assert_eq!(Arc::strong_count(&rows), 2);
    drop(rows);
    let data = crate::test_value_pool::decode(include_str!(
        "../../../../reference/template-write-golden.json"
    ));
    let mut payload = data["cases"][0]["input"]["payload"].clone();
    payload["id"] = json!("t0");
    payload["expectedRevision"] = json!(1);
    let attempt = source.prepare(
        TemplateWriteOperation::Save,
        &payload,
        &[1794746096789.0],
        None,
    );
    let plan = attempt.into_result().unwrap();
    assert_eq!(plan.value()["mutations"].as_array().unwrap().len(), 1);
    assert_eq!(plan.value()["mutations"][0]["row"]["id"], "t0");
    assert_eq!(plan.postwrite_result().unwrap()["revision"], 2);
    assert!(serde_json::to_vec(plan.value()).unwrap().len() < 8192);
    drop(source);
    assert!(
        weak.upgrade().is_none(),
        "one sparse planned row never retains the entire source owner"
    );
    assert_eq!(plan.postwrite_result().unwrap()["id"], "t0");
}
