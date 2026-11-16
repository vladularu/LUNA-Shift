//! Family semantic helpers run after full package schema validation.
//! Empty helper diagnostics alone never grant package validity.
pub mod annex;
pub mod avrdd;
pub mod caritas;
pub mod caritas_annual;
pub mod drk;
pub mod tdl;
mod tdl_policy;
mod util;
use super::validation::{ValidationError, ValidationIssue};
use serde_json::Value;

/// All thirteen source-ordered family helpers. The caller must run the full
/// package schema first and must also apply common/generic/table checks. An
/// empty family issue list is not a complete validation result.
pub fn family_tariff_issues(value: &Value) -> Result<Vec<ValidationIssue>, ValidationError> {
    use crate::remuneration::context::{RawTariffValidationPackage, annual, selection, training};
    let package = RawTariffValidationPackage::new(value)?;
    let mut issues = selection::tariff_selection_issues(&package);
    issues.extend(training::training_pay_issues(&package));
    issues.extend(annual::annual_payment_rule_issues(&package));
    issues.extend(tdl::tvl_kr_issues(value));
    issues.extend(tdl::tval_training_issues(value));
    issues.extend(caritas::caritas_table_issues(value));
    issues.extend(caritas::caritas_care_issues(value));
    issues.extend(avrdd::avrdd_issues(value));
    issues.extend(annex::tvoed_annex_a_issues(value));
    issues.extend(annex::tvoed_sue_issues(value));
    issues.extend(caritas_annual::caritas_annual_payment_issues(value));
    issues.extend(drk::drk_table_issues(value));
    issues.extend(drk::drk_training_table_issues(value));
    Ok(issues)
}
