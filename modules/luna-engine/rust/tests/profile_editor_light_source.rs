use luna_engine::{
    contract::{OwnerIdentity, SourceKind, assembly::SnapshotAssembly},
    input::profile_editor::EditorSection,
    rules::RuleResolver,
    runtime::{
        SnapshotRegistry,
        facts::FactError,
        profile_editor_source::{LightProfileContext, LightProfileError},
        write_resource::WriteContextStamp,
    },
};
use serde_json::{Value, json};
#[path = "support/value_pool.rs"]
mod value_pool;
fn registry() -> SnapshotRegistry {
    let r = SnapshotRegistry::default();
    r.reset_for_owner(&OwnerIdentity::new("light-profile", 1).unwrap())
        .unwrap();
    r
}
fn stamp() -> WriteContextStamp {
    WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35})).unwrap()
}
fn begin(index: usize, owner: &str) -> SnapshotAssembly {
    SnapshotAssembly::begin(&serde_json::to_vec(&json!({"ownerScope":owner,"ownerEpoch":1,"snapshotId":format!("light-{index}"),"snapshotRevision":1,"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}})).unwrap()).unwrap()
}
fn add(source: &mut SnapshotAssembly, kind: SourceKind, raw: &Value) {
    let null = raw.is_null();
    let header = json!({"kind":kind,"source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":if null{"NULL"}else{"VALUE"}}}}});
    let body = if null {
        vec![]
    } else {
        serde_json::to_vec(raw).unwrap()
    };
    source
        .source(&serde_json::to_vec(&header).unwrap(), &body)
        .unwrap()
}
fn assembly(i: &Value, index: usize) -> SnapshotAssembly {
    let mut source = begin(index, "light-profile");
    for (k, key) in [
        (SourceKind::WorkProfile, "profile"),
        (SourceKind::RemunerationProfiles, "historyRows"),
        (SourceKind::WorkPatternSettings, "patternRows"),
    ] {
        add(&mut source, k, &i[key]);
    }
    source
}
#[test]
fn genuine_private_raw3_assembly_matches_all_original_provider_editor_outputs_without_global_preparation()
 {
    let data = value_pool::decode(include_str!(
        "../../reference/profile-editor-source-golden.json"
    ));
    assert_eq!(data["cases"].as_array().unwrap().len(), 1662);
    let r = registry();
    let rules = RuleResolver::bundled().unwrap();
    for (index, c) in data["cases"].as_array().unwrap().iter().enumerate() {
        let i = &c["input"];
        let global = r.preparation_marker().unwrap();
        let result = LightProfileContext::prepare(
            r.utility_owner_marker().unwrap(),
            stamp(),
            assembly(i, index),
            i["observedEpochMilliseconds"].as_i64().unwrap(),
        );
        let actual = match result {
            Ok(light) => {
                assert_eq!(light.stamp(), &stamp());
                assert!(light.is_current().unwrap());
                match light.context() {
                    None => json!({"ok":true,"value":null}),
                    Some(source) => {
                        let section: EditorSection =
                            serde_json::from_value(i["section"].clone()).unwrap();
                        match source.bootstrap(section, i["fromMore"].as_bool().unwrap(), &rules) {
                            Ok(bootstrap) => {
                                json!({"ok":true,"value":{"profile":source.profile().as_ref(),"referenceDate":source.reference_date(),"bootstrap":bootstrap}})
                            }
                            Err(e) => json!({"ok":false,"name":e.name(),"message":e.to_string()}),
                        }
                    }
                }
            }
            Err(LightProfileError::Facts(FactError::Profile(e) | FactError::Remuneration(e))) => {
                json!({"ok":false,"name":e.name(),"message":e.message()})
            }
            Err(e) => panic!("{}: {e:?}", c["id"]),
        };
        assert_eq!(actual, c["expected"], "{}", c["id"]);
        assert!(
            global.is_current().unwrap(),
            "editor must never replace report preparation"
        );
    }
}

fn initial() -> Value {
    let d = value_pool::decode(include_str!(
        "../../reference/profile-editor-source-golden.json"
    ));
    d["cases"][0]["input"].clone()
}
#[test]
fn native_source_is_owner_bound_and_does_not_track_report_preparation_revisions() {
    use luna_engine::contract::RevisionFence;
    let r = registry();
    let i = initial();
    let epoch = i["observedEpochMilliseconds"].as_i64().unwrap();
    let marker = r.utility_owner_marker().unwrap();
    assert!(matches!(
        LightProfileContext::prepare(marker.clone(), stamp(), begin(1, "foreign"), epoch),
        Err(LightProfileError::OwnerChanged)
    ));
    let light =
        LightProfileContext::prepare(marker.clone(), stamp(), assembly(&i, 2), epoch).unwrap();
    let fence = RevisionFence::new(OwnerIdentity::new("light-profile", 1).unwrap(), 2).unwrap();
    r.advance_revision(&fence).unwrap();
    assert!(light.is_current().unwrap());
    assert!(LightProfileContext::prepare(marker.clone(), stamp(), assembly(&i, 3), epoch).is_ok());
    r.reset_for_owner(&OwnerIdentity::new("light-profile", 1).unwrap())
        .unwrap();
    assert!(!light.is_current().unwrap());
    assert!(matches!(
        LightProfileContext::prepare(marker, stamp(), assembly(&i, 4), epoch),
        Err(LightProfileError::OwnerChanged)
    ));
}
#[test]
fn missing_failed_and_null_sources_never_become_fabricated_ready_profile() {
    let r = registry();
    let i = initial();
    let epoch = i["observedEpochMilliseconds"].as_i64().unwrap();
    assert!(matches!(
        LightProfileContext::prepare(
            r.utility_owner_marker().unwrap(),
            stamp(),
            begin(1, "light-profile"),
            epoch
        ),
        Err(LightProfileError::Facts(FactError::Source {
            kind: SourceKind::WorkProfile,
            ..
        }))
    ));
    let mut null = begin(2, "light-profile");
    add(&mut null, SourceKind::WorkProfile, &Value::Null);
    assert!(
        LightProfileContext::prepare(r.utility_owner_marker().unwrap(), stamp(), null, epoch)
            .unwrap()
            .context()
            .is_none()
    );
    let mut history = begin(3, "light-profile");
    add(&mut history, SourceKind::WorkProfile, &i["profile"]);
    assert!(matches!(
        LightProfileContext::prepare(r.utility_owner_marker().unwrap(), stamp(), history, epoch),
        Err(LightProfileError::Facts(FactError::Source {
            kind: SourceKind::RemunerationProfiles,
            ..
        }))
    ));
    let mut failed = begin(4, "light-profile");
    failed
        .source(
            br#"{"kind":"WORK_PROFILE","source":{"state":"FAILED","code":"READ_FAILED"}}"#,
            b"",
        )
        .unwrap();
    assert!(matches!(
        LightProfileContext::prepare(r.utility_owner_marker().unwrap(), stamp(), failed, epoch),
        Err(LightProfileError::Facts(FactError::Source {
            kind: SourceKind::WorkProfile,
            ..
        }))
    ));
    let mut extra = assembly(&i, 5);
    add(
        &mut extra,
        SourceKind::WorkingTimeTarget,
        &json!({"days":[]}),
    );
    assert!(matches!(
        LightProfileContext::prepare(r.utility_owner_marker().unwrap(), stamp(), extra, epoch),
        Err(LightProfileError::InvalidSourceScope)
    ));
}
