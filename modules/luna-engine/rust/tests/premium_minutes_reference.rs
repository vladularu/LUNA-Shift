use luna_engine::{
    EngineError,
    pay::premium_minutes::{self, PremiumError, PremiumMinuteInterval, PremiumRules},
    rules::RuleResolver,
};
use serde_json::{Value, json};

fn run(case: &Value, packages: &Value, resolver: &RuleResolver) -> Result<Value, PremiumError> {
    let input = &case["input"];
    if case["operation"] == "pay.rejectedTimeZone" {
        let result = premium_minutes::span_from_shift(&input["shift"], &input["profile"]);
        assert!(
            matches!(
                result,
                Err(PremiumError::Calculation(EngineError::InvalidTimeZone))
            ),
            "zone rejection must retain its cause"
        );
        return Ok(json!({"accepted":false}));
    }
    let rules = input["packageRef"]
        .as_str()
        .map(|key| PremiumRules::from_json(&packages[key]["rules"]))
        .transpose()?;
    if case["operation"] == "pay.premiumMinuteTrace" {
        premium_minutes::premium_minute_trace(
            &input["shift"],
            &input["profile"],
            rules.as_ref(),
            resolver,
        )?
        .to_json()
    } else {
        let span = premium_minutes::span_from_shift(&input["shift"], &input["profile"])?;
        let interval: Option<PremiumMinuteInterval> = input
            .get("interval")
            .map(|value| {
                serde_json::from_value(value.clone()).map_err(|_| PremiumError::InvalidInterval)
            })
            .transpose()?;
        let mut interval =
            interval.unwrap_or_else(|| PremiumMinuteInterval::new(0, span.gross_minutes));
        let ordered_only = case["operation"] == "pay.premiumRuleOrder";
        if !ordered_only {
            interval = interval.with_capture();
        }
        let result = premium_minutes::count_premium_minutes(
            &input["shift"],
            &input["profile"],
            &span,
            rules.as_ref().ok_or(PremiumError::InvalidInput)?,
            resolver,
            Some(&interval),
        )?;
        if ordered_only {
            assert!(
                result.counted.is_empty(),
                "First-hit rule ordering must not require minute capture"
            );
            Ok(json!(result.rule_order))
        } else {
            result.to_json()
        }
    }
}

#[test]
fn all_raw_premium_classification_and_trace_fixtures_match() {
    let fixtures: Value =
        serde_json::from_str(include_str!("../../reference/premium-minutes-golden.json"))
            .expect("frozen premium reference");
    assert_eq!(
        fixtures["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let resolver = RuleResolver::bundled().expect("bundled rules");
    let cases = fixtures["cases"].as_array().expect("cases");
    assert_eq!(cases.len(), 92, "coverage must not silently shrink");
    for case in cases {
        let actual = match run(case, &fixtures["packages"], &resolver) {
            Ok(value) => value,
            Err(error) => json!({"$error":{"name":"Error","message":error.to_string()}}),
        };
        assert_eq!(actual, case["expected"], "{}", case["id"]);
    }
}

#[test]
fn ordinary_classification_skips_optional_minute_trace_allocations() {
    let fixtures: Value =
        serde_json::from_str(include_str!("../../reference/premium-minutes-golden.json"))
            .expect("reference");
    let case = fixtures["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["id"] == "classify-sunday")
        .unwrap();
    let input = &case["input"];
    let package = &fixtures["packages"][input["packageRef"].as_str().unwrap()];
    let rules = PremiumRules::from_json(&package["rules"]).unwrap();
    let resolver = RuleResolver::bundled().unwrap();
    let span = premium_minutes::span_from_shift(&input["shift"], &input["profile"]).unwrap();
    let result = premium_minutes::count_premium_minutes(
        &input["shift"],
        &input["profile"],
        &span,
        &rules,
        &resolver,
        None,
    )
    .unwrap();
    assert_eq!(
        result.to_json().unwrap()["byRuleId"],
        case["expected"]["byRuleId"]
    );
    assert!(!result.by_rule_id.is_empty());
    assert!(
        result.counted.is_empty(),
        "Count-only calculations must not allocate the optional trace"
    );
}

#[test]
fn epoch_unit_conversion_cannot_truncate_historical_precision() {
    let aligned = premium_minutes::CountedMinute {
        rule_id: "night".into(),
        epoch_milliseconds: 120_000,
    };
    assert_eq!(aligned.checked_epoch_minute().unwrap(), 2);
    let historical = premium_minutes::CountedMinute {
        rule_id: "night".into(),
        epoch_milliseconds: -2_193_275_361_000,
    };
    assert!(matches!(
        historical.checked_epoch_minute(),
        Err(PremiumError::InvalidInput)
    ));
    assert_eq!(
        historical.epoch_milliseconds, -2_193_275_361_000,
        "Exact milliseconds remain available to the native trace builder"
    );
}
