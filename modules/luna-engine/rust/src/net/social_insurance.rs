use super::NetPayProfile;
use crate::money::round_ratio;
use crate::tax::PapError;
use serde::Serialize;

pub const HEALTH_MONTHLY_LIMIT_CENTS: i64 = 581_250;
pub const PENSION_MONTHLY_LIMIT_CENTS: i64 = 845_000;
pub const TRANSITION_ZONE_UPPER_CENTS: i64 = 200_000;

#[derive(Debug, Clone, Copy)]
pub struct SocialInsuranceLimits {
    pub health_cents: i64,
    pub pension_cents: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialInsurance {
    pub health_basis_cents: i64,
    pub pension_basis_cents: i64,
    pub health_standard_cents: i64,
    pub health_additional_cents: i64,
    pub health_cents: i64,
    pub care_cents: i64,
    pub pension_cents: i64,
    pub unemployment_cents: i64,
    pub total_cents: i64,
}

pub fn care_discount_count(profile: &NetPayProfile) -> i64 {
    (profile.children_under25.min(5) - 1).max(0)
}

fn contribution(cents: i64, rate_bps: i64, shared: bool) -> Result<i64, PapError> {
    let product = cents
        .checked_mul(rate_bps)
        .ok_or(PapError::IntegerOverflow)?;
    round_ratio(product, if shared { 20_000 } else { 10_000 })
        .map_err(|_| PapError::IntegerOverflow)
}

/// Ordinary full-month GKV/RV/AV payroll; caps can be supplied for one-off payments.
pub fn calculate_social_insurance_2026(
    gross_cents: i64,
    profile: &NetPayProfile,
    childless_surcharge: bool,
    limits: Option<SocialInsuranceLimits>,
) -> Result<SocialInsurance, PapError> {
    if !(0..=10_000_000).contains(&gross_cents)
        || !(0..=10_000).contains(&profile.health_additional_rate_bps)
        || !(0..=20).contains(&profile.children_under25)
    {
        return Err(PapError::InvalidDecimal);
    }
    let limits = limits.unwrap_or(SocialInsuranceLimits {
        health_cents: HEALTH_MONTHLY_LIMIT_CENTS,
        pension_cents: PENSION_MONTHLY_LIMIT_CENTS,
    });
    if limits.health_cents < 0 || limits.pension_cents < 0 {
        return Err(PapError::InvalidDecimal);
    }
    let health_basis_cents = gross_cents.min(limits.health_cents);
    let pension_basis_cents = gross_cents.min(limits.pension_cents);
    // § 2 BVV: round the standard and additional GKV contributions separately.
    let health_standard_cents = contribution(health_basis_cents, 1_460, true)?;
    let health_additional_cents =
        contribution(health_basis_cents, profile.health_additional_rate_bps, true)?;
    let care_rate_bps = if profile.works_in_saxony { 230 } else { 180 }
        + if childless_surcharge { 60 } else { 0 }
        - care_discount_count(profile) * 25;
    let care_cents = contribution(health_basis_cents, care_rate_bps, false)?;
    let pension_cents = contribution(pension_basis_cents, 1_860, true)?;
    let unemployment_cents = contribution(pension_basis_cents, 260, true)?;
    let health_cents = health_standard_cents + health_additional_cents;
    Ok(SocialInsurance {
        health_basis_cents,
        pension_basis_cents,
        health_standard_cents,
        health_additional_cents,
        health_cents,
        care_cents,
        pension_cents,
        unemployment_cents,
        total_cents: health_cents + care_cents + pension_cents + unemployment_cents,
    })
}
