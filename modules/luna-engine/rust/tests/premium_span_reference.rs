use luna_engine::{
    pay::premium_minutes::{self, PremiumMinuteInterval, PremiumRules},
    rules::RuleResolver,
};
use serde_json::{Value, json};

#[test]
fn ieee_pause_centering_preserves_source_rounding_before_decimal_classification() {
    let fixtures: Value =
        serde_json::from_str(include_str!("../../reference/premium-span-golden.json")).unwrap();
    assert_eq!(
        fixtures["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let resolver = RuleResolver::bundled().unwrap();
    let cases = fixtures["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 10);
    for case in cases {
        let shift = &case["input"]["shift"];
        let profile = &case["input"]["profile"];
        let span = premium_minutes::span_from_shift(shift, profile).unwrap();
        let span_json = json!({"grossMinutes":span.gross_minutes,"breakStart":span.break_start.to_string().parse::<f64>().unwrap(),"breakEnd":span.break_end.to_string().parse::<f64>().unwrap()});
        for key in ["grossMinutes", "breakStart", "breakEnd"] {
            assert_eq!(
                span_json[key].as_f64(),
                case["expected"]["span"][key].as_f64(),
                "{} span {key}",
                case["id"]
            );
        }
        let package = resolver
            .resolve_tariff(shift["date"].as_str().unwrap(), None)
            .unwrap();
        let rules = PremiumRules::from_json(package.rules()).unwrap();
        let interval = PremiumMinuteInterval::new(0, span.gross_minutes).with_capture();
        let classified = premium_minutes::count_premium_minutes(
            shift,
            profile,
            &span,
            &rules,
            &resolver,
            Some(&interval),
        )
        .unwrap()
        .to_json()
        .unwrap();
        assert_eq!(
            classified, case["expected"]["classified"],
            "{} counts",
            case["id"]
        );
        let trace = premium_minutes::premium_minute_trace(shift, profile, Some(&rules), &resolver);
        if case["expected"]["trace"].get("$error").is_some() {
            assert_eq!(case["expected"]["trace"]["$error"]["name"], "RangeError");
            assert!(
                matches!(trace, Err(premium_minutes::PremiumError::InvalidInput)),
                "Fractional Temporal durations must remain safely rejected: {}",
                case["id"]
            );
        } else {
            assert_eq!(
                trace.unwrap().to_json().unwrap(),
                case["expected"]["trace"],
                "{} trace",
                case["id"]
            );
        }
    }
}
