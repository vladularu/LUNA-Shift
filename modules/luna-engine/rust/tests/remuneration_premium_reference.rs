use luna_engine::{
    EngineError,
    employment::EmploymentError,
    remuneration::{
        base::BaseError,
        context::model::ContextError,
        premiums::{
            PremiumError,
            calculation::{
                PremiumInput, calculate_dated_shift_time_premiums,
                calculate_monthly_time_remuneration,
            },
        },
    },
    rules::{PackageIds, RuleResolver},
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};
struct Fixture {
    value: Value,
    resolvers: BTreeMap<String, RuleResolver>,
}
fn resolver_key(key: &Value, mode: &Value) -> String {
    serde_json::to_string(&(key, mode)).unwrap()
}
fn fixture() -> &'static Fixture {
    static FIXTURE: OnceLock<Fixture> = OnceLock::new();
    FIXTURE.get_or_init(||{
        let value:Value=serde_json::from_str(include_str!("../../reference/remuneration-premium-golden.json")).unwrap();
        assert_eq!(value["sourceDigest"],"92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9");
        let catalog:Value=serde_json::from_str(value["catalogJson"].as_str().unwrap()).unwrap();
        let packages:BTreeMap<String,Value>=value["packageJson"].as_object().unwrap().iter().map(|(k,p)|(k.clone(),serde_json::from_str(p.as_str().unwrap()).unwrap())).collect();
        let mut resolvers=BTreeMap::new();
        for case in value["cases"].as_array().unwrap(){let key=resolver_key(&case["key"],&case["mode"]);if resolvers.contains_key(&key){continue;}
            let package=case["key"].as_str().map(|key|packages[key].clone());
            let tariff=package.as_ref().and_then(|p|p["packageId"].as_str()).unwrap_or("missing").to_owned();
            let ids=PackageIds{tariff,legal:catalog["packageIds"]["legal"].as_str().unwrap().into(),holiday:catalog["packageIds"]["holiday"].as_str().unwrap().into()};
            let holidays=if case["mode"]=="missing-holidays"{json!([])}else{catalog["holiday"].clone()};
            let resolver=RuleResolver::from_catalog_json(json!({"tariff":package.into_iter().collect::<Vec<_>>(),"legal":catalog["legal"],"holiday":holidays}),ids,None).unwrap();
            resolvers.insert(key,resolver);
        }
        Fixture{value,resolvers}
    })
}
fn evaluate(case: &Value) -> Result<Value, PremiumError> {
    let f = fixture();
    let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
    let facts = input
        .get("tvlShiftWork")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let data = PremiumInput {
        work_profile: Arc::new(input["workProfile"].clone()),
        history: input["history"].as_array().unwrap(),
        tvl_shift_work: facts,
    };
    let resolver = &f.resolvers[&resolver_key(&case["key"], &case["mode"])];
    if case["operation"] == "shift" {
        calculate_dated_shift_time_premiums(
            &input["shift"],
            &data,
            resolver,
            input.get("includedMonth").and_then(Value::as_str),
        )
        .map(|r| serde_json::to_value(r).unwrap())
    } else {
        calculate_monthly_time_remuneration(
            input["month"].as_str().unwrap(),
            input["shifts"].as_array().unwrap(),
            &data,
            resolver,
        )
        .map(|r| serde_json::to_value(r).unwrap())
    }
}
fn invalid_zone(error: &PremiumError) -> bool {
    matches!(
        error,
        PremiumError::Time(EngineError::InvalidTimeZone)
            | PremiumError::Base(BaseError::Engine(EngineError::InvalidTimeZone))
    )
}
fn error_name(error: &PremiumError) -> &'static str {
    match error {
        PremiumError::Employment(
            EmploymentError::AmbiguousHistory | EmploymentError::InvalidDate,
        )
        | PremiumError::Context(ContextError::Employment(_))
        | PremiumError::Base(BaseError::Context(ContextError::Employment(_))) => {
            "RemunerationProfileError"
        }
        PremiumError::Time(EngineError::InvalidTimeZone)
        | PremiumError::Base(BaseError::Engine(EngineError::InvalidTimeZone))
        | PremiumError::InvalidInstant => "RangeError",
        _ => "Error",
    }
}
#[test]
fn full_dated_shift_and_month_premiums_match_frozen_source_from_raw_inputs() {
    let f = fixture();
    let mut failures = vec![];
    let mut safe = 0;
    let mut checked = 0;
    for case in f.value["cases"].as_array().unwrap() {
        if case["rejectionPolicy"] == "SAFE_INVALID_TIME_ZONE" {
            let error = evaluate(case).unwrap_err();
            assert!(invalid_zone(&error), "{}: {error}", case["id"]);
            safe += 1;
            continue;
        }
        let actual = match evaluate(case) {
            Ok(value) => json!({"value":value}),
            Err(error) => json!({"error":{"name":error_name(&error),"message":error.to_string()}}),
        };
        checked += 1;
        if actual != case["expected"] {
            failures.push(format!(
                "{}\nactual {actual}\nexpected {}\ninput {}",
                case["id"], case["expected"], case["inputJson"]
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} mismatches ({checked} exact candidates,{safe} named safe rejections)\n{}",
        failures.len(),
        failures
            .iter()
            .take(12)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n\n")
    );
    eprintln!(
        "Dated premiums: {checked} exact source outputs/errors; {safe} safe malformed timezone rejections"
    );
}
