use super::tariff::TariffProfile;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleConditions {
    pub requires_shift_types: Vec<String>,
    pub excludes_shift_types: Vec<String>,
    pub pay_groups: Option<Vec<String>>,
    pub sectors: Option<Vec<String>>,
    pub tariff_regions: Option<Vec<String>>,
    pub federal_states: Option<Vec<String>>,
    pub holiday_premium_modes: Option<Vec<String>>,
    pub allowance_statuses: Option<Vec<String>>,
    pub month_days: Option<Vec<String>>,
}
pub struct ConditionShift<'a> {
    pub shift_type: &'a str,
    pub holiday_premium_mode: &'a str,
}
pub fn conditions_match(
    conditions: &RuleConditions,
    tariff: Option<&TariffProfile>,
    state: &str,
    date: &str,
    shift: Option<ConditionShift<'_>>,
    allowance: Option<&str>,
) -> bool {
    let kind = shift
        .as_ref()
        .map(|s| s.shift_type.to_lowercase().replace('_', "-"));
    (conditions.requires_shift_types.is_empty()
        || kind
            .as_ref()
            .is_some_and(|s| conditions.requires_shift_types.contains(s)))
        && kind
            .as_ref()
            .is_none_or(|s| !conditions.excludes_shift_types.contains(s))
        && conditions
            .pay_groups
            .as_ref()
            .is_none_or(|v| tariff.is_some_and(|t| v.contains(&t.pay_group.to_lowercase())))
        && conditions
            .sectors
            .as_ref()
            .is_none_or(|v| tariff.is_some_and(|t| v.contains(&t.sector)))
        && conditions
            .tariff_regions
            .as_ref()
            .is_none_or(|v| tariff.is_some_and(|t| v.contains(&t.tariff_region)))
        && conditions
            .federal_states
            .as_ref()
            .is_none_or(|v| v.iter().any(|s| s == state))
        && conditions.holiday_premium_modes.as_ref().is_none_or(|v| {
            shift
                .as_ref()
                .is_some_and(|s| v.iter().any(|m| m == s.holiday_premium_mode))
        })
        && conditions
            .allowance_statuses
            .as_ref()
            .is_none_or(|v| allowance.is_some_and(|a| a != "NONE" && v.iter().any(|s| s == a)))
        && conditions
            .month_days
            .as_ref()
            .is_none_or(|v| date.get(5..).is_some_and(|day| v.iter().any(|d| d == day)))
}
