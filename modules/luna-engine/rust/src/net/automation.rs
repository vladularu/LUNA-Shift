//! Payroll finalization consumes a Rust-created proof, never a wire calculation.
use super::annual_payment::{AnnualPaymentError, add_annual_salary_payment};
use super::{CalculationMode, NetPayResult, calculate_monthly_net_pay};
use serde_json::{Value, json};
use std::sync::Arc;

/// Constructed only by the Rust gross/SFN orchestration after checking source
/// shifts, premium traces and employment periods. Deliberately not Deserialize.
#[derive(Debug, Clone)]
pub struct AutomaticSalaryProof {
    pub(crate) profile: Arc<Value>,
    pub(crate) classification: Value,
    pub(crate) basic_hourly_pay_cents: i64,
    pub(crate) regular_gross_cents: i64,
    pub(crate) regular_shift_ids: Vec<String>,
    pub(crate) special_duty_shift_ids: Vec<String>,
}

impl AutomaticSalaryProof {
    pub fn regular_shift_ids(&self) -> &[String] {
        &self.regular_shift_ids
    }
    pub fn special_duty_shift_ids(&self) -> &[String] {
        &self.special_duty_shift_ids
    }
}

pub fn pension_max_own_rate(scheme: &str) -> Option<i64> {
    match scheme {
        "EZVK_DARMSTADT" => Some(330),
        "EZVK_KARLSRUHE" => Some(350),
        _ => None,
    }
}

fn finalize(
    month: &str,
    settings: &Value,
    proof: &AutomaticSalaryProof,
) -> Result<Value, AnnualPaymentError> {
    let automation = &settings["automation"];
    if automation.is_null() {
        return Err(AnnualPaymentError::Invalid(
            "Die Grundlagen der automatischen Netto-Prognose fehlen.",
        ));
    }
    let scheme = automation["pensionScheme"].as_str().unwrap_or("");
    let pension_omitted = ["UNKNOWN", "OTHER"].contains(&scheme)
        || (pension_max_own_rate(scheme).is_some()
            && automation["pensionEmployeeRateBps"].is_null());
    let bad_proof =
        || AnnualPaymentError::Invalid("Die Grundlagen der automatischen Netto-Prognose fehlen.");
    let mut pension_basis = proof.classification["amounts"]["taxableGrossCents"]
        .as_i64()
        .ok_or_else(bad_proof)?;
    if ["ZVK_DARMSTADT_I", "ZVK_DARMSTADT_II"].contains(&scheme) {
        for shift in proof.classification["shifts"]
            .as_array()
            .ok_or_else(bad_proof)?
        {
            for premium in shift["premiumBreakdown"].as_array().ok_or_else(bad_proof)? {
                if ["NIGHT", "SUNDAY", "HOLIDAY"]
                    .contains(&premium["category"].as_str().unwrap_or(""))
                {
                    pension_basis -= premium["taxablePremiumCents"]
                        .as_i64()
                        .ok_or_else(bad_proof)?;
                }
            }
        }
    }
    let payments = automation
        .get("annualPayments")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let remove_one_off = payments
        .as_array()
        .ok_or_else(bad_proof)?
        .iter()
        .any(|payment| {
            payment["payoutMonth"]
                .as_str()
                .is_some_and(|value| value.starts_with(month.get(..4).unwrap_or("")))
        });
    let special_cases = if remove_one_off {
        Value::Array(
            settings["specialCases"]
                .as_array()
                .ok_or_else(bad_proof)?
                .iter()
                .filter(|value| *value != "ONE_OFF_PAYMENT")
                .cloned()
                .collect(),
        )
    } else {
        settings["specialCases"].clone()
    };
    let mut profile = settings["profile"].as_object().cloned().unwrap_or_default();
    profile.insert(
        "worksInSaxony".into(),
        json!(proof.profile["federalState"] == "SN"),
    );
    let profile = Value::Object(profile);
    let mut pension = json!({"scheme":if pension_omitted {"NONE"} else {scheme},"contributionBasisCents":pension_basis,"regularContributionBasisCents":proof.regular_gross_cents});
    if !pension_omitted && !automation["pensionEmployeeRateBps"].is_null() {
        pension["employeeRateBps"] = automation["pensionEmployeeRateBps"].clone();
    }
    let employment = if super::js_truthy(&proof.profile["nursingTrainingTariff"])
        || super::js_truthy(&proof.profile["tvalPflegeTariff"])
    {
        "APPRENTICE"
    } else {
        "EMPLOYEE"
    };
    let net_input = json!({"month":month,"profile":profile,"amounts":proof.classification["amounts"],"specialCases":special_cases,"employmentKind":employment,"pension":pension,"additionalNetDeductionCents":automation["additionalNetDeductionCents"]});
    let result = calculate_monthly_net_pay(&net_input, CalculationMode::Forecast)?;
    let mut forecast = json!({"sourceMonth":settings["month"],"basicHourlyPayCents":proof.basic_hourly_pay_cents,"regularGrossCents":proof.regular_gross_cents,"pensionOmitted":pension_omitted});
    forecast["result"] = match result {
        NetPayResult::Available(pay) => {
            let tax_profile = super::NetPayProfile::parse(&profile).ok_or_else(bad_proof)?;
            let annual = add_annual_salary_payment(&pay, &tax_profile, &payments)?;
            if let Some(payment) = annual.annual_payment {
                forecast["annualPayment"] =
                    serde_json::to_value(payment).map_err(|_| bad_proof())?;
            }
            json!({"status":"available","classification":proof.classification,"pay":NetPayResult::Available(annual.pay)})
        }
        NetPayResult::InvalidInput { reason }
        | NetPayResult::MissingProfile { reason }
        | NetPayResult::Unsupported { reason } => {
            forecast["recovery"] = json!({"kind":"net-settings"});
            json!({"status":"unavailable","stage":"net-pay","reason":reason})
        }
    };
    Ok(forecast)
}

/// Same fallback/recovery semantics as the existing final payroll stage.
/// Full source-to-proof preparation is owned by gross/trace orchestration.
pub fn finalize_automatic_salary_net(
    month: &str,
    settings: &Value,
    proof: &AutomaticSalaryProof,
) -> Value {
    finalize(month, settings, proof).unwrap_or_else(|_| json!({"sourceMonth":settings["month"],"result":{"status":"unavailable","stage":"sfn","reason":"Tarif-, Arbeitszeit- oder Feiertagsdaten konnten nicht vollständig zugeordnet werden."}}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::net::sfn::classify_sfn_payroll_2026;
    use crate::rules::{PackageIds, RuleResolver};

    #[test]
    fn finalization_rebuilds_sfn_from_raw_facts_before_comparing_frozen_outputs() {
        let catalogs: Value = serde_json::from_str(include_str!("../../../reference/cases.json"))
            .expect("catalog facts");
        let catalog = catalogs["catalogs"]
            .as_array()
            .expect("catalogs")
            .iter()
            .find(|catalog| catalog["id"] == "bundled")
            .expect("bundled catalog");
        let resolver = RuleResolver::from_catalog_json(
            catalog["packages"].clone(),
            PackageIds {
                tariff: "tvoed-p-vka-legacy".into(),
                legal: "de-arbzg-care-legacy".into(),
                holiday: "de-holidays-legacy".into(),
            },
            None,
        )
        .expect("catalog");
        let reference: Value = serde_json::from_str(include_str!(
            "../../../reference/annual-payment-golden.json"
        ))
        .expect("annual raw facts");
        let mut count = 0;
        for case in reference["cases"].as_array().expect("cases") {
            if case["operation"] != "finalize" {
                continue;
            }
            let input = &case["input"];
            let classification =
                classify_sfn_payroll_2026(&input["payroll"], &resolver, CalculationMode::Forecast)
                    .expect("catalog coverage");
            assert_eq!(classification["status"], "available");
            let proof = AutomaticSalaryProof {
                profile: Arc::new(input["workProfile"].clone()),
                regular_shift_ids: classification["shifts"]
                    .as_array()
                    .expect("shift traces")
                    .iter()
                    .map(|shift| shift["shiftId"].as_str().expect("id").into())
                    .collect(),
                special_duty_shift_ids: vec![],
                classification,
                basic_hourly_pay_cents: input["payroll"]["basicHourlyPayCents"]
                    .as_i64()
                    .expect("hourly"),
                regular_gross_cents: input["payroll"]["regularMonthlySocialInsuranceGrossCents"]
                    .as_i64()
                    .expect("regular"),
            };
            let actual = finalize_automatic_salary_net(
                input["payroll"]["month"].as_str().expect("month"),
                &input["settings"],
                &proof,
            );
            assert_eq!(actual, case["expected"], "{}", case["id"]);
            count += 1;
        }
        assert_eq!(count, 88);
    }
}
