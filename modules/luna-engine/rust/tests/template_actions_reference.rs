mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::input::{javascript_json, template_actions::TemplateActionCommand};
use serde_json::{Value, json};
fn execute(value: Value) -> Value {
    serde_json::from_value::<TemplateActionCommand>(value)
        .unwrap()
        .execute()
        .unwrap()
}
#[test]
fn stateless_actions_reuse_full_original_template_io_captures() {
    let data = value_pool::decode(include_str!(
        "../../reference/template-controller-golden.json"
    ));
    let mut saves = 0;
    let mut quick = 0;
    for case in data["cases"].as_array().unwrap() {
        for capture in case["observations"]["helperCaptures"].as_array().unwrap() {
            let previous = &capture["previousSave"];
            let previous_json = if previous.is_null() {
                Value::Null
            } else {
                json!(javascript_json::stringify(&previous["input"]).unwrap())
            };
            let plan = execute(
                json!({"mode":"SAVE_PLAN","input":capture["input"],"quickEntryDate":capture["quickEntryDate"],"currentJson":capture["inputJson"],"previousJson":previous_json,"previousTemplate":previous.get("template").unwrap_or(&Value::Null)}),
            );
            let frame = &case["expected"]["frames"][capture["step"].as_u64().unwrap() as usize];
            let requested = frame["pending"].as_array().unwrap().first();
            if requested.is_some_and(|v| v["kind"] == "TEMPLATE") {
                assert_eq!(plan["kind"], "SAVE");
                let mut input = capture["input"].clone();
                if let Some(overrides) = plan.get("overrides") {
                    for (k, v) in overrides.as_object().unwrap() {
                        input[k] = v.clone();
                    }
                }
                common::assert_json_eq(
                    &input,
                    &requested.unwrap()["input"],
                    case["id"].as_str().unwrap(),
                );
            } else {
                assert_eq!(plan["kind"], "REUSE");
            }
            saves += 1;
        }
        for frame in case["expected"]["frames"].as_array().unwrap() {
            for pending in frame["pending"].as_array().unwrap() {
                if pending["kind"] == "SHIFT" {
                    let actual = execute(
                        json!({"mode":"QUICK_INPUT","template":frame["progress"]["template"],"date":case["input"]["quickEntryDate"]}),
                    );
                    common::assert_json_eq(
                        &actual,
                        &pending["input"],
                        case["id"].as_str().unwrap(),
                    );
                    quick += 1;
                }
            }
        }
    }
    assert_eq!(saves, 90);
    assert!(quick > 0);
}

#[test]
fn stateless_public_utility_is_owner_fenced_and_closed_without_a_snapshot() {
    use luna_engine::{
        contract::{self, OwnerIdentity, utility::parse_utility_request},
        runtime::{SnapshotRegistry, utility},
    };
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("template-actions-owner", 1).unwrap())
        .unwrap();
    let envelope = json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":"template-actions-owner","ownerEpoch":1,"requestId":"pure-actions","draftRevision":1},"operation":{"kind":"TEMPLATE_ACTIONS","command":{"mode":"SAVE_PLAN","input":{},"quickEntryDate":"2026-11-15","currentJson":"{}","previousJson":null,"previousTemplate":null}}});
    let request = parse_utility_request(&serde_json::to_vec(&envelope).unwrap()).unwrap();
    let completion = utility::prepare(
        &registry,
        &registry.utility_owner_marker().unwrap(),
        &request,
    )
    .unwrap();
    let reply: Value = serde_json::from_slice(&completion.serialize_current().unwrap()).unwrap();
    assert_eq!(reply["operation"], "TEMPLATE_ACTIONS");
    assert_eq!(
        reply["result"],
        json!({"state":"VALUE","value":{"kind":"SAVE","createsCalendarEntry":true}})
    );
    let mut bad = envelope;
    bad["operation"]["command"]["ready"] = json!(true);
    assert!(parse_utility_request(&serde_json::to_vec(&bad).unwrap()).is_err());
    registry
        .reset_for_owner(&OwnerIdentity::new("template-actions-owner", 2).unwrap())
        .unwrap();
    assert!(!completion.is_current().unwrap());
    assert!(completion.serialize_current().is_err());
}
#[test]
fn native_match_batch_limit_never_returns_a_partial_result() {
    let input = json!({"mode":"MATCH_INDICES","template":{"id":"t","type":"CUSTOM"},"date":"2026-11-15","entries":vec![json!({});129]});
    assert!(
        serde_json::from_value::<TemplateActionCommand>(input)
            .unwrap()
            .execute()
            .is_err()
    );
}

#[test]
fn stateless_form_glue_matches_all_frozen_original_prefixes() {
    use luna_engine::input::calendar_rows;
    let data = value_pool::decode(include_str!("../../reference/template-editor-golden.json"));
    let mut frames = 0;
    let mut submissions = 0;
    let editable = [
        "name",
        "type",
        "allDay",
        "specialDuty",
        "startTime",
        "endTime",
        "breakMinutes",
        "color",
        "symbol",
        "notification",
        "location",
        "appearanceExpanded",
        "typePickerExpanded",
        "notificationOpen",
    ];
    for case in data["cases"].as_array().unwrap() {
        let source = &case["input"];
        let templates = source["templates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| calendar_rows::map_template(v).unwrap())
            .collect::<Vec<_>>();
        let existing = templates
            .iter()
            .find(|v| v["id"] == source["existingId"])
            .cloned()
            .unwrap_or(Value::Null);
        let steps = source["steps"].as_array().unwrap();
        for (at, frame) in case["expected"]["frames"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
        {
            if at > 0
                && ["COMMIT", "FAIL", "CONFIRM_ARCHIVE"]
                    .iter()
                    .any(|kind| steps[at - 1]["kind"] == *kind)
            {
                break;
            }
            let fields = Value::Object(
                editable
                    .iter()
                    .map(|key| ((*key).into(), frame["fields"][*key].clone()))
                    .collect(),
            );
            let action = |kind: Value, fields: &Value| {
                execute(
                    json!({"mode":"FORM","action":kind,"quickEntryDate":source["quickEntryDate"],"existing":existing,"appearance":data["appearance"],"fields":fields,"templates":templates.iter().map(|v|json!({"sortOrder":v["sortOrder"]})).collect::<Vec<_>>()}),
                )
            };
            let actual = action(json!({"kind":"VIEW"}), &fields);
            for key in ["absence", "entryType", "typeLocked"] {
                assert_eq!(
                    actual["flags"][key], frame["flags"][key],
                    "{}:{at}:{key}",
                    case["id"]
                );
            }
            if let Some(step) = steps.get(at) {
                if step["kind"] == "FIELD" && step["field"] == "specialDuty" {
                    let actual = action(
                        json!({"kind":"APPLY","events":[{"field":"duty","value":step["value"]}]}),
                        &fields,
                    );
                    let next = &case["expected"]["frames"][at + 1]["fields"];
                    for key in editable {
                        common::assert_json_eq(
                            &actual["fields"][key],
                            &next[key],
                            case["id"].as_str().unwrap(),
                        );
                    }
                }
                if step["kind"] == "TYPE" {
                    let actual = action(json!({"kind":"TYPE","candidate":step["value"]}), &fields);
                    let next = &case["expected"]["frames"][at + 1]["fields"];
                    for key in ["type", "color", "symbol", "typePickerExpanded"] {
                        assert_eq!(
                            actual["fields"][key], next[key],
                            "{}:{at}:{key}",
                            case["id"]
                        );
                    }
                }
                if step["kind"] == "SUBMIT" && frame["fields"]["saving"] != true {
                    let actual = action(json!({"kind":"SUBMIT"}), &fields);
                    let next = &case["expected"]["frames"][at + 1];
                    if let Some(write) = next["writes"].as_array().unwrap().last() {
                        assert_eq!(actual["kind"], "PREPARED");
                        common::assert_json_eq(
                            &actual["input"],
                            &write["input"],
                            case["id"].as_str().unwrap(),
                        );
                    } else {
                        assert_eq!(actual["kind"], "BLOCKED");
                        for key in ["nameError", "symbolError", "error", "appearanceExpanded"] {
                            assert_eq!(
                                actual["fields"][key], next["fields"][key],
                                "{}:{at}:{key}",
                                case["id"]
                            );
                        }
                    }
                    submissions += 1;
                }
            }
            frames += 1;
        }
    }
    assert_eq!(frames, 509);
    assert!(submissions > 0);
}
