use luna_engine::{
    contract::{OwnerIdentity, assembly::SnapshotAssembly},
    input::profile_write::ProfileWriteRoute,
    runtime::{
        SnapshotRegistry,
        profile_editor_receipt::ProfileEditorReceipt,
        profile_editor_source::LightProfileContext,
        write_resource::{NativeWriteContext, WriteContextKind, WriteContextStamp},
    },
};
use serde_json::{Value, json};
#[path = "support/value_pool.rs"]
mod value_pool;
fn stamp(token: &str) -> WriteContextStamp {
    WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":token,"databaseSchemaVersion":35})).unwrap()
}
fn source(state: &Value, epoch: i64, registry: &SnapshotRegistry) -> LightProfileContext {
    let mut a=SnapshotAssembly::begin(&serde_json::to_vec(&json!({"ownerScope":"receipt-owner","ownerEpoch":1,"snapshotId":"receipt-source","snapshotRevision":1,"selectedPackageIds":{"tariff":[],"legal":[],"holiday":[]},"completeness":{"entries":{"kind":"MISSING"},"history":{"kind":"MISSING"},"annexAEntries":{"kind":"MISSING"},"annexAPauseDetails":{"kind":"MISSING"}}})).unwrap()).unwrap();
    let mut row = state["userProfile"][0].clone();
    row.as_object_mut().unwrap().remove("id");
    let preferences = state["preferences"].as_array().unwrap();
    let salary = preferences
        .iter()
        .filter(|r| {
            [
                "salary_nursing_training",
                "salary_vka_e",
                "salary_tvl_kr",
                "salary_tvuk_nursing",
                "simpleSalary.tvhKr",
                "salary_tval_pflege",
            ]
            .iter()
            .any(|k| r["key"] == *k)
        })
        .map(|r| json!({"key":r["key"],"value":r["value"]}))
        .collect::<Vec<_>>();
    let pattern = preferences
        .iter()
        .filter(|r| r["key"] == "tvoed_workplace_coverage" || r["key"] == "tvoed_assignment")
        .cloned()
        .collect::<Vec<_>>();
    for (kind, value) in [
        (
            "WORK_PROFILE",
            json!({"profileRow":row,"salaryRows":salary}),
        ),
        ("REMUNERATION_PROFILES", state["history"].clone()),
        ("WORK_PATTERN_SETTINGS", json!(pattern)),
    ] {
        a.source(&serde_json::to_vec(&json!({"kind":kind,"source":{"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE"}}}})).unwrap(),&serde_json::to_vec(&value).unwrap()).unwrap();
    }
    LightProfileContext::prepare(
        registry.utility_owner_marker().unwrap(),
        stamp("11111111111111111111111111111111"),
        a,
        epoch,
    )
    .unwrap()
}
#[test]
fn actual_native_commit_postimage_has_original_appport_receipt_role_without_reprojection() {
    let d = value_pool::decode(include_str!(
        "../../reference/profile-write-sql-golden.json"
    ));
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("receipt-owner", 1).unwrap())
        .unwrap();
    let mut count = 0;
    for c in d["cases"].as_array().unwrap().iter().filter(|c| {
        c["expected"]["result"]["ok"] == true
            && c["input"]["route"] == "APP_PORT"
            && c["input"]["state"]["userProfile"].as_array().unwrap().len() == 1
    }) {
        let i = &c["input"];
        let epoch = i["observedEpochMilliseconds"].as_i64().unwrap();
        let light = source(&i["state"], epoch, &registry);
        let origin = light.context().unwrap().identity();
        let context = NativeWriteContext::from_raw(
            registry.utility_owner_marker().unwrap(),
            light.stamp().clone(),
            WriteContextKind::Profile,
            &serde_json::to_vec(&i["state"]).unwrap(),
        )
        .unwrap();
        let raw: Value = serde_json::from_str(i["rawInputJson"].as_str().unwrap()).unwrap();
        let permit = context
            .prepare_profile(&raw, ProfileWriteRoute::AppPort, epoch as f64)
            .unwrap();
        let taken = context.take(&permit).unwrap();
        let plan: Value = serde_json::from_str(&taken.body).unwrap();
        let changed = !plan["mutations"].as_array().unwrap().is_empty();
        let committed = context
            .acknowledge(
                &permit,
                stamp(if changed {
                    "22222222222222222222222222222222"
                } else {
                    "11111111111111111111111111111111"
                }),
            )
            .unwrap();
        let receipt =
            ProfileEditorReceipt::from_committed_native(origin, &context, committed).unwrap();
        assert_eq!(
            receipt.profile().as_ref(),
            &c["expected"]["result"]["value"],
            "{}",
            c["id"]
        );
        assert_eq!(receipt.identity(), origin);
        count += 1;
    }
    assert_eq!(count, 362);
}

#[test]
fn a_committed_profile_cannot_be_adopted_by_another_native_context_or_after_owner_reset() {
    use luna_engine::runtime::write_resource::WriteResourceError;
    let d = value_pool::decode(include_str!(
        "../../reference/profile-write-sql-golden.json"
    ));
    let c = d["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            c["expected"]["result"]["ok"] == true
                && c["input"]["route"] == "APP_PORT"
                && c["input"]["state"]["userProfile"].as_array().unwrap().len() == 1
        })
        .unwrap();
    let i = &c["input"];
    let epoch = i["observedEpochMilliseconds"].as_i64().unwrap();
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("receipt-owner", 1).unwrap())
        .unwrap();
    let light = source(&i["state"], epoch, &registry);
    let origin = light.context().unwrap().identity();
    let raw: Value = serde_json::from_str(i["rawInputJson"].as_str().unwrap()).unwrap();
    let new_context = || {
        NativeWriteContext::from_raw(
            registry.utility_owner_marker().unwrap(),
            light.stamp().clone(),
            WriteContextKind::Profile,
            &serde_json::to_vec(&i["state"]).unwrap(),
        )
        .unwrap()
    };
    let first = new_context();
    let other = new_context();
    let mint = |context: &NativeWriteContext| {
        let permit = context
            .prepare_profile(&raw, ProfileWriteRoute::AppPort, epoch as f64)
            .unwrap();
        let taken = context.take(&permit).unwrap();
        let plan: Value = serde_json::from_str(&taken.body).unwrap();
        context
            .acknowledge(
                &permit,
                stamp(if plan["mutations"].as_array().unwrap().is_empty() {
                    "11111111111111111111111111111111"
                } else {
                    "22222222222222222222222222222222"
                }),
            )
            .unwrap()
    };
    assert!(matches!(
        ProfileEditorReceipt::from_committed_native(origin, &other, mint(&first)),
        Err(WriteResourceError::ForeignPermit)
    ));
    let old = mint(&first);
    registry
        .reset_for_owner(&OwnerIdentity::new("receipt-owner", 1).unwrap())
        .unwrap();
    assert!(matches!(
        ProfileEditorReceipt::from_committed_native(origin, &first, old),
        Err(WriteResourceError::OwnerChanged)
    ));
}
