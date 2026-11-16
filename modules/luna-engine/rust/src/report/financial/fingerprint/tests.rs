use super::*;
use crate::rules::{HistoricalCatalog, PackageIds, RuleResolverCatalog};
fn input() -> FinancialFingerprintInput {
    FinancialFingerprintInput {
        profile: Arc::new(
            json!({"tariff":null,"manualMonthlyGrossCents":400000,"weeklyMinutes":2340,"employmentTimeline":[]}),
        ),
        entries: Arc::new(vec![
            json!({"id":"may","kind":"SHIFT","deletedAt":null,"date":"2026-05-15","startTime":"07:00","endTime":"15:00"}),
        ]),
        tariff_decisions: Arc::new(vec![]),
        settings: WorkPatternSettings::default(),
        test_months: BTreeSet::new(),
    }
}
fn book(
    raw: FinancialFingerprintInput,
    space: &str,
    resolver: Arc<RuleResolver>,
) -> FinancialFingerprintBook {
    FinancialFingerprintBook::new(StableFinancialDataSpace::new(space).unwrap(), raw, resolver)
        .unwrap()
}
fn key(b: &FinancialFingerprintBook) -> FinancialFingerprint {
    b.legacy_month("2026-05", LegacyFinancialView::Salary)
        .unwrap()
}
fn raw_bundle() -> Value {
    serde_json::from_str(include_str!("../../../rules/bundled.json")).unwrap()
}
fn custom(v: &Value) -> RuleResolver {
    RuleResolver::from_catalog_json(
        v["catalog"].clone(),
        serde_json::from_value(v["packageIds"].clone()).unwrap(),
        None,
    )
    .unwrap()
    .with_collation_ranks(serde_json::from_value(v["collationRanks"].clone()).unwrap())
}
#[test]
fn financial_numbers_and_object_keys_are_canonical_but_array_order_is_not() {
    let hash = |s: &str| {
        canonical::value_digest(&serde_json::from_str(s).unwrap(), false)
            .unwrap()
            .0
    };
    assert_eq!(
        hash(r#"{"a":1,"b":[0,2]}"#),
        hash(r#"{"b":[-0.0,2e0],"a":1.0}"#)
    );
    assert_ne!(hash("[1,2]"), hash("[2,1]"));
    assert_ne!(hash("null"), hash("false"));
    assert_ne!(hash("1"), hash(r#""1""#));
}
#[test]
fn stable_data_space_and_engine_and_perspective_are_separate_content_domains() {
    for invalid in ["", "has spaces", "mail@example.com", "has\nline", "nicht-ä"] {
        assert!(StableFinancialDataSpace::new(invalid).is_err());
    }
    assert!(StableFinancialDataSpace::new(&"a".repeat(257)).is_err());
    let resolver = Arc::new(RuleResolver::bundled().unwrap());
    let first = book(input(), "luna:internal:offline:a", Arc::clone(&resolver));
    let second = book(input(), "luna:internal:offline:b", resolver);
    assert_ne!(key(&first), key(&second));
    assert_ne!(
        first
            .make_key("2026-05", LegacyFinancialView::Salary, "engine-a")
            .unwrap(),
        first
            .make_key("2026-05", LegacyFinancialView::Salary, "engine-b")
            .unwrap()
    );
    assert_ne!(
        key(&first),
        first
            .legacy_month("2026-05", LegacyFinancialView::Annual)
            .unwrap()
    );
    assert_ne!(
        key(&first),
        first
            .legacy_month("2026-05", LegacyFinancialView::Actual)
            .unwrap()
    );
    assert_eq!(format!("{:?}", first.space), "StableFinancialDataSpace(..)");
    assert_eq!(key(&first).to_string().len(), 64);
}
#[test]
fn target_contexts_are_never_money_dependencies_and_plan_handles_share_one_raw_owner() {
    let resolver = Arc::new(RuleResolver::bundled().unwrap());
    let raw = input();
    let plain = book(raw.clone(), "data", Arc::clone(&resolver));
    let mut large = raw;
    Arc::make_mut(&mut large.profile)["workingTimeTarget"] =
        json!({"facts":vec![json!({"id":"fact","minutes":480});50000]});
    let plan = Arc::new(FinancialFingerprintPlan::new(Arc::clone(&large.entries)).unwrap());
    let owner = Arc::downgrade(&large.entries);
    let cached = FinancialFingerprintBook::with_plan(
        StableFinancialDataSpace::new("data").unwrap(),
        large.clone(),
        Arc::clone(&resolver),
        Arc::clone(&plan),
    )
    .unwrap();
    assert_eq!(key(&plain), key(&cached));
    assert_eq!(
        plain.diagnostics()["profileValuesHashed"],
        cached.diagnostics()["profileValuesHashed"]
    );
    assert!(
        cached.diagnostics()["profileValuesHashed"]
            .as_u64()
            .unwrap()
            < 20
    );
    assert!(Arc::ptr_eq(cached.plan(), &plan));
    assert!(Arc::ptr_eq(cached.plan().entries(), &large.entries));
    let bad =
        Arc::new(FinancialFingerprintPlan::new(Arc::new(large.entries.as_ref().clone())).unwrap());
    assert!(
        FinancialFingerprintBook::with_plan(
            StableFinancialDataSpace::new("data").unwrap(),
            large,
            resolver,
            bad
        )
        .is_err()
    );
    for _ in 0..20 {
        assert_eq!(key(&cached), key(&plain));
    }
    assert_eq!(cached.diagnostics()["cachedPeriodKeys"], 1);
    drop(plan);
    assert!(owner.upgrade().is_some());
}
#[test]
fn resolver_body_defaults_collation_and_real_origin_invalidate_without_arc_identity() {
    let raw = raw_bundle();
    let first = Arc::new(custom(&raw));
    let equal = Arc::new(custom(&raw));
    assert_eq!(
        key(&book(input(), "data", first)),
        key(&book(input(), "data", equal))
    );
    let compiled = book(input(), "data", Arc::new(RuleResolver::bundled().unwrap()));
    let original = book(input(), "data", Arc::new(custom(&raw)));
    assert_ne!(key(&compiled), key(&original));
    let mut changed = raw.clone();
    changed["catalog"]["tariff"][0]["rules"]["payTables"][0]["entries"][0]["monthlyCents"] =
        json!(999999);
    assert_ne!(
        key(&original),
        key(&book(input(), "data", Arc::new(custom(&changed))))
    );
    let mut changed = raw.clone();
    changed["packageIds"]["tariff"] = json!("missing-default");
    assert_ne!(
        key(&original),
        key(&book(input(), "data", Arc::new(custom(&changed))))
    );
    let mut changed = raw;
    let ranks = changed["collationRanks"].as_object_mut().unwrap();
    ranks.insert("changed-rank".to_owned(), json!(99));
    assert_ne!(
        key(&original),
        key(&book(input(), "data", Arc::new(custom(&changed))))
    );
}
#[test]
fn effective_historical_cutoffs_are_part_of_the_resolver_digest() {
    let raw = raw_bundle();
    let mut current: RuleResolverCatalog = serde_json::from_value(raw["catalog"].clone()).unwrap();
    current.legal.clear();
    current.holiday.clear();
    current.tariff.truncate(1);
    current.tariff[0].valid_from = "2026-01-01".to_owned();
    let mut old = current.clone();
    old.tariff[0].package_id = "old-tariff".to_owned();
    old.tariff[0].valid_from = "2024-01-01".to_owned();
    old.tariff[0].valid_to = Some("2025-12-31".to_owned());
    let ids = PackageIds {
        tariff: current.tariff[0].package_id.clone(),
        legal: "legal".to_owned(),
        holiday: "holiday".to_owned(),
    };
    let build = |before: &str| {
        let history = HistoricalCatalog {
            catalog: old.clone(),
            package_ids: PackageIds {
                tariff: "old-tariff".to_owned(),
                ..ids.clone()
            },
            compatible_package_ids: ids.clone(),
            valid_before: PackageIds {
                tariff: before.to_owned(),
                legal: before.to_owned(),
                holiday: before.to_owned(),
            },
        };
        RuleResolver::new(current.clone(), ids.clone(), Some(history)).unwrap()
    };
    assert_ne!(
        key(&book(input(), "data", Arc::new(build("2025-07-01")))),
        key(&book(input(), "data", Arc::new(build("2025-08-01"))))
    );
}
