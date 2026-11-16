#[path = "support/salary_snapshot.rs"]
mod salary_snapshot;
#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    contract::{self, OwnerIdentity, SnapshotIdentity},
    runtime::{SnapshotRegistry, form_resource::FormResourcePool},
};
use serde_json::{Value, json};

fn stamp() -> Value {
    json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35})
}
fn case() -> Value {
    let data = value_pool::decode(include_str!("../../reference/payroll-page-golden.json"));
    data["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["id"] == "services-ready-2026-11-PAYOUT-false")
        .unwrap()
        .clone()
}
fn setup(case: &Value) -> (SnapshotRegistry, SnapshotIdentity) {
    setup_raw(salary_snapshot::raw(case))
}
fn setup_raw(raw: Value) -> (SnapshotRegistry, SnapshotIdentity) {
    let facts = salary_snapshot::facts(raw);
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
fn call(
    pool: &FormResourcePool,
    registry: &SnapshotRegistry,
    identity: &SnapshotIdentity,
    command: Value,
) -> Value {
    let header = json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":identity.owner_scope(),"ownerEpoch":identity.owner_epoch(),"requestId":"payroll-resource","draftRevision":0},"command":command});
    let prepared = pool
        .prepare(
            registry,
            &registry.utility_owner_marker().unwrap(),
            &serde_json::to_vec(&header).unwrap(),
            b"",
        )
        .expect("source-bound payroll command");
    serde_json::from_slice(&prepared.complete().unwrap()).unwrap()
}
#[test]
fn small_payroll_source_opens_from_actual_registered_facts_without_global_preparation() {
    let case = case();
    let (registry, identity) = setup(&case);
    let marker = registry.preparation_marker().unwrap();
    let pool = FormResourcePool::new();
    let opened = call(
        &pool,
        &registry,
        &identity,
        json!({"kind":"BEGIN_PAYROLL","stamp":stamp(),"observedEpochMilliseconds":1794488400000_i64,"locator":identity,"month":case["input"]["month"],"mode":"SETUP"}),
    );
    assert_eq!(opened["state"], "PAYROLL_READY");
    assert_eq!(opened["resourceRevision"], 0);
    assert!(opened["resourceId"].is_u64());
    assert!(opened["view"].is_object());
    assert!(marker.is_current().unwrap());
}

struct Driver {
    pool: FormResourcePool,
    registry: SnapshotRegistry,
    identity: SnapshotIdentity,
    request: u64,
    revision: u64,
    id: u64,
    last: Value,
}
impl Driver {
    fn new(case: &Value) -> Self {
        let (registry, identity) = setup(case);
        Self::from_parts(registry, identity)
    }
    fn from_parts(registry: SnapshotRegistry, identity: SnapshotIdentity) -> Self {
        Self {
            pool: FormResourcePool::new(),
            registry,
            identity,
            request: 0,
            revision: 0,
            id: 0,
            last: Value::Null,
        }
    }
    fn call(&mut self, mut command: Value, body: &[u8]) -> Value {
        if command.get("resourceId").is_some() {
            command["resourceId"] = json!(self.id);
        }
        if command.get("resourceRevision").is_some() {
            command["resourceRevision"] = json!(self.revision);
        }
        let header = json!({"wireSchemaVersion":1,"expectedEngineVersion":luna_engine::ENGINE_VERSION,"calculationContractVersion":contract::CONTRACT_VERSION,"guard":{"ownerScope":self.identity.owner_scope(),"ownerEpoch":self.identity.owner_epoch(),"requestId":format!("payroll-compound-{}",self.request),"draftRevision":self.revision},"command":command});
        let prepared = self
            .pool
            .prepare(
                &self.registry,
                &self.registry.utility_owner_marker().unwrap(),
                &serde_json::to_vec(&header).unwrap(),
                body,
            )
            .unwrap_or_else(|error| panic!("{command}: {error:?}"));
        let reply: Value = serde_json::from_slice(&prepared.complete().unwrap()).unwrap();
        if let Some(revision) = reply["resourceRevision"].as_u64() {
            self.revision = revision;
        }
        if let Some(id) = reply["resourceId"].as_u64() {
            self.id = id;
        }
        self.last = reply.clone();
        reply
    }
    fn open(&mut self, case: &Value, mode: &str) -> Value {
        self.request += 1;
        self.revision = 0;
        self.id = 0;
        self.call(json!({"kind":"BEGIN_PAYROLL","stamp":stamp(),"observedEpochMilliseconds":1794488400000_i64,"locator":self.identity,"month":case["input"]["month"],"mode":mode}),b"")
    }
    fn event(&mut self, event: Value) -> Value {
        self.call(json!({"kind":"PAYROLL_EVENT","resourceId":0,"resourceRevision":0,"observedEpochMilliseconds":1794488400000_i64,"event":event}),b"")
    }
}
fn facts(driver: &Driver) -> std::sync::Arc<luna_engine::runtime::facts::SnapshotFacts> {
    use luna_engine::contract::utility::{UtilityGuard, UtilityKind};
    let guard:UtilityGuard=serde_json::from_value(json!({"ownerScope":driver.identity.owner_scope(),"ownerEpoch":driver.identity.owner_epoch(),"requestId":"true-finance-producer","draftRevision":0,"snapshot":driver.identity})).unwrap();
    let lease = driver
        .registry
        .lease_utility(
            &driver.registry.utility_owner_marker().unwrap(),
            &guard,
            UtilityKind::PayrollForm,
        )
        .unwrap();
    std::sync::Arc::clone(lease.facts().unwrap())
}
fn raw_write(case: &Value) -> Value {
    let input = &case["input"];
    let rows=input["timeline"].as_array().unwrap().iter().map(|row|json!({"month":row["settings"]["month"],"settings_json":serde_json::to_string(&row["settings"]).unwrap(),"revision":row["revision"],"created_at":row["createdAt"],"updated_at":row["updatedAt"]})).collect::<Vec<_>>();
    json!({"netProfiles":rows,"salaryPreference":{"value":serde_json::to_string(&input["preferences"]).unwrap(),"updated_at":"older-unparsed-metadata"},"profileRows":[{"id":"singleton"}],"testMonths":[]})
}
#[test]
fn all_original_setup_submits_keep_source_validation_and_native_captured_settings_through_take() {
    use std::collections::BTreeMap;
    let pages = value_pool::decode(include_str!("../../reference/payroll-page-golden.json"));
    let submits = value_pool::decode(include_str!(
        "../../reference/payroll-source-submit-golden.json"
    ));
    let mut drivers = BTreeMap::new();
    let mut successes = 0;
    let mut failures = 0;
    let mut empty_timeline_months = 0;
    for submit in submits["cases"].as_array().unwrap() {
        let source_id = submit["sourceId"].as_str().unwrap();
        let source = pages["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["id"] == source_id)
            .unwrap();
        let driver = drivers
            .entry(source_id.to_string())
            .or_insert_with(|| Driver::new(source));
        let opened = driver.open(source, "SETUP");
        assert_eq!(opened["state"], "PAYROLL_READY", "{source_id}");
        let result = driver.event(json!({"kind":"SETUP_SUBMIT","input":submit["submit"]}));
        if submit["expected"]["ok"] == false {
            assert_eq!(result["state"], "PAYROLL_READY", "{}", submit["id"]);
            assert!(result.get("writeId").is_none());
            assert_eq!(
                result["feedback"]["error"]["name"], submit["expected"]["name"],
                "{}",
                submit["id"]
            );
            assert_eq!(
                result["feedback"]["error"]["message"], submit["expected"]["message"],
                "{}",
                submit["id"]
            );
            driver.call(json!({"kind":"CLOSE_RESOURCE","resourceId":0}), b"");
            failures += 1;
        } else {
            assert_eq!(
                result["state"], "WRITE_CONTEXT_REQUIRED",
                "{}",
                submit["id"]
            );
            let write = result["writeId"].as_u64().unwrap();
            let prepared=driver.call(json!({"kind":"WRITE_CONTEXT","resourceId":0,"resourceRevision":0,"writeId":write,"stamp":stamp(),"observedEpochMilliseconds":1794488400000_i64}),&serde_json::to_vec(&raw_write(source)).unwrap());
            assert_eq!(
                prepared["state"], "WRITE_PERMIT_READY",
                "{} {prepared}",
                submit["id"]
            );
            let taken = driver.call(
                json!({"kind":"TAKE_WRITE","resourceId":0,"resourceRevision":0,"writeId":write}),
                b"",
            );
            let plan: Value = serde_json::from_str(taken["planBody"].as_str().unwrap()).unwrap();
            let row = &plan["mutations"][0]["row"];
            let settings: Value =
                serde_json::from_str(row["settings_json"].as_str().unwrap()).unwrap();
            let mut expected = submit["expected"]["settings"].clone();
            if source["input"]["timeline"].as_array().unwrap().is_empty() {
                // The separate 548-case original repository oracle proves the
                // first stored continuous profile starts in January. The setup
                // submit oracle ends before this downstream repository policy.
                expected["month"] =
                    json!(format!("{}-01", &expected["month"].as_str().unwrap()[..4]));
                empty_timeline_months += 1;
            }
            assert_eq!(
                settings, expected,
                "{} captured original settings",
                submit["id"]
            );
            assert_eq!(row["month"], expected["month"]);
            let mut after = stamp();
            after["inputToken"] = json!("22222222222222222222222222222222");
            let ack=driver.call(json!({"kind":"ACK_WRITE","resourceId":0,"resourceRevision":0,"writeId":write,"stamp":after,"observedEpochMilliseconds":1794488400000_i64}),b"");
            assert_eq!(ack["state"], "CLOSED");
            assert_eq!(ack["effects"]["kind"], "SAVED");
            successes += 1;
        }
    }
    assert_eq!(drivers.len(), 293);
    assert_eq!((successes, failures), (546, 937));
    assert!(empty_timeline_months > 0);
}

#[test]
fn annual_needs_a_true_finance_seed_no_change_closes_and_ack_does_not_reprice() {
    use luna_engine::runtime::financial_report;
    let pages = value_pool::decode(include_str!("../../reference/payroll-page-golden.json"));
    let forms = value_pool::decode(include_str!("../../reference/payroll-form-golden.json"));
    for (id, form_id, expected_kind) in [
        (
            "combined-valid-2-0-2026-01-EARNED-false",
            "original-combined-valid-2-0-2026-01-EARNED-false",
            "NO_CHANGE",
        ),
        (
            "combined-valid-0-0-2026-11-EARNED-false",
            "move-0-false-false-2026-10",
            "WRITE",
        ),
    ] {
        let mut source = pages["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["id"] == id)
            .unwrap()
            .clone();
        let original = forms["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["id"] == form_id)
            .unwrap();
        if expected_kind == "WRITE" {
            // The pure original mutation fixture supplies the raw initial
            // configuration; the ordinary native Finance producer must create
            // the same seed before the resource accepts the raw draft.
            source["input"]["timeline"][0]["settings"] = original["input"]["settings"].clone();
        }
        assert_eq!(original["expected"]["result"]["kind"], expected_kind);
        let mut driver = Driver::new(&source);
        let cold = driver.open(&source, "ANNUAL");
        assert_eq!(cold["state"], "PAYROLL_NEEDS_FINANCE");
        assert!(cold.get("resourceId").is_none());
        let facts = facts(&driver);
        financial_report::payroll::calculate(&facts, source["input"]["month"].as_str().unwrap())
            .unwrap();
        let context = facts.financial_context().unwrap();
        let before = context.lock().unwrap().reuse_diagnostics();
        let opened = driver.open(&source, "ANNUAL");
        assert_eq!(opened["state"], "PAYROLL_READY");
        assert_eq!(opened["view"]["seed"], original["expected"]["seed"]);
        let draft = original["input"]
            .get("draft")
            .unwrap_or(&original["expected"]["seed"]["form"]);
        let submit = driver.event(json!({"kind":"ANNUAL_SUBMIT","form":draft}));
        if expected_kind == "NO_CHANGE" {
            assert_eq!(submit["state"], "CLOSED");
            assert_eq!(submit["effects"]["kind"], "NO_CHANGE");
            assert!(submit.get("writeId").is_none());
        } else {
            assert_eq!(submit["state"], "WRITE_CONTEXT_REQUIRED");
            let write = submit["writeId"].as_u64().unwrap();
            let prepared=driver.call(json!({"kind":"WRITE_CONTEXT","resourceId":0,"resourceRevision":0,"writeId":write,"stamp":stamp(),"observedEpochMilliseconds":1794488400000_i64}),&serde_json::to_vec(&raw_write(&source)).unwrap());
            assert_eq!(prepared["state"], "WRITE_PERMIT_READY");
            let taken = driver.call(
                json!({"kind":"TAKE_WRITE","resourceId":0,"resourceRevision":0,"writeId":write}),
                b"",
            );
            let plan: Value = serde_json::from_str(taken["planBody"].as_str().unwrap()).unwrap();
            let settings: Value = serde_json::from_str(
                plan["mutations"][0]["row"]["settings_json"]
                    .as_str()
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(settings, original["expected"]["result"]["settings"]);
            let mut after = stamp();
            after["inputToken"] = json!("22222222222222222222222222222222");
            let ack=driver.call(json!({"kind":"ACK_WRITE","resourceId":0,"resourceRevision":0,"writeId":write,"stamp":after,"observedEpochMilliseconds":1794488400000_i64}),b"");
            assert_eq!(ack["state"], "CLOSED");
            assert_eq!(ack["effects"]["kind"], "SAVED");
        }
        assert_eq!(
            before,
            context.lock().unwrap().reuse_diagnostics(),
            "source/event/write/ACK must not run a money pass"
        );
        let weak = std::sync::Arc::downgrade(&facts);
        drop(facts);
        let Driver { pool, registry, .. } = driver;
        drop(registry);
        assert!(
            weak.upgrade().is_none(),
            "the pool's small source must not retain snapshot facts"
        );
        drop(pool);
    }
}

#[test]
fn timing_uses_original_preferences_only_and_native_plan_bytes_match_original_repository() {
    let plans = value_pool::decode(include_str!(
        "../../reference/payroll-write-plan-golden.json"
    ));
    let source = case();
    let mut compared = 0;
    for case in
        plans["cases"].as_array().unwrap().iter().filter(|case| {
            case["input"]["kind"] == "TIMING" && case["expected"]["schemaVersion"] == 1
        })
    {
        let input = &case["input"];
        let mut raw = salary_snapshot::raw(&source);
        let preference = input["preference"].get("value").cloned();
        let data = match preference {
            Some(value) => json!({"kind":"VALUE","value":{"value":value}}),
            None => json!({"kind":"NULL"}),
        };
        salary_snapshot::set(
            &mut raw,
            contract::SourceKind::SalaryPaymentPreferences,
            json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":data}}),
        );
        let (registry, identity) = setup_raw(raw);
        let mut driver = Driver::from_parts(registry, identity);
        let mut opening = source.clone();
        opening["input"]["month"] = input["month"].clone();
        assert_eq!(
            driver.open(&opening, "TIMING")["state"],
            "PAYROLL_READY",
            "{}",
            case["id"]
        );
        let submitted = driver.event(json!({"kind":"TIMING_SUBMIT","choice":input["choice"]}));
        let write = submitted["writeId"].as_u64().unwrap();
        let body = json!({"netProfiles":input["rows"],"salaryPreference":input["preference"],"profileRows":[],"testMonths":[]});
        let prepared=driver.call(json!({"kind":"WRITE_CONTEXT","resourceId":0,"resourceRevision":0,"writeId":write,"stamp":stamp(),"observedEpochMilliseconds":input["epoch"]}),&serde_json::to_vec(&body).unwrap());
        assert_eq!(prepared["state"], "WRITE_PERMIT_READY", "{}", case["id"]);
        let taken = driver.call(
            json!({"kind":"TAKE_WRITE","resourceId":0,"resourceRevision":0,"writeId":write}),
            b"",
        );
        let actual: Value = serde_json::from_str(taken["planBody"].as_str().unwrap()).unwrap();
        assert_eq!(
            actual, case["expected"],
            "{} full original repository plan",
            case["id"]
        );
        compared += 1;
    }
    assert_eq!(compared, 120);
}

#[test]
fn unrelated_invalid_net_rows_do_not_block_an_original_preference_only_timing_write() {
    let source = case();
    let mut driver = Driver::new(&source);
    assert_eq!(driver.open(&source, "TIMING")["state"], "PAYROLL_READY");
    let submit = driver.event(json!({"kind":"TIMING_SUBMIT","choice":"1"}));
    let write = submit["writeId"].as_u64().unwrap();
    let mut body = raw_write(&source);
    body["netProfiles"][0]["settings_json"] =
        json!("not-json-and-not-read-by-original-timing-repository");
    let prepared=driver.call(json!({"kind":"WRITE_CONTEXT","resourceId":0,"resourceRevision":0,"writeId":write,"stamp":stamp(),"observedEpochMilliseconds":1794488400000_i64}),&serde_json::to_vec(&body).unwrap());
    assert_eq!(prepared["state"], "WRITE_PERMIT_READY");
    let taken = driver.call(
        json!({"kind":"TAKE_WRITE","resourceId":0,"resourceRevision":0,"writeId":write}),
        b"",
    );
    let plan: Value = serde_json::from_str(taken["planBody"].as_str().unwrap()).unwrap();
    assert_eq!(plan["mutations"].as_array().unwrap().len(), 1);
    assert_eq!(plan["mutations"][0]["key"], "salary_payment_v1");
}

#[test]
fn annual_reset_requires_native_proposal_and_reuses_complete_original_sql_plan() {
    let pages = value_pool::decode(include_str!("../../reference/payroll-page-golden.json"));
    let plans: Value = serde_json::from_str(include_str!(
        "../../reference/form-resource-reset-golden.json"
    ))
    .unwrap();
    let plan_case = plans["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["id"] == "reset-2026-native-visible-override")
        .unwrap();
    let mut source = pages["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["id"] == "combined-valid-2-0-2026-11-EARNED-false")
        .unwrap()
        .clone();
    source["input"]["month"] = json!("2026-11");
    let mut raw = salary_snapshot::raw(&source);
    salary_snapshot::set(
        &mut raw,
        contract::SourceKind::NetPaySettingsTimeline,
        json!({"state":"READY","revision":1,"coverage":{"kind":"ALL_HISTORY"},"payload":{"schemaVersion":1,"data":{"kind":"VALUE","value":plan_case["input"]["rows"]}}}),
    );
    let (registry, identity) = setup_raw(raw);
    let mut driver = Driver::from_parts(registry, identity);
    let facts = facts(&driver);
    luna_engine::runtime::financial_report::payroll::calculate(&facts, "2026-11").unwrap();
    let context = facts.financial_context().unwrap();
    let before = context.lock().unwrap().reuse_diagnostics();
    let opened = driver.open(&source, "ANNUAL");
    assert_eq!(opened["state"], "PAYROLL_READY");
    assert!(
        opened["view"]["presentation"]["resetGrossCents"].is_number(),
        "actual native automatic proposal is required: {opened}"
    );
    let submit = driver.event(json!({"kind":"ANNUAL_RESET","year":2026}));
    let write = submit["writeId"].as_u64().unwrap();
    let raw = json!({"netProfiles":plan_case["input"]["rows"],"salaryPreference":null,"profileRows":[{"id":"singleton"}],"testMonths":[]});
    assert_eq!(driver.call(json!({"kind":"WRITE_CONTEXT","resourceId":0,"resourceRevision":0,"writeId":write,"stamp":stamp(),"observedEpochMilliseconds":plan_case["input"]["epoch"]}),&serde_json::to_vec(&raw).unwrap())["state"],"WRITE_PERMIT_READY");
    let taken = driver.call(
        json!({"kind":"TAKE_WRITE","resourceId":0,"resourceRevision":0,"writeId":write}),
        b"",
    );
    let actual: Value = serde_json::from_str(taken["planBody"].as_str().unwrap()).unwrap();
    assert_eq!(
        actual, plan_case["expected"],
        "complete original repository reset plan"
    );
    let mut after = stamp();
    after["inputToken"] = json!("22222222222222222222222222222222");
    assert_eq!(driver.call(json!({"kind":"ACK_WRITE","resourceId":0,"resourceRevision":0,"writeId":write,"stamp":after,"observedEpochMilliseconds":1794657600123_i64}),b"")["state"],"CLOSED");
    assert_eq!(before, context.lock().unwrap().reuse_diagnostics());
}
