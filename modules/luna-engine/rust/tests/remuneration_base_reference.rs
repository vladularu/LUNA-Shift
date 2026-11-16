use luna_engine::{
    EngineError,
    remuneration::{
        base::{
            self, BaseError, absence,
            calculation::{self, BaseMonthInput},
            draft::{self, AnnexAInput, SueInput},
            hourly::OwnHourlyInput,
            shift_days,
        },
        context::model::{ContextError, FullNativePackageValidator},
    },
    rules::{PackageIds, RulePackage, RuleResolver},
};
use serde_json::{Value, json};
fn evaluate(case: &Value, packages: &Value) -> Result<Value, BaseError> {
    let input: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
    let key = case["key"].as_str();
    let package = key.map(|k| packages[k].clone());
    let id = package
        .as_ref()
        .and_then(|p| p["packageId"].as_str())
        .unwrap_or("missing")
        .to_owned();
    let resolver = RuleResolver::from_catalog_json(
        json!({"tariff":package.clone().into_iter().collect::<Vec<_>>(),"legal":[],"holiday":[]}),
        PackageIds {
            tariff: id,
            legal: "missing".into(),
            holiday: "missing".into(),
        },
        None,
    )
    .unwrap();
    match case["operation"].as_str().unwrap() {
        "base" => {
            let raw = input.get("hourlyInput");
            let hourly_input = raw.map(|v| OwnHourlyInput {
                shifts: v["shifts"].as_array().unwrap(),
                time_zone: v["timeZone"].as_str().unwrap(),
                paid_absences: v["paidAbsences"].as_array().unwrap(),
            });
            let annex = input
                .get("annexAConfirmation")
                .map(|c| serde_json::from_value(c.clone()).unwrap());
            let sue = input
                .get("sueConfirmation")
                .map(|c| serde_json::from_value(c.clone()).unwrap());
            calculation::calculate_monthly_base(
                &BaseMonthInput {
                    month: input["month"].as_str().unwrap(),
                    history: input["history"].as_array().unwrap(),
                    hourly_input,
                    annex_a_confirmation: annex.as_ref(),
                    sue_confirmation: sue.as_ref(),
                },
                &resolver,
                &FullNativePackageValidator,
            )
            .map(|r| serde_json::to_value(r).unwrap())
        }
        "annex" => {
            let pkg: RulePackage = serde_json::from_value(package.unwrap()).unwrap();
            let input: AnnexAInput = serde_json::from_value(input).unwrap();
            draft::calculate_annex_a_draft_base(&pkg, &input, &FullNativePackageValidator)
                .map(|r| serde_json::to_value(r).unwrap())
        }
        "sue" => {
            let pkg: RulePackage = serde_json::from_value(package.unwrap()).unwrap();
            let input: SueInput = serde_json::from_value(input).unwrap();
            draft::calculate_sue_draft_base(&pkg, &input, &FullNativePackageValidator)
                .map(|r| serde_json::to_value(r).unwrap())
        }
        "shiftDays" => shift_days::remuneration_shift_days(
            &input["shift"],
            input["timeZone"].as_str().unwrap(),
        )
        .map(|r| serde_json::to_value(r).unwrap()),
        "monthShifts" => shift_days::remuneration_month_shifts(
            input["month"].as_str().unwrap(),
            input["shifts"].as_array().unwrap(),
        )
        .map(|r| serde_json::to_value(r).unwrap()),
        "absence" => absence::validate_paid_absence(&input["value"])
            .map(|r| serde_json::to_value(r).unwrap()),
        "currentAbsence" => absence::validate_paid_absence(&input["value"]).map(|value| {
            json!(absence::is_current_paid_absence(
                &value,
                &input["shift"],
                input["timeZone"].as_str().unwrap()
            ))
        }),
        "money" => base::round_remuneration_cents(
            input["numerator"].as_f64().unwrap(),
            input["denominator"].as_f64().unwrap(),
        )
        .map(|r| json!(r)),
        other => panic!("unknown operation {other}"),
    }
}
#[test]
fn dated_base_time_and_paid_absence_match_frozen_source_with_full_native_validation() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../reference/remuneration-base-golden.json"
    ))
    .unwrap();
    let context: Value = serde_json::from_str(include_str!(
        "../../reference/remuneration-context-golden.json"
    ))
    .unwrap();
    assert_eq!(
        fixture["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    assert_eq!(fixture["packagesSha256"], context["packagesSha256"]);
    let (mut checked, mut waiting, mut safe_rejections) = (0, 0, 0);
    let mut failures = vec![];
    for case in fixture["cases"].as_array().unwrap() {
        if case["rejectionPolicy"] == "SAFE_INVALID_TIME_ZONE" {
            assert_eq!(
                evaluate(case, &context["packages"]).unwrap_err(),
                BaseError::Engine(EngineError::InvalidTimeZone),
                "{}",
                case["id"]
            );
            safe_rejections += 1;
            continue;
        }
        let actual = match evaluate(case, &context["packages"]) {
            Err(BaseError::Context(ContextError::RuleValidationUnavailable)) => {
                waiting += 1;
                continue;
            }
            Ok(value) => json!({"value":value}),
            Err(e) => {
                json!({"error":{"name":match e{BaseError::Context(ContextError::Employment(_))=>"RemunerationProfileError",BaseError::AbsenceInstant(_)=>"ValidationError",BaseError::Engine(EngineError::InvalidTimeZone)=>"RangeError",_=>"Error"},"message":e.to_string()}})
            }
        };
        checked += 1;
        if actual != case["expected"] {
            failures.push(format!(
                "{}\nactual {}\nexpected {}",
                case["id"], actual, case["expected"]
            ));
        }
    }
    assert!(
        checked > 100 && waiting == 0,
        "Full native validation must leave no base cases waiting: {waiting}"
    );
    assert!(
        failures.is_empty(),
        "{} mismatches ({checked} compared, {waiting} explicitly waiting)\n{}",
        failures.len(),
        failures
            .iter()
            .take(16)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n\n")
    );
    eprintln!(
        "Dated base: {checked} exact cases; {waiting} validation waits; {safe_rejections} named non-PII invalid-input rejections"
    );
}
