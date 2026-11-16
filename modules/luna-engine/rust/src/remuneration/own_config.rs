use super::{RemunerationError, required_nullable};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PartialMonth {
    Unconfirmed,
    CalendarDays,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum OwnRate {
    Percent {
        #[serde(rename = "basisPoints")]
        basis_points: i64,
    },
    Hourly {
        #[serde(rename = "centsPerHour")]
        cents_per_hour: i64,
    },
}
impl OwnRate {
    fn validate(&self) -> bool {
        match self {
            Self::Percent { basis_points } => (0..=100_000).contains(basis_points),
            Self::Hourly { cents_per_hour } => (0..=1_000_000).contains(cents_per_hour),
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum OwnBase {
    Monthly {
        #[serde(rename = "personalCents")]
        personal_cents: i64,
        #[serde(rename = "partialMonth")]
        partial_month: PartialMonth,
    },
    Hourly {
        #[serde(rename = "centsPerHour")]
        cents_per_hour: i64,
    },
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PremiumType {
    Night,
    Saturday,
    Sunday,
    Holiday,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TimeWindow {
    pub start_minute: i64,
    pub end_minute: i64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnTimePremium {
    pub id: String,
    #[serde(rename = "type")]
    pub premium_type: PremiumType,
    #[serde(deserialize_with = "required_nullable")]
    pub window: Option<TimeWindow>,
    pub rate: OwnRate,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FixedAllowance {
    pub id: String,
    pub title: String,
    pub monthly_cents: i64,
    pub partial_month: PartialMonth,
    pub valid_from: String,
    #[serde(deserialize_with = "required_nullable")]
    pub valid_to: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum SpecialAmount {
    Fixed {
        cents: i64,
    },
    Percent {
        #[serde(rename = "basisPoints")]
        basis_points: i64,
        #[serde(rename = "confirmedBasisCents", deserialize_with = "required_nullable")]
        confirmed_basis_cents: Option<i64>,
    },
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpecialPayment {
    pub id: String,
    pub title: String,
    pub payout_month: i64,
    #[serde(deserialize_with = "required_nullable")]
    pub entitlement_months: Option<i64>,
    pub amount: SpecialAmount,
    pub valid_from: String,
    #[serde(deserialize_with = "required_nullable")]
    pub valid_to: Option<String>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Combination {
    Add,
    Highest,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TimePremiums {
    pub combination: Combination,
    pub rules: Vec<OwnTimePremium>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Overtime {
    pub base_pay_included: bool,
    #[serde(deserialize_with = "required_nullable")]
    pub premium: Option<OwnRate>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Data {
    base: OwnBase,
    #[serde(deserialize_with = "required_nullable")]
    percentage_basis_hourly_cents: Option<i64>,
    #[serde(deserialize_with = "required_nullable")]
    time_premiums: Option<TimePremiums>,
    #[serde(deserialize_with = "required_nullable")]
    overtime: Option<Overtime>,
    fixed_allowances: Vec<FixedAllowance>,
    special_payments: Vec<SpecialPayment>,
}

/// Its private inner data can only be constructed through the complete semantic validator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct OwnConfiguration(Data);
impl<'de> Deserialize<'de> for OwnConfiguration {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let data =
            Data::deserialize(d).map_err(|_| serde::de::Error::custom(RemunerationError::Own))?;
        validate_data(&data).map_err(serde::de::Error::custom)?;
        Ok(Self(data))
    }
}
impl OwnConfiguration {
    pub fn base(&self) -> &OwnBase {
        &self.0.base
    }
    pub fn percentage_basis_hourly_cents(&self) -> Option<i64> {
        self.0.percentage_basis_hourly_cents
    }
    pub fn time_premiums(&self) -> Option<&TimePremiums> {
        self.0.time_premiums.as_ref()
    }
    pub fn overtime(&self) -> Option<&Overtime> {
        self.0.overtime.as_ref()
    }
    pub fn fixed_allowances(&self) -> &[FixedAllowance] {
        &self.0.fixed_allowances
    }
    pub fn special_payments(&self) -> &[SpecialPayment] {
        &self.0.special_payments
    }
}
fn identifier(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id.bytes().next().is_some_and(|b| b.is_ascii_alphanumeric())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
}
pub(crate) fn javascript_space(c: char) -> bool {
    matches!(c,'\u{0009}'..='\u{000d}'|'\u{0020}'|'\u{00a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}')
}
fn title(title: &str) -> bool {
    !title.is_empty()
        && title.encode_utf16().count() <= 100
        && title.trim_matches(javascript_space) == title
        && !title.chars().any(|c| (c as u32) < 32 || c == '\u{007f}')
}
fn validity(from: &str, to: Option<&str>) -> bool {
    crate::employment::require_remuneration_date(from).is_ok()
        && to
            .is_none_or(|to| to >= from && crate::employment::require_remuneration_date(to).is_ok())
}
fn ids<'a>(values: impl Iterator<Item = &'a str>, length: usize) -> bool {
    length <= 32 && values.collect::<BTreeSet<_>>().len() == length
}
fn validate_data(data: &Data) -> Result<(), RemunerationError> {
    let base_valid = match &data.base {
        OwnBase::Monthly { personal_cents, .. } => (1..=10_000_000).contains(personal_cents),
        OwnBase::Hourly { cents_per_hour } => {
            (1..=1_000_000).contains(cents_per_hour) && data.percentage_basis_hourly_cents.is_none()
        }
    };
    if !base_valid
        || data
            .percentage_basis_hourly_cents
            .is_some_and(|n| !(1..=1_000_000).contains(&n))
    {
        return Err(RemunerationError::Own);
    }
    if let Some(premiums) = &data.time_premiums
        && (premiums.rules.is_empty()
            || !ids(
                premiums.rules.iter().map(|p| p.id.as_str()),
                premiums.rules.len(),
            )
            || premiums.rules.iter().any(|p| {
                !identifier(&p.id)
                    || !p.rate.validate()
                    || p.premium_type == PremiumType::Night && p.window.is_none()
                    || p.window.as_ref().is_some_and(|w| {
                        !(0..=1439).contains(&w.start_minute)
                            || !(0..=1439).contains(&w.end_minute)
                            || w.start_minute == w.end_minute
                    })
            }))
    {
        return Err(RemunerationError::Own);
    }
    if data
        .overtime
        .as_ref()
        .and_then(|o| o.premium.as_ref())
        .is_some_and(|r| !r.validate())
    {
        return Err(RemunerationError::Own);
    }
    if !ids(
        data.fixed_allowances.iter().map(|a| a.id.as_str()),
        data.fixed_allowances.len(),
    ) || data.fixed_allowances.iter().any(|a| {
        !identifier(&a.id)
            || !title(&a.title)
            || !(0..=10_000_000).contains(&a.monthly_cents)
            || !validity(&a.valid_from, a.valid_to.as_deref())
    }) {
        return Err(RemunerationError::Own);
    }
    if !ids(
        data.special_payments.iter().map(|p| p.id.as_str()),
        data.special_payments.len(),
    ) || data.special_payments.iter().any(|p| {
        !identifier(&p.id)
            || !title(&p.title)
            || !(1..=12).contains(&p.payout_month)
            || p.entitlement_months.is_some_and(|n| !(0..=12).contains(&n))
            || !validity(&p.valid_from, p.valid_to.as_deref())
            || match p.amount {
                SpecialAmount::Fixed { cents } => !(0..=100_000_000).contains(&cents),
                SpecialAmount::Percent {
                    basis_points,
                    confirmed_basis_cents,
                } => {
                    !(0..=100_000).contains(&basis_points)
                        || confirmed_basis_cents.is_some_and(|n| !(0..=100_000_000).contains(&n))
                }
            }
    }) {
        return Err(RemunerationError::Own);
    }
    Ok(())
}
pub fn validate_own_configuration(
    value: &serde_json::Value,
) -> Result<OwnConfiguration, RemunerationError> {
    use serde::Deserialize;
    OwnConfiguration::deserialize(value).map_err(|_| RemunerationError::Own)
}
