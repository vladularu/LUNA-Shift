mod common;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::{OwnerIdentity, SourceKind, assembly::SnapshotAssembly},
    input::entry_editor_save::EntrySaveFailure,
    runtime::{
        SnapshotRegistry,
        day_editor_controller::NativeDayController,
        day_editor_source::{
            DayEditorSourceError, DayEntryReadState, NativeDayEditorSource, RawDayEntrySource,
        },
        profile_editor_source::LightProfileContext,
        write_resource::WriteContextStamp,
    },
};
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Arc};
fn stamp() -> WriteContextStamp {
    WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35})).unwrap()
}
fn registry() -> SnapshotRegistry {
    let r = SnapshotRegistry::default();
    r.reset_for_owner(&OwnerIdentity::new("day-controller", 1).unwrap())
        .unwrap();
    r
}
fn source(
    r: &SnapshotRegistry,
    input: &Value,
    profile: Option<&Value>,
    index: usize,
) -> Arc<NativeDayEditorSource> {
    let mut assembly=SnapshotAssembly::begin(&serde_json::to_vec(&json!({"ownerScope":"day-controller","ownerEpoch":1,"snapshotId":format!("day-{index}"),"snapshotRevision":1,"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}})).unwrap()).unwrap();
    if let Some(profile) = profile {
        for (kind, key) in [
            (SourceKind::WorkProfile, "profile"),
            (SourceKind::RemunerationProfiles, "historyRows"),
            (SourceKind::WorkPatternSettings, "patternRows"),
        ] {
            let raw = &profile[key];
            let null = raw.is_null();
            let header = json!({"kind":kind,"source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":if null{"NULL"}else{"VALUE"}}}}});
            let bytes = if null {
                vec![]
            } else {
                serde_json::to_vec(raw).unwrap()
            };
            assembly
                .source(&serde_json::to_vec(&header).unwrap(), &bytes)
                .unwrap();
        }
    } else {
        for group in input["profileSources"].as_array().unwrap() {
            let header = json!({"kind":group["kind"],"source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":group["presence"]}}}});
            assembly
                .source(
                    &serde_json::to_vec(&header).unwrap(),
                    group["body"].as_str().unwrap().as_bytes(),
                )
                .unwrap();
        }
    }
    let epoch = profile.unwrap_or(input)["observedEpochMilliseconds"]
        .as_i64()
        .unwrap();
    let light =
        LightProfileContext::prepare(r.utility_owner_marker().unwrap(), stamp(), assembly, epoch)
            .unwrap();
    let rows: Vec<_> = input["entrySources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|group| RawDayEntrySource {
            kind: serde_json::from_value(group["kind"].clone()).unwrap(),
            state: if group["presence"] == "NULL" {
                DayEntryReadState::Null
            } else {
                DayEntryReadState::Value
            },
            body: group["body"].as_str().unwrap().as_bytes(),
        })
        .collect();
    Arc::new(
        NativeDayEditorSource::from_light(
            light,
            &stamp(),
            serde_json::from_value(input["request"].clone()).unwrap(),
            &rows,
        )
        .unwrap(),
    )
}
#[test]
fn original_sql_open_draft_type_duty_display_and_save_sequences_match() {
    let f = value_pool::decode(include_str!(
        "../../reference/day-editor-controller-golden.json"
    ));
    let seeds = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    let profiles = value_pool::decode(include_str!(
        "../../reference/profile-editor-source-golden.json"
    ));
    assert_eq!(f["cases"].as_array().unwrap().len(), 4170);
    let r = registry();
    let mut sources = HashMap::new();
    let mut frames = 0;
    for case in f["cases"].as_array().unwrap() {
        let input = &case["input"];
        let index = input["sourceIndex"].as_u64().unwrap() as usize;
        let profile_index = input["profileSourceIndex"].as_u64().map(|v| v as usize);
        let next = sources.len();
        let source = sources
            .entry((index, profile_index))
            .or_insert_with(|| {
                source(
                    &r,
                    &seeds["cases"][index]["input"],
                    profile_index.map(|p| &profiles["cases"][p]["input"]),
                    next,
                )
            })
            .clone();
        let marker = r.preparation_marker().unwrap();
        let mut controller = NativeDayController::new(source, f["appearance"].clone()).unwrap();
        let mut actual = Vec::new();
        let mut presentations = Vec::new();
        let mut capture = |controller: &NativeDayController| {
            let view = controller.view().unwrap();
            let seed = &seeds["cases"][index];
            assert_eq!(view["context"]["mode"], seed["expected"]["mode"]);
            assert_eq!(
                view["context"]["routeDate"],
                seed["input"]["request"]["date"]
            );
            assert_eq!(
                view["context"]["canDelete"],
                !seed["expected"]["initial"].is_null()
            );
            let expected_date =
                if seed["expected"]["mode"] == "SHIFT" && !seed["expected"]["initial"].is_null() {
                    &seed["expected"]["initial"]["date"]
                } else {
                    &seed["input"]["request"]["date"]
                };
            assert_eq!(&view["context"]["date"], expected_date);
            let expected_zone = profile_index
                .map(|p| &profiles["cases"][p]["expected"]["value"]["profile"]["timeZone"]);
            assert_eq!(
                view["context"]["timeZone"].as_str().unwrap(),
                expected_zone
                    .and_then(Value::as_str)
                    .unwrap_or("Europe/Berlin")
            );
            let mut draft = view["draft"].clone();
            draft["initialSignature"] = json!(controller.initial_signature().unwrap());
            actual.push(draft);
            presentations.push(view["presentation"].clone());
        };
        capture(&controller);
        for action in input["actions"].as_array().unwrap() {
            match action["kind"].as_str().unwrap() {
                "SET" => controller
                    .set(action["field"].as_str().unwrap(), action["value"].clone())
                    .unwrap(),
                "TYPE" => controller
                    .choose_type(action["value"].as_str().unwrap())
                    .unwrap(),
                "DUTY" => controller.change_duty(&action["value"]).unwrap(),
                _ => panic!("closed fixture action"),
            }
            capture(&controller);
        }
        common::assert_json_eq(
            &json!(actual),
            &case["expected"]["frames"],
            case["id"].as_str().unwrap(),
        );
        for (i, presentation) in presentations.iter().enumerate() {
            for field in ["display", "renderFailed", "tariff", "tariffError"] {
                common::assert_json_eq(
                    &presentation[field],
                    &case["expected"]["presentations"][i][field],
                    &format!("{}:frame{i}:{field}", case["id"]),
                );
            }
        }
        let failure = match input["ioFailure"].as_str() {
            None => None,
            Some("VALIDATION") => Some(EntrySaveFailure::UserFacing(
                "Source validation failure".into(),
            )),
            Some("CONCURRENCY") => Some(EntrySaveFailure::UserFacing(
                "Der Eintrag wurde zwischenzeitlich geändert. Bitte neu laden.".into(),
            )),
            Some("GENERIC") => Some(EntrySaveFailure::Internal),
            _ => panic!("fixture failure"),
        };
        let prepared = controller
            .prepare_save(
                input["busy"].as_bool().unwrap_or(false),
                input["closeAfterSave"].as_bool().unwrap_or(false),
            )
            .unwrap();
        common::assert_json_eq(
            &prepared.finish(failure.as_ref()),
            &case["expected"]["save"],
            case["id"].as_str().unwrap(),
        );
        assert!(
            marker.is_current().unwrap(),
            "form must not replace report preparation"
        );
        frames += actual.len();
    }
    assert_eq!(frames, 9990);
}

#[test]
fn actual_original_standby_components_rebind_to_the_owned_editor_without_losing_partial_text() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-standby-controller-golden.json"
    ));
    let seeds = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 449);
    let r = registry();
    let mut frames = 0;
    for (index, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let input = &case["input"];
        let seed = &seeds["cases"][input["sourceIndex"].as_u64().unwrap() as usize];
        let mut controller=NativeDayController::new(source(&r,&seed["input"],None,index),json!({"defaultShiftColor":"#123456","appointmentColor":"#654321","presets":{},"billingFocus":input["appearance"]["billingFocus"]})).unwrap();
        for action in input["bootstrap"].as_array().unwrap() {
            match action["kind"].as_str().unwrap() {
                "DUTY" => controller.change_duty(&action["value"]).unwrap(),
                "SET" => controller
                    .set(action["field"].as_str().unwrap(), action["value"].clone())
                    .unwrap(),
                _ => panic!("closed original bootstrap"),
            }
        }
        let mut actual = Vec::new();
        let mut capture = |controller: &NativeDayController| {
            let view = controller.view().unwrap();
            let mut draft = view["draft"].clone();
            draft["initialSignature"] = json!(controller.initial_signature().unwrap());
            actual.push(json!({"draft":draft,"standbyViews":view["standbyViews"]}));
        };
        capture(&controller);
        for command in input["commands"].as_array().unwrap() {
            match command["kind"].as_str().unwrap() {
                "STANDBY" => controller
                    .standby_event(
                        command["component"].as_u64().unwrap() as usize,
                        &command["action"],
                    )
                    .unwrap(),
                "DUTY" => controller.change_duty(&command["value"]).unwrap(),
                _ => panic!("closed original command"),
            }
            capture(&controller);
        }
        frames += actual.len();
        common::assert_json_eq(
            &json!(actual),
            &case["expected"]["frames"],
            case["id"].as_str().unwrap(),
        );
    }
    assert_eq!(frames, 904);
}
#[test]
fn reset_permanently_fences_draft_display_and_save_and_appearance_is_bounded() {
    let seeds = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    let f = value_pool::decode(include_str!(
        "../../reference/day-editor-controller-golden.json"
    ));
    let r = registry();
    let s = source(&r, &seeds["cases"][0]["input"], None, 0);
    let mut bad = f["appearance"].clone();
    bad["unused"] = json!("x".repeat(16 * 1024));
    assert!(NativeDayController::new(s.clone(), bad).is_err());
    let mut c = NativeDayController::new(s, f["appearance"].clone()).unwrap();
    assert!(c.set("unknown", Value::Null).is_err());
    assert!(c.set("shiftTitle", json!("x".repeat(256 * 1024))).is_err());
    r.reset_for_owner(&OwnerIdentity::new("day-controller", 1).unwrap())
        .unwrap();
    assert!(matches!(c.view(), Err(DayEditorSourceError::OwnerChanged)));
    assert!(matches!(
        c.prepare_save(false, true),
        Err(DayEditorSourceError::OwnerChanged)
    ));
    assert!(c.set("shiftTitle", json!("stale")).is_err());
    assert!(c.choose_type("EARLY").is_err());
    assert!(c.change_duty(&Value::Null).is_err());
}

#[test]
fn original_component_commands_and_private_mode_drafts_feed_the_same_owned_day_draft() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-duty-controller-golden.json"
    ));
    let seeds = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    let profiles = value_pool::decode(include_str!(
        "../../reference/profile-editor-source-golden.json"
    ));
    let appearance = value_pool::decode(include_str!(
        "../../reference/day-editor-controller-golden.json"
    ))["appearance"]
        .clone();
    assert_eq!(fixture["cases"].as_array().unwrap().len(), 24);
    let r = registry();
    let mut frames = 0;
    for (index, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let input = &case["input"];
        let source_index = input["sourceIndex"].as_u64().unwrap() as usize;
        let profile = input["profileSourceIndex"]
            .as_u64()
            .map(|p| &profiles["cases"][p as usize]["input"]);
        let mut c = NativeDayController::new(
            source(&r, &seeds["cases"][source_index]["input"], profile, index),
            appearance.clone(),
        )
        .unwrap();
        let mut observations = vec![c.view().unwrap()["draft"].clone()];
        let mut statuses = vec![];
        for command in input["commands"].as_array().unwrap() {
            statuses.push(
                c.duty_draft_event(command["operation"].as_str().unwrap(), &command["args"])
                    .unwrap(),
            );
            observations.push(c.view().unwrap()["draft"].clone());
        }
        for (i, view) in observations.iter().enumerate() {
            common::assert_json_eq(
                &view["fields"],
                &case["expected"]["frames"][i]["fields"],
                &format!("{}:frame{i}", case["id"]),
            );
            assert_eq!(
                view["hasChanges"],
                case["expected"]["frames"][i]["hasChanges"]
            );
            frames += 1;
        }
        common::assert_json_eq(
            &json!(statuses),
            &case["expected"]["results"],
            case["id"].as_str().unwrap(),
        );
    }
    assert_eq!(frames, 240);
}

#[test]
fn actual_original_parent_part_callout_clock_day_and_pause_callbacks_match_owned_controller() {
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-block-controller-golden.json"
    ));
    let seeds = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    let appearance = value_pool::decode(include_str!(
        "../../reference/day-editor-controller-golden.json"
    ))["appearance"]
        .clone();
    let r = registry();
    let mut frames = 0;
    for (index, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let mut c = NativeDayController::new(
            source(&r, &seeds["cases"][0]["input"], None, index),
            appearance.clone(),
        )
        .unwrap();
        for action in case["input"]["bootstrap"].as_array().unwrap() {
            if action["kind"] == "DUTY" {
                c.change_duty(&action["value"]).unwrap();
            } else {
                c.set(action["field"].as_str().unwrap(), action["value"].clone())
                    .unwrap();
            }
        }
        let mut views = vec![c.view().unwrap()["draft"].clone()];
        for command in case["input"]["commands"].as_array().unwrap() {
            let mut event = command.clone();
            event["structureRevision"] = c.view().unwrap()["dutyStructureRevision"].clone();
            assert!(
                c.duty_block_event(serde_json::from_value(event).unwrap())
                    .unwrap()
            );
            views.push(c.view().unwrap()["draft"].clone());
        }
        for (i, view) in views.iter().enumerate() {
            common::assert_json_eq(
                &view["fields"],
                &case["expected"]["frames"][i]["fields"],
                &format!("{}:frame{i}", case["id"]),
            );
            assert_eq!(
                view["hasChanges"],
                case["expected"]["frames"][i]["hasChanges"]
            );
            frames += 1;
        }
    }
    assert_eq!(frames, 24);
}
#[test]
fn a_delayed_block_cannot_edit_another_part_after_removal_but_clock_edits_do_not_retire_controls() {
    use luna_engine::runtime::day_editor_controller::{
        DutyBlockEdit, DutyBlockOperation, DutyBlockTarget,
    };
    let ui = value_pool::decode(include_str!("../../reference/duty-view-golden.json"));
    let scene = ui["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            c["input"]["value"]["kind"] == "SPLIT"
                && c["input"]["value"]["parts"].as_array().unwrap().len() > 1
        })
        .unwrap();
    let seeds = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    let appearance = value_pool::decode(include_str!(
        "../../reference/day-editor-controller-golden.json"
    ))["appearance"]
        .clone();
    let r = registry();
    let mut c =
        NativeDayController::new(source(&r, &seeds["cases"][0]["input"], None, 0), appearance)
            .unwrap();
    c.change_duty(&scene["input"]["value"]).unwrap();
    let revision = c.view().unwrap()["dutyStructureRevision"].as_u64().unwrap();
    assert!(
        c.duty_block_event(DutyBlockEdit {
            target: DutyBlockTarget::Part { index: 0 },
            operation: DutyBlockOperation::Pause,
            text: "10".into(),
            structure_revision: revision
        })
        .unwrap()
    );
    assert_eq!(c.view().unwrap()["dutyStructureRevision"], revision);
    assert!(
        c.duty_inline_event("PART_REMOVE", 0, &Value::Null, revision)
            .unwrap()
    );
    let before = c.view().unwrap();
    assert!(
        c.duty_block_event(DutyBlockEdit {
            target: DutyBlockTarget::Part { index: 0 },
            operation: DutyBlockOperation::Pause,
            text: "60".into(),
            structure_revision: revision
        })
        .is_err()
    );
    assert_eq!(c.view().unwrap(), before);
}

#[test]
fn native_block_pipeline_has_the_original_duration_displays_and_save_outcomes_without_json_reopening()
 {
    let fixture = value_pool::decode(include_str!(
        "../../reference/day-block-pipeline-golden.json"
    ));
    let seeds = value_pool::decode(include_str!(
        "../../reference/day-editor-source-golden.json"
    ));
    let appearance = value_pool::decode(include_str!(
        "../../reference/day-editor-controller-golden.json"
    ))["appearance"]
        .clone();
    let r = registry();
    let mut frames = 0;
    for (index, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let mut c = NativeDayController::new(
            source(&r, &seeds["cases"][0]["input"], None, index),
            appearance.clone(),
        )
        .unwrap();
        for action in case["input"]["bootstrap"].as_array().unwrap() {
            if action["kind"] == "DUTY" {
                c.change_duty(&action["value"]).unwrap();
            } else {
                c.set(action["field"].as_str().unwrap(), action["value"].clone())
                    .unwrap();
            }
        }
        for frame in 0..case["expected"]["frames"].as_array().unwrap().len() {
            if frame > 0 {
                let mut event = case["input"]["commands"][frame - 1].clone();
                event["structureRevision"] = c.view().unwrap()["dutyStructureRevision"].clone();
                assert!(
                    c.duty_block_event(serde_json::from_value(event).unwrap())
                        .unwrap()
                );
            }
            let view = c.view().unwrap();
            for field in ["display", "renderFailed", "tariff", "tariffError"] {
                common::assert_json_eq(
                    &view["presentation"][field],
                    &case["expected"]["presentations"][frame][field],
                    &format!("{}:frame{frame}:{field}", case["id"]),
                );
            }
            common::assert_json_eq(
                &view["specialDutyView"],
                &case["expected"]["dutyViews"][frame],
                &format!("{}:frame{frame}:wholeDutyView", case["id"]),
            );
            common::assert_json_eq(
                &c.prepare_save(false, false).unwrap().finish(None),
                &case["expected"]["saves"][frame],
                &format!("{}:frame{frame}:save", case["id"]),
            );
            frames += 1;
        }
    }
    assert_eq!(frames, 24);
}
