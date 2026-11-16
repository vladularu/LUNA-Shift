use super::{BaseError, round_remuneration_cents};
use crate::{
    remuneration::context::{model::NativePackageValidator, selection::resolve_tariff_selection},
    rules::RulePackage,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DraftFailure {
    InvalidPackage,
    InvalidDate,
    InvalidMonth,
    OutsideValidity,
    TariffApplicabilityUnconfirmed,
    SueClassificationUnconfirmed,
    MonthEntitlementUnconfirmed,
    FullTimeReferenceUnconfirmed,
    StandardFullTimeUnconfirmed,
    InvalidWeeklyTime,
    UnknownSelection,
    MissingTableValue,
    AmountOverflow,
}
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum DraftBase<'a> {
    Unavailable { reason: DraftFailure },
    DraftTableBase(Box<DraftTableBase<'a>>),
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftTableBase<'a> {
    pub complete_gross: bool,
    pub full_time_table_cents: i64,
    pub personal_table_base_cents: i64,
    #[serde(serialize_with = "super::scalar")]
    pub contracted_weekly_minutes: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comparable_full_time_weekly_minutes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub standard_full_time_weekly_minutes: Option<i64>,
    pub package_id: &'a str,
    pub version_id: &'a str,
    pub variant_id: String,
    pub group_id: String,
    pub step_id: String,
    pub source_ids: Vec<&'a str>,
    pub excluded_components: [&'static str; 5],
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnexAInput {
    pub date: String,
    pub variant_id: String,
    pub group_id: String,
    pub step_id: String,
    pub contracted_weekly_minutes: f64,
    pub comparable_full_time_weekly_minutes: f64,
    pub applicability_confirmed: bool,
    pub comparable_full_time_confirmed: bool,
    pub full_month_base_entitlement_confirmed: bool,
    pub full_month_same_contract_confirmed: bool,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SueInput {
    pub month: String,
    pub group_id: String,
    pub step_id: String,
    pub contracted_weekly_minutes: f64,
    pub tariff_applicability_confirmed: bool,
    pub sue_classification_confirmed: bool,
    pub standard_full_time_confirmed: bool,
    pub full_month_base_entitlement_confirmed: bool,
    pub full_month_same_contract_confirmed: bool,
}
fn unavailable<'a>(reason: DraftFailure) -> DraftBase<'a> {
    DraftBase::Unavailable { reason }
}
fn safe(n: f64) -> bool {
    n.is_finite() && n.fract() == 0.0 && n.abs() <= crate::money::MAX_SAFE_INTEGER as f64
}
fn rows<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v[key].as_array().map(Vec::as_slice).unwrap_or(&[])
}
struct ResultInput<'a> {
    pkg: &'a RulePackage,
    table: &'a Value,
    monthly: i64,
    weekly: f64,
    full: f64,
    variant: String,
    group: String,
    step: String,
    annex: bool,
}
fn result(input: ResultInput<'_>) -> Result<DraftBase<'_>, BaseError> {
    let ResultInput {
        pkg,
        table,
        monthly,
        weekly,
        full,
        variant,
        group,
        step,
        annex,
    } = input;
    let numerator = monthly as f64 * weekly;
    if !safe(numerator) {
        return Ok(unavailable(DraftFailure::AmountOverflow));
    }
    let personal = round_remuneration_cents(numerator, full)?;
    Ok(DraftBase::DraftTableBase(Box::new(DraftTableBase {
        complete_gross: false,
        full_time_table_cents: monthly,
        personal_table_base_cents: personal,
        contracted_weekly_minutes: weekly,
        comparable_full_time_weekly_minutes: annex.then_some(full as i64),
        standard_full_time_weekly_minutes: (!annex).then_some(2340),
        package_id: &pkg.package_id,
        version_id: &pkg.version_id,
        variant_id: variant,
        group_id: group,
        step_id: step,
        source_ids: rows(table, "sourceIds")
            .iter()
            .filter_map(Value::as_str)
            .collect(),
        excluded_components: [
            "TIME_PREMIUMS",
            "ALLOWANCES",
            "OVERTIME",
            "ANNUAL_PAYMENT",
            "OTHER_INDIVIDUAL_TERMS",
        ],
    })))
}
pub fn calculate_annex_a_draft_base<'a>(
    pkg: &'a RulePackage,
    input: &AnnexAInput,
    validator: &impl NativePackageValidator,
) -> Result<DraftBase<'a>, BaseError> {
    if pkg.engine_contract_version != 16
        || pkg.status() != Some("DRAFT")
        || !validator.validate(pkg)?
    {
        return Ok(unavailable(DraftFailure::InvalidPackage));
    }
    let date = &input.date;
    if date.len() != 10
        || date.as_bytes()[4] != b'-'
        || date.as_bytes()[7] != b'-'
        || date
            .bytes()
            .enumerate()
            .any(|(i, b)| i != 4 && i != 7 && !b.is_ascii_digit())
        || date.parse::<jiff::civil::Date>().is_err()
    {
        return Ok(unavailable(DraftFailure::InvalidDate));
    }
    if date < &pkg.valid_from || pkg.valid_to.as_ref().is_some_and(|to| date > to) {
        return Ok(unavailable(DraftFailure::OutsideValidity));
    }
    if !input.applicability_confirmed {
        return Ok(unavailable(DraftFailure::TariffApplicabilityUnconfirmed));
    }
    if !input.full_month_base_entitlement_confirmed || !input.full_month_same_contract_confirmed {
        return Ok(unavailable(DraftFailure::MonthEntitlementUnconfirmed));
    }
    if !input.comparable_full_time_confirmed {
        return Ok(unavailable(DraftFailure::FullTimeReferenceUnconfirmed));
    }
    let weekly = input.contracted_weekly_minutes;
    let full = input.comparable_full_time_weekly_minutes;
    if !safe(full)
        || !(1800.0..=2520.0).contains(&full)
        || !safe(weekly)
        || weekly < 1.0
        || weekly > full
    {
        return Ok(unavailable(DraftFailure::InvalidWeeklyTime));
    }
    let Some(selected) = resolve_tariff_selection(pkg, &input.variant_id, "VKA").filter(|s| {
        s.family_id == "tvoed-vka-annex-a"
            && s.engine_id == "tvoed-annex-a-v1"
            && s.capabilities
                .as_object()
                .is_some_and(|c| c.values().all(|v| v == "UNSUPPORTED"))
    }) else {
        return Ok(unavailable(DraftFailure::UnknownSelection));
    };
    let group = input.group_id.to_lowercase();
    let table = rows(pkg.rules(), "payTables")
        .iter()
        .find(|t| t["id"] == selected.region["payTableId"]);
    let entries: Vec<_> = table
        .into_iter()
        .flat_map(|t| rows(t, "entries"))
        .filter(|e| e["groupId"] == group && e["stepId"] == input.step_id)
        .collect();
    if entries.len() != 1 {
        return Ok(unavailable(DraftFailure::MissingTableValue));
    }
    let monthly = entries[0]["monthlyCents"]
        .as_i64()
        .ok_or(BaseError::InvalidCalculation)?;
    result(ResultInput {
        pkg,
        table: table.ok_or(BaseError::InvalidCalculation)?,
        monthly,
        weekly,
        full,
        variant: input.variant_id.clone(),
        group,
        step: input.step_id.clone(),
        annex: true,
    })
}
pub fn calculate_sue_draft_base<'a>(
    pkg: &'a RulePackage,
    input: &SueInput,
    validator: &impl NativePackageValidator,
) -> Result<DraftBase<'a>, BaseError> {
    if pkg.package_id != "tvoed-vka-sue-bt-b"
        || pkg.engine_contract_version != 18
        || pkg.status() != Some("DRAFT")
        || !validator.validate(pkg)?
    {
        return Ok(unavailable(DraftFailure::InvalidPackage));
    }
    let month = &input.month;
    if month.len() != 7
        || month.as_bytes()[4] != b'-'
        || month
            .bytes()
            .enumerate()
            .any(|(i, b)| i != 4 && !b.is_ascii_digit())
    {
        return Ok(unavailable(DraftFailure::InvalidMonth));
    }
    let Ok(first) = format!("{month}-01").parse::<jiff::civil::Date>() else {
        return Ok(unavailable(DraftFailure::InvalidMonth));
    };
    let last = first
        .with()
        .day(first.days_in_month())
        .build()
        .map_err(|_| BaseError::InvalidCalculation)?;
    if first.to_string() < pkg.valid_from
        || pkg
            .valid_to
            .as_ref()
            .is_some_and(|to| last.to_string() > *to)
    {
        return Ok(unavailable(DraftFailure::OutsideValidity));
    }
    if !input.tariff_applicability_confirmed {
        return Ok(unavailable(DraftFailure::TariffApplicabilityUnconfirmed));
    }
    if !input.sue_classification_confirmed {
        return Ok(unavailable(DraftFailure::SueClassificationUnconfirmed));
    }
    if !input.full_month_base_entitlement_confirmed || !input.full_month_same_contract_confirmed {
        return Ok(unavailable(DraftFailure::MonthEntitlementUnconfirmed));
    }
    if !input.standard_full_time_confirmed {
        return Ok(unavailable(DraftFailure::StandardFullTimeUnconfirmed));
    }
    let weekly = input.contracted_weekly_minutes;
    if !safe(weekly) || !(1.0..=2340.0).contains(&weekly) {
        return Ok(unavailable(DraftFailure::InvalidWeeklyTime));
    }
    let Some(selected) = resolve_tariff_selection(pkg, "BT_B", "VKA").filter(|s| {
        s.family_id == "tvoed-vka-sue"
            && s.engine_id == "tvoed-sue-bt-b-table-draft-v1"
            && s.employment_kind == "EMPLOYEE"
            && s.region["payTableId"] == "anlage-c"
            && s.capabilities
                .as_object()
                .is_some_and(|c| c.values().all(|v| v == "UNSUPPORTED"))
    }) else {
        return Ok(unavailable(DraftFailure::UnknownSelection));
    };
    let group = input.group_id.to_lowercase();
    let table = rows(pkg.rules(), "payTables")
        .iter()
        .find(|t| t["id"] == selected.region["payTableId"]);
    let entries: Vec<_> = table
        .into_iter()
        .flat_map(|t| rows(t, "entries"))
        .filter(|e| e["groupId"] == group && e["stepId"] == input.step_id)
        .collect();
    if entries.len() != 1 {
        return Ok(unavailable(DraftFailure::MissingTableValue));
    }
    let monthly = entries[0]["monthlyCents"]
        .as_i64()
        .ok_or(BaseError::InvalidCalculation)?;
    result(ResultInput {
        pkg,
        table: table.ok_or(BaseError::InvalidCalculation)?,
        monthly,
        weekly,
        full: 2340.0,
        variant: "BT_B".into(),
        group,
        step: input.step_id.clone(),
        annex: false,
    })
}
