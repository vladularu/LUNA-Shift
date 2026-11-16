//! Native raw-source composition for incomplete Caritas candidates; never a complete salary.
mod entitlements;
mod month;
mod saved;
use super::{
    lookup::{rows, unavailable},
    overtime::source_ids,
    personal_allowances, personal_base, policy, work_facts, work_slices,
};
use crate::{
    employment::{EmploymentError, ResolutionStatus, resolve_remuneration_profile_ref},
    net::js_truthy,
    remuneration::{
        base::{BaseError, shift_days::remuneration_shift_days},
        context::model::NativePackageValidator,
    },
    rules::{RuleKind, RulePackage, RuleResolver, holidays::HolidayError},
};
pub use entitlements::derive_entitlements;
pub use month::calculate_month;
pub use saved::{
    CatalogMonthSources, from_catalog, from_catalog_sources, from_persisted, from_saved,
    from_stored,
};
use serde_json::{Value, json};
#[derive(Debug)]
pub enum FlowError {
    Base(BaseError),
    Employment(EmploymentError),
    Holiday(Box<HolidayError>),
}
impl From<BaseError> for FlowError {
    fn from(value: BaseError) -> Self {
        Self::Base(value)
    }
}
impl From<EmploymentError> for FlowError {
    fn from(value: EmploymentError) -> Self {
        Self::Employment(value)
    }
}
impl From<HolidayError> for FlowError {
    fn from(value: HolidayError) -> Self {
        Self::Holiday(Box::new(value))
    }
}
impl std::fmt::Display for FlowError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Base(e) => e.fmt(f),
            Self::Employment(e) => e.fmt(f),
            Self::Holiday(e) => e.fmt(f),
        }
    }
}
impl std::error::Error for FlowError {}
impl FlowError {
    pub fn name(&self) -> &str {
        match self {
            Self::Employment(_) => "RemunerationProfileError",
            _ => "Error",
        }
    }
}
fn bad(value: &Value) -> bool {
    value["kind"] == "unavailable"
}
fn stage(mut value: Value, stage: &str) -> Value {
    value["stage"] = json!(stage);
    value
}
fn component(mut value: Value, component: &str) -> Value {
    value["component"] = json!(component);
    value
}
fn bounds(month: &str) -> Option<(String, String)> {
    crate::input::calendar::require_local_month(&json!(month)).ok()?;
    let first = format!("{month}-01");
    let date = crate::calendar::parse_date(&first).ok()?;
    Some((first, format!("{month}-{:02}", date.days_in_month())))
}
fn parameters(input: &Value) -> Value {
    let mut out = serde_json::Map::new();
    for k in [
        "month",
        "variantId",
        "regionId",
        "groupId",
        "stepId",
        "weeklyMinutes",
        "fullMonthEmploymentConfirmed",
        "fullMonthlyBaseEntitlementConfirmed",
        "fixedAllowanceClaim",
        "careAllowanceClaim",
        "localAgreement",
    ] {
        if let Some(v) = input.get(k) {
            out.insert(k.to_owned(), v.clone());
        }
    }
    Value::Object(out)
}
fn whole_profile<'a>(
    month: &str,
    profiles: &'a [Value],
) -> Result<Result<&'a Value, &'static str>, FlowError> {
    let Some((first, last)) = bounds(month) else {
        return Ok(Err("INVALID_MONTH"));
    };
    let a = resolve_remuneration_profile_ref(profiles, &first)?;
    let b = resolve_remuneration_profile_ref(profiles, &last)?;
    let (Some(ap), Some(bp)) = (a.profile, b.profile) else {
        return Ok(Err("PROFILE_MISSING_OR_SPLIT"));
    };
    if a.status != ResolutionStatus::Dated
        || b.status != ResolutionStatus::Dated
        || !std::ptr::eq(ap, bp)
        || ap["data"]["selection"]["kind"] != "tariff"
    {
        Ok(Err("PROFILE_MISSING_OR_SPLIT"))
    } else {
        Ok(Ok(ap))
    }
}
