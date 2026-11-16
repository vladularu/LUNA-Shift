use super::{TariffAnnualError, model::*};
use num_bigint::BigInt;
fn plain(month: &str) -> Result<jiff::civil::Date, TariffAnnualError> {
    format!("{month}-01")
        .parse()
        .map_err(|_| TariffAnnualError::Month)
}
fn month(date: jiff::civil::Date) -> String {
    format!("{:04}-{:02}", date.year(), date.month())
}
fn amount(row: Option<&BasisMonth>, fixed_only: bool, missing: &mut Vec<String>) -> Option<BigInt> {
    let Some(row) = row.filter(|row| row.components_confirmed) else {
        missing.push("basis.months.confirmation".into());
        return None;
    };
    let fields = if fixed_only {
        vec![row.base_cents, row.fixed_cents]
    } else {
        vec![
            row.base_cents,
            row.fixed_cents,
            row.variable_cents,
            row.scheduled_overtime_cents,
        ]
    };
    if fields.iter().any(Option::is_none) {
        missing.push(format!("basis.{}.components", row.month));
        return None;
    }
    Some(fields.into_iter().flatten().map(BigInt::from).sum())
}
fn single(
    c: &ClaimData,
    m: &str,
    method: BasisMethod,
    fixed_only: bool,
    full_pay: bool,
    missing: &mut Vec<String>,
) -> Result<Option<AnnualBasis>, TariffAnnualError> {
    let first = plain(m)?;
    let last = format!("{m}-{:02}", first.days_in_month());
    if c.employment
        .start
        .as_ref()
        .is_none_or(|start| first.to_string() < *start)
        || c.employment.end.as_ref().is_some_and(|end| last > *end)
    {
        missing.push("basis.fullEmploymentMonth".into());
        return Ok(None);
    }
    let row = c.basis.months.iter().find(|r| r.month == m);
    if full_pay && row.and_then(|r| r.paid_calendar_days) != Some(i64::from(first.days_in_month()))
    {
        missing.push("basis.lastFullPayMonth".into());
        return Ok(None);
    }
    Ok(amount(row, fixed_only, missing).map(|sum| AnnualBasis {
        numerator: sum,
        denominator: BigInt::from(1),
        method,
        months: vec![m.into()],
    }))
}
fn confirmed(
    cents: Option<i64>,
    method: BasisMethod,
    field: &str,
    missing: &mut Vec<String>,
) -> Option<AnnualBasis> {
    let Some(cents) = cents else {
        missing.push(field.into());
        return None;
    };
    Some(AnnualBasis {
        numerator: BigInt::from(cents),
        denominator: BigInt::from(1),
        method,
        months: vec![],
    })
}
pub fn tariff_annual_basis(
    claim: &ValidatedClaim,
    rule: &AnnualCalculationRule,
    eligibility: &AnnualEligibility,
) -> Result<BasisResult, TariffAnnualError> {
    let c = claim.data();
    let mut missing = vec![];
    if eligibility.takeover {
        return Ok(BasisResult {
            basis: confirmed(
                c.basis.takeover_monthly_cents,
                BasisMethod::TakeoverConfirmed,
                "basis.takeoverMonthlyCents",
                &mut missing,
            ),
            missing,
        });
    }
    if rule.basis_policy == CalculationPolicy::TvalPflege16 {
        let m = format!("{}-11", c.year);
        let row = c.basis.months.iter().find(|r| r.month == m);
        let Some(row) = row.filter(|r| r.components_confirmed && r.base_cents.is_some()) else {
            missing.push("basis.novemberTrainingPay".into());
            return Ok(BasisResult {
                basis: None,
                missing,
            });
        };
        if [
            row.fixed_cents,
            row.variable_cents,
            row.scheduled_overtime_cents,
        ]
        .iter()
        .any(|n| n.is_some_and(|n| n != 0))
        {
            missing.push("basis.novemberTrainingPay.excludedComponents".into());
            return Ok(BasisResult {
                basis: None,
                missing,
            });
        }
        return Ok(BasisResult {
            basis: Some(AnnualBasis {
                numerator: BigInt::from(row.base_cents.ok_or(TariffAnnualError::Claim)?),
                denominator: BigInt::from(1),
                method: BasisMethod::NovemberTrainingPay,
                months: vec![m],
            }),
            missing,
        });
    }
    let employee = matches!(
        rule.basis_policy,
        CalculationPolicy::TvoedVka20 | CalculationPolicy::Tvl20 | CalculationPolicy::Caritas16
    );
    if employee {
        match c.basis.parental_part_time {
            None => {
                missing.push("basis.parentalPartTime".into());
                return Ok(BasisResult {
                    basis: None,
                    missing,
                });
            }
            Some(true) => {
                if c.exceptions.birth_year.is_none() {
                    missing.push("exceptions.parentalLeave".into());
                    return Ok(BasisResult {
                        basis: None,
                        missing,
                    });
                }
                if c.exceptions.birth_year != Some(c.year) {
                    missing.push("basis.parentalPartTime.birthYearConflict".into());
                    return Ok(BasisResult {
                        basis: None,
                        missing,
                    });
                }
                return Ok(BasisResult {
                    basis: confirmed(
                        c.basis.adjusted_monthly_cents,
                        BasisMethod::ParentalAdjustment,
                        "basis.adjustedMonthlyCents",
                        &mut missing,
                    ),
                    missing,
                });
            }
            Some(false) => {}
        }
    }
    let legacy_exit =
        eligibility.early_exit && rule.early_exit_basis == EarlyExitBasis::LastThreeMonthsTvl;
    if eligibility.early_exit && !legacy_exit {
        let end = c
            .employment
            .end
            .as_ref()
            .ok_or(TariffAnnualError::Claim)?
            .parse::<jiff::civil::Date>()
            .map_err(|_| TariffAnnualError::Date)?;
        let mut ym = plain(&month(end))?;
        if end.day() != end.days_in_month() {
            ym = ym
                .checked_sub(jiff::Span::new().months(1))
                .map_err(|_| TariffAnnualError::Date)?;
        }
        return Ok(BasisResult {
            basis: single(
                c,
                &month(ym),
                if rule.basis_policy == CalculationPolicy::Caritas16 {
                    BasisMethod::CaritasLastMonth
                } else {
                    BasisMethod::BtKLastMonth
                },
                true,
                false,
                &mut missing,
            )?,
            missing,
        });
    }
    let start = c
        .employment
        .start
        .as_ref()
        .ok_or(TariffAnnualError::Claim)?
        .parse::<jiff::civil::Date>()
        .map_err(|_| TariffAnnualError::Date)?;
    let cutoff = plain(&format!("{}-{:02}", c.year, rule.late_entry_after_month))?;
    if !legacy_exit
        && start.to_string() > format!("{}-{:02}", month(cutoff), cutoff.days_in_month())
    {
        let mut ym = plain(&month(start))?;
        if start.day() != 1 {
            ym = ym
                .checked_add(jiff::Span::new().months(1))
                .map_err(|_| TariffAnnualError::Date)?;
        }
        return Ok(BasisResult {
            basis: single(
                c,
                &month(ym),
                BasisMethod::FirstFullMonth,
                false,
                false,
                &mut missing,
            )?,
            missing,
        });
    }
    let months = if legacy_exit {
        let end = c
            .employment
            .end
            .as_ref()
            .ok_or(TariffAnnualError::Claim)?
            .parse::<jiff::civil::Date>()
            .map_err(|_| TariffAnnualError::Date)?;
        let mut ym = plain(&month(end))?;
        if end.day() != end.days_in_month() {
            ym = ym
                .checked_sub(jiff::Span::new().months(1))
                .map_err(|_| TariffAnnualError::Date)?;
        }
        [2, 1, 0]
            .into_iter()
            .map(|offset| {
                ym.checked_sub(jiff::Span::new().months(offset))
                    .map(month)
                    .map_err(|_| TariffAnnualError::Date)
            })
            .collect::<Result<Vec<_>, _>>()?
    } else {
        rule.reference_months
            .iter()
            .map(|m| format!("{}-{m:02}", c.year))
            .collect::<Vec<_>>()
    };
    let mut sum = BigInt::from(0);
    let mut paid_days = 0;
    let mut total_days = 0;
    for m in &months {
        let first = plain(m)?;
        let last = first
            .with()
            .day(first.days_in_month())
            .build()
            .map_err(|_| TariffAnnualError::Date)?;
        total_days += i64::from(first.days_in_month());
        let row = c.basis.months.iter().find(|r| r.month == *m);
        if last < start
            || c.employment
                .end
                .as_ref()
                .is_some_and(|end| first.to_string() > *end)
        {
            if row.is_some_and(|r| {
                [
                    r.base_cents,
                    r.fixed_cents,
                    r.variable_cents,
                    r.scheduled_overtime_cents,
                    r.paid_calendar_days,
                ]
                .iter()
                .any(|n| n.is_some_and(|n| n != 0))
            }) {
                missing.push(format!("basis.{m}.periodConflict"));
            }
            continue;
        }
        if let Some(value) = amount(row, false, &mut missing) {
            sum += value;
        }
        if !employee {
            continue;
        }
        let Some(days) = row.and_then(|r| r.paid_calendar_days) else {
            missing.push(format!("basis.{m}.paidCalendarDays"));
            continue;
        };
        let overlap_start = first.max(start);
        let overlap_end = if let Some(end) = &c.employment.end {
            let end = end
                .parse::<jiff::civil::Date>()
                .map_err(|_| TariffAnnualError::Date)?;
            last.min(end)
        } else {
            last
        };
        if days
            > i64::from(
                overlap_start
                    .until(overlap_end)
                    .map_err(|_| TariffAnnualError::Date)?
                    .get_days()
                    + 1,
            )
        {
            missing.push(format!("basis.{m}.paidDaysConflict"));
        }
        paid_days += days;
    }
    if !missing.is_empty() {
        return Ok(BasisResult {
            basis: None,
            missing,
        });
    }
    if employee && paid_days < 30 {
        let fallback = c
            .basis
            .last_full_pay_month
            .as_ref()
            .filter(|fallback| months.get(2).is_some_and(|last| *fallback <= last));
        let Some(fallback) = fallback else {
            missing.push("basis.lastFullPayMonth".into());
            return Ok(BasisResult {
                basis: None,
                missing,
            });
        };
        return Ok(BasisResult {
            basis: single(
                c,
                fallback,
                BasisMethod::LastFullPayMonth,
                false,
                true,
                &mut missing,
            )?,
            missing,
        });
    }
    Ok(BasisResult {
        basis: Some(if employee && paid_days < total_days {
            AnnualBasis {
                numerator: sum * BigInt::from(3067),
                denominator: BigInt::from(paid_days) * BigInt::from(100),
                method: BasisMethod::PaidCalendarDays,
                months,
            }
        } else {
            AnnualBasis {
                numerator: sum,
                denominator: BigInt::from(3),
                method: BasisMethod::ReferenceAverage,
                months,
            }
        }),
        missing,
    })
}
