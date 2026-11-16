use super::{TariffAnnualError, model::*};
use crate::remuneration::Presence;
fn result(
    eligible: Option<bool>,
    takeover: bool,
    early_exit: bool,
    twelfths: Option<Twelfths>,
    missing: Vec<String>,
) -> AnnualEligibility {
    AnnualEligibility {
        eligible,
        takeover,
        early_exit,
        twelfths,
        missing,
    }
}
pub fn tariff_annual_eligibility(
    claim: &ValidatedClaim,
    rule: &AnnualCalculationRule,
) -> Result<AnnualEligibility, TariffAnnualError> {
    let c = claim.data();
    let e = &c.employment;
    let mut missing = vec![];
    let Some(start) = e.start.as_deref().filter(|_| e.confirmed) else {
        missing.push("employment".into());
        return Ok(result(None, false, false, None, missing));
    };
    let first = format!("{}-01-01", c.year);
    let last = format!("{}-12-31", c.year);
    let december = format!("{}-12-01", c.year);
    let end = e.end.as_deref();
    if start > last.as_str() || end.is_some_and(|end| end < first.as_str()) {
        return Ok(result(Some(false), false, false, None, missing));
    }
    let at_december = start <= december.as_str() && end.is_none_or(|end| end >= december.as_str());
    let mut early_exit = matches!(
        rule.eligibility_policy,
        EligibilityPolicy::BtKEarlyExit | EligibilityPolicy::CaritasEarlyExit
    ) && end.is_some_and(|end| end < december.as_str());
    if !at_december
        && rule.eligibility_policy == EligibilityPolicy::TvlLegacyAtz
        && end.is_some_and(|end| end < december.as_str())
    {
        match c.exceptions.tvl_legacy_retirement_exit {
            Presence::Value(legacy) => early_exit = legacy,
            _ => {
                missing.push("exceptions.tvlLegacyRetirementExit".into());
                return Ok(result(None, false, false, None, missing));
            }
        }
    }
    let mut takeover = false;
    if !at_december && !early_exit {
        if !matches!(
            rule.eligibility_policy,
            EligibilityPolicy::TrainingTakeover | EligibilityPolicy::TvalTrainingTakeover
        ) {
            return Ok(result(Some(false), false, false, None, missing));
        }
        let answers = [
            e.takeover.immediate,
            e.takeover.same_employer,
            e.takeover.employed_december1,
        ];
        if end.is_none_or(|end| end >= december.as_str()) || answers.contains(&Some(false)) {
            return Ok(result(Some(false), false, false, None, missing));
        }
        if answers.contains(&None) {
            missing.push("employment.takeover".into());
            return Ok(result(None, false, false, None, missing));
        }
        takeover = true;
    }
    let mut months = 0;
    for row in &c.entitlements {
        let date: jiff::civil::Date = format!("{}-{:02}-01", c.year, row.month)
            .parse()
            .map_err(|_| TariffAnnualError::Date)?;
        let from = date.to_string();
        let through = format!("{}-{:02}-{:02}", c.year, row.month, date.days_in_month());
        if takeover
            && rule.reduction_policy == CalculationPolicy::TvalPflege16
            && end.is_some_and(|end| end >= from.as_str() && end < through.as_str())
        {
            continue;
        }
        if through.as_str() < start || end.is_some_and(|end| from.as_str() > end) {
            if !matches!(
                row.reason,
                EntitlementReason::None | EntitlementReason::Unknown
            ) {
                missing.push(format!("entitlements.{}.periodConflict", row.month));
            }
            continue;
        }
        match row.reason {
            EntitlementReason::Unknown => missing.push(format!("entitlements.{}", row.month)),
            EntitlementReason::Pay | EntitlementReason::Maternity => months += 1,
            EntitlementReason::ParentalBirthYear => {
                if c.exceptions.birth_year.is_none()
                    || c.exceptions.pay_before_parental_leave.is_none()
                {
                    missing.push("exceptions.parentalLeave".into());
                } else if c.exceptions.birth_year == Some(c.year)
                    && c.exceptions.pay_before_parental_leave == Some(true)
                {
                    months += 1;
                }
            }
            EntitlementReason::SickPaySupplement | EntitlementReason::MilitaryReturn => {
                if row.reason == EntitlementReason::SickPaySupplement
                    && rule.reduction_policy == CalculationPolicy::TvalPflege16
                {
                    months += 1;
                } else if !matches!(
                    rule.reduction_policy,
                    CalculationPolicy::TvoedVka20
                        | CalculationPolicy::Tvl20
                        | CalculationPolicy::Caritas16
                ) {
                    missing.push(format!("entitlements.{}.unsupportedException", row.month));
                } else if row.reason == EntitlementReason::SickPaySupplement {
                    months += 1;
                } else if c.exceptions.military_return_before_december1.is_none() {
                    missing.push("exceptions.militaryReturn".into());
                } else if c.exceptions.military_return_before_december1 == Some(true) {
                    months += 1;
                }
            }
            EntitlementReason::None => {}
        }
    }
    let a = &c.allocation;
    if a.required.is_none() || takeover && a.required != Some(true) {
        missing.push("allocation".into());
    }
    let mut twelfths = Twelfths {
        numerator: months,
        denominator: 1,
    };
    if a.required == Some(true) {
        match (a.twelfths_numerator, a.twelfths_denominator) {
            (Some(n), Some(d)) if n <= months * d => {
                twelfths = Twelfths {
                    numerator: n,
                    denominator: d,
                }
            }
            (Some(_), Some(_)) => missing.push("allocation.exceedsEntitlement".into()),
            _ => missing.push("allocation.twelfths".into()),
        }
    } else if a.twelfths_numerator.is_some() || a.twelfths_denominator.is_some() {
        missing.push("allocation.conflict".into());
    }
    Ok(result(
        Some(true),
        takeover,
        early_exit,
        missing.is_empty().then_some(twelfths),
        missing,
    ))
}
