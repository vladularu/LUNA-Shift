mod common;
#[path = "support/salary_snapshot.rs"]
mod salary_snapshot;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::{self, OwnerIdentity, SnapshotIdentity, utility::*},
    runtime::{self, SnapshotRegistry, financial_report, utility_lease::UtilityFenceError},
};
use serde_json::{Value, json};
use std::sync::Arc;

fn envelope(identity: &SnapshotIdentity, command: Value, revision: u64) -> Value {
    json!({"wireSchemaVersion":contract::SCHEMA_VERSION,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":identity.owner_scope(),"ownerEpoch":identity.owner_epoch(),"requestId":"payroll-form","draftRevision":revision,"snapshot":identity},"operation":{"kind":"PAYROLL_FORM","command":command}})
}
fn request(identity: &SnapshotIdentity, command: Value, revision: u64) -> UtilityRequest {
    parse_utility_request(&serde_json::to_vec(&envelope(identity, command, revision)).unwrap())
        .unwrap()
}
fn call(registry: &SnapshotRegistry, request: &UtilityRequest) -> Value {
    let marker = registry.utility_owner_marker().unwrap();
    let completion = runtime::utility::prepare(registry, &marker, request).unwrap();
    let result: Value = serde_json::from_slice(&completion.serialize_current().unwrap()).unwrap();
    assert_eq!(result["operation"], "PAYROLL_FORM");
    result["result"].clone()
}
fn setup(case: &Value) -> (SnapshotRegistry, SnapshotIdentity) {
    let facts = salary_snapshot::facts(salary_snapshot::raw(case));
    let snapshot = facts.snapshot().clone();
    let identity = snapshot.identity().clone();
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(
            &OwnerIdentity::new(identity.owner_scope(), identity.owner_epoch()).unwrap(),
        )
        .unwrap();
    registry.register(snapshot).unwrap();
    (registry, identity)
}
fn fixture() -> Value {
    value_pool::decode(include_str!("../../reference/payroll-page-golden.json"))
}

#[test]
fn cold_snapshot_utility_never_calculates_missing_financial_seed() {
    let fixture = fixture();
    let case = &fixture["cases"][0];
    let (registry, identity) = setup(case);
    let request = request(
        &identity,
        json!({"kind":"ANNUAL_BOOTSTRAP","month":case["input"]["month"]}),
        1,
    );
    assert_eq!(
        call(&registry, &request),
        json!({"state":"VALUE","value":{"state":"NEEDS_FINANCE"}})
    );
    assert_eq!(
        serde_json::to_value(runtime::utility::calculate(request.operation())).unwrap()["state"],
        "INPUT_ERROR"
    );
}

#[test]
fn only_finance_producer_seeds_original_editor_and_utility_adds_no_money_passes() {
    let fixture = fixture();
    let forms = value_pool::decode(include_str!("../../reference/payroll-form-golden.json"));
    let case = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| {
            case["args"]["settings"]["version"] == 2 && case["input"]["month"] == "2026-11"
        })
        .unwrap();
    let (registry, identity) = setup(case);
    let month = case["input"]["month"].as_str().unwrap();
    let bootstrap = request(
        &identity,
        json!({"kind":"ANNUAL_BOOTSTRAP","month":month}),
        1,
    );
    let marker = registry.utility_owner_marker().unwrap();
    let lease = registry
        .lease_utility(&marker, bootstrap.guard(), UtilityKind::PayrollForm)
        .unwrap();
    let facts = Arc::clone(lease.facts().unwrap());
    drop(lease);
    let output = financial_report::payroll::calculate(&facts, month).unwrap();
    common::assert_json_eq(
        &output,
        &case["expected"],
        "ordinary Payroll result is unchanged",
    );
    let original = forms["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|form| form["id"] == format!("original-{}", case["id"].as_str().unwrap()))
        .unwrap();
    let context = facts.financial_context().unwrap();
    let before = context.lock().unwrap().reuse_diagnostics();
    let boot = call(&registry, &bootstrap);
    common::assert_json_eq(
        &boot,
        &json!({"state":"VALUE","value":{"state":"READY","seed":original["expected"]["seed"]}}),
        "native original seed",
    );
    let presentations = value_pool::decode(include_str!(
        "../../reference/annual-editor-presentation-golden.json"
    ));
    let presentation = presentations["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == format!("payroll-{}", case["id"].as_str().unwrap()))
        .unwrap();
    let editor = request(&identity, json!({"kind":"ANNUAL_EDITOR","month":month}), 1);
    common::assert_json_eq(
        &call(&registry, &editor),
        &json!({"state":"VALUE","value":{"state":"READY","seed":original["expected"]["seed"],"presentation":presentation["expected"]}}),
        "one source-owned editor reply combines original seed and original UI facts",
    );
    let save = request(
        &identity,
        json!({"kind":"ANNUAL_SAVE","month":month,"form":original["expected"]["seed"]["form"]}),
        2,
    );
    let actual = call(&registry, &save);
    let expected = &original["expected"]["result"];
    match expected["kind"].as_str().unwrap() {
        "WRITE" => common::assert_json_eq(
            &actual,
            &json!({"state":"VALUE","value":{"state":"DRAFT","settings":expected["settings"]}}),
            "saved unconfirmed draft",
        ),
        "NO_CHANGE" => assert_eq!(
            actual,
            json!({"state":"VALUE","value":{"state":"NO_CHANGE"}})
        ),
        "ERROR" => assert_eq!(actual["message"], expected["message"]),
        _ => panic!("source result"),
    }
    assert_eq!(
        before,
        context.lock().unwrap().reuse_diagnostics(),
        "bootstrap/save never run gross/net/PAP again"
    );
    assert!(matches!(
        registry.lease_utility(
            &registry.utility_owner_marker().unwrap(),
            bootstrap.guard(),
            UtilityKind::PayrollForm
        ),
        Err(UtilityFenceError::StaleDraft)
    ));
    let current = request(
        &identity,
        json!({"kind":"ANNUAL_BOOTSTRAP","month":month}),
        3,
    );
    let completion = runtime::utility::prepare(
        &registry,
        &registry.utility_owner_marker().unwrap(),
        &current,
    )
    .unwrap();
    let mut replacement = salary_snapshot::raw(case);
    replacement["identity"] =
        salary_snapshot::snapshot::raw_snapshot(2, identity.owner_scope(), identity.owner_epoch())
            ["identity"]
            .clone();
    let replacement = salary_snapshot::facts(replacement);
    let new_identity = replacement.snapshot().identity().clone();
    registry.register(replacement.snapshot().clone()).unwrap();
    assert!(
        completion.serialize_current().is_err(),
        "a new snapshot cannot publish an old seed"
    );
    let fresh = request(
        &new_identity,
        json!({"kind":"ANNUAL_BOOTSTRAP","month":month}),
        4,
    );
    assert_eq!(
        call(&registry, &fresh),
        json!({"state":"VALUE","value":{"state":"NEEDS_FINANCE"}})
    );
    let completion =
        runtime::utility::prepare(&registry, &registry.utility_owner_marker().unwrap(), &fresh)
            .unwrap();
    registry
        .reset_for_owner(&OwnerIdentity::new("new-payroll-owner", 2).unwrap())
        .unwrap();
    assert!(
        completion.serialize_current().is_err(),
        "owner reset fences retained native seed before publication"
    );
}

#[test]
fn payroll_intent_requires_original_snapshot_and_rejects_ready_or_money_injections() {
    let fixture = fixture();
    let (_, identity) = setup(&fixture["cases"][0]);
    let valid = envelope(
        &identity,
        json!({"kind":"ANNUAL_BOOTSTRAP","month":"2026-11"}),
        1,
    );
    assert!(parse_utility_request(&serde_json::to_vec(&valid).unwrap()).is_ok());
    let mut owner_only = valid.clone();
    owner_only["guard"]
        .as_object_mut()
        .unwrap()
        .remove("snapshot");
    assert!(parse_utility_request(&serde_json::to_vec(&owner_only).unwrap()).is_err());
    for command in [
        json!({"kind":"ANNUAL_BOOTSTRAP","month":"2026-11","ready":true}),
        json!({"kind":"ANNUAL_SAVE","month":"2026-11","form":{},"seed":{"grossCents":100000}}),
        json!({"kind":"CALCULATE","pay":{"netCents":100000}}),
    ] {
        assert!(
            parse_utility_request(&serde_json::to_vec(&envelope(&identity, command, 1)).unwrap())
                .is_err()
        );
    }
}
