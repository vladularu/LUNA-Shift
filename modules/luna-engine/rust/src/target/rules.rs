use super::*;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::OnceLock;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum HolidayWork {
    TargetReduction,
    SeparateCompensation {
        #[serde(rename = "legalBasis")]
        legal_basis: String,
    },
}
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct TvUkLoss {
    pub actual: RuleSource,
    pub forecast: RuleSource,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TariffRules {
    pub label: String,
    pub forecast_qualifier: Option<String>,
    pub training_qualifier: Option<String>,
    pub holiday_work: HolidayWork,
    pub holiday: RuleSource,
    pub holiday_forecast: RuleSource,
    pub special: RuleSource,
    pub special_forecast: RuleSource,
    pub tv_uk_loss: Option<TvUkLoss>,
}
#[derive(Deserialize)]
struct Review {
    kind: TariffKind,
    version: String,
    from: String,
    to: String,
    rules: TariffRules,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Data {
    base: BTreeMap<String, RuleSource>,
    pub legacy_package_id: String,
    profile_notices: BTreeMap<String, String>,
    reviews: Vec<Review>,
}
fn data() -> &'static Result<Data, serde_json::Error> {
    static DATA: OnceLock<Result<Data, serde_json::Error>> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(include_str!("rules_data.json")))
}
pub(crate) fn reviewed(tariff: &TargetTariff, date: &str) -> Option<&'static TariffRules> {
    let data = data().as_ref().ok()?;
    data.reviews
        .iter()
        .find(|r| {
            r.kind == tariff.kind
                && Some(r.version.as_str()) == tariff.version.as_deref()
                && date >= r.from.as_str()
                && date <= r.to.as_str()
        })
        .map(|r| &r.rules)
}
pub(crate) fn known(kind: TariffKind) -> Result<&'static TariffRules, TargetError> {
    data()
        .as_ref()
        .map_err(|_| TargetError::InvalidInput)?
        .reviews
        .iter()
        .find(|r| r.kind == kind)
        .map(|r| &r.rules)
        .ok_or(TargetError::InvalidInput)
}
pub(crate) fn base(key: &str) -> Result<&'static RuleSource, TargetError> {
    data()
        .as_ref()
        .map_err(|_| TargetError::InvalidInput)?
        .base
        .get(key)
        .ok_or(TargetError::InvalidInput)
}
pub(crate) fn legacy_package_id() -> Result<&'static str, TargetError> {
    Ok(&data()
        .as_ref()
        .map_err(|_| TargetError::InvalidInput)?
        .legacy_package_id)
}
pub(crate) fn profile_notice(code: &str) -> Result<&'static str, TargetError> {
    data()
        .as_ref()
        .map_err(|_| TargetError::InvalidInput)?
        .profile_notices
        .get(code)
        .map(String::as_str)
        .ok_or(TargetError::InvalidInput)
}
