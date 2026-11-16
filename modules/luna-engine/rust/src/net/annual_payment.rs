//! Confirmed cash-month one-offs and prior-year arrears over Rust payroll results.
use super::social_insurance::{
    HEALTH_MONTHLY_LIMIT_CENTS, PENSION_MONTHLY_LIMIT_CENTS, SocialInsurance,
    SocialInsuranceLimits, calculate_social_insurance_2026,
};
use super::{
    AvailableNetPay, NetPayProfile, OneOffTaxInput, Tax, calculate_tax_2026, integer_in_range,
};
use crate::calendar::parse_date;
use crate::tax::PapError;
use jiff::ToSpan;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Debug)]
pub enum AnnualPaymentError {
    Invalid(&'static str),
    Pap(PapError),
}
impl From<PapError> for AnnualPaymentError {
    fn from(error: PapError) -> Self {
        Self::Pap(error)
    }
}
impl std::fmt::Display for AnnualPaymentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(message) => f.write_str(message),
            Self::Pap(error) => error.fmt(f),
        }
    }
}
impl std::error::Error for AnnualPaymentError {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AnnualPaymentBasis {
    ConstantPay,
    #[serde(rename_all = "camelCase")]
    Payroll {
        annual_taxable_gross_cents: i64,
        social_insurance_days: i64,
        health_assessed_cents: i64,
        pension_assessed_cents: i64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnualSalaryPayment {
    pub revision: i64,
    pub payout_month: String,
    pub gross_cents: i64,
    pub net_basis: Option<AnnualPaymentBasis>,
}

fn exact_keys(value: &Value, names: &[&str]) -> bool {
    value.as_object().is_some_and(|record| {
        record.len() == names.len() && names.iter().all(|name| record.contains_key(*name))
    })
}

pub fn validate_annual_salary_payments(
    value: &Value,
) -> Result<Vec<AnnualSalaryPayment>, AnnualPaymentError> {
    use AnnualPaymentError::Invalid;
    let values = value
        .as_array()
        .filter(|values| values.len() <= 120)
        .ok_or(Invalid("Die Sonderzahlungen sind ungültig."))?;
    let mut seen = BTreeSet::new();
    values
        .iter()
        .map(|item| {
            if !exact_keys(item, &["revision", "payoutMonth", "grossCents", "netBasis"]) {
                return Err(Invalid("Die Sonderzahlung ist ungültig."));
            }
            let revision = integer_in_range(&item["revision"], 1, 1_000_000_000)
                .ok_or(Invalid("Die Sonderzahlung ist ungültig."))?;
            let gross_cents = integer_in_range(&item["grossCents"], 0, 10_000_000)
                .ok_or(Invalid("Die Sonderzahlung ist ungültig."))?;
            let month = item["payoutMonth"]
                .as_str()
                .filter(|month| {
                    super::valid_month(month) && ("1900"..="4099").contains(&&month[..4])
                })
                .ok_or(Invalid("Ungültiger Auszahlungsmonat."))?;
            if !seen.insert(month) {
                return Err(Invalid(
                    "Sonderzahlungen eines Monats bitte als Gesamtbetrag erfassen.",
                ));
            }
            let basis = &item["netBasis"];
            let bad_basis = Invalid("Die Jahresgrundlagen der Sonderzahlung sind ungültig.");
            let net_basis = if basis.is_null() {
                None
            } else if basis["kind"] == "CONSTANT_PAY" && exact_keys(basis, &["kind"]) {
                Some(AnnualPaymentBasis::ConstantPay)
            } else if basis["kind"] == "PAYROLL"
                && exact_keys(
                    basis,
                    &[
                        "kind",
                        "annualTaxableGrossCents",
                        "socialInsuranceDays",
                        "healthAssessedCents",
                        "pensionAssessedCents",
                    ],
                )
            {
                let max_days = month[5..]
                    .parse::<i64>()
                    .map_err(|_| Invalid("Ungültiger Auszahlungsmonat."))?
                    * 30;
                Some(AnnualPaymentBasis::Payroll {
                    annual_taxable_gross_cents: integer_in_range(
                        &basis["annualTaxableGrossCents"],
                        0,
                        120_000_000,
                    )
                    .ok_or(Invalid(
                        "Die Jahresgrundlagen der Sonderzahlung sind ungültig.",
                    ))?,
                    social_insurance_days: integer_in_range(
                        &basis["socialInsuranceDays"],
                        1,
                        max_days,
                    )
                    .ok_or(Invalid(
                        "Die Jahresgrundlagen der Sonderzahlung sind ungültig.",
                    ))?,
                    health_assessed_cents: integer_in_range(
                        &basis["healthAssessedCents"],
                        0,
                        120_000_000,
                    )
                    .ok_or(Invalid(
                        "Die Jahresgrundlagen der Sonderzahlung sind ungültig.",
                    ))?,
                    pension_assessed_cents: integer_in_range(
                        &basis["pensionAssessedCents"],
                        0,
                        120_000_000,
                    )
                    .ok_or(Invalid(
                        "Die Jahresgrundlagen der Sonderzahlung sind ungültig.",
                    ))?,
                })
            } else {
                return Err(bad_basis);
            };
            Ok(AnnualSalaryPayment {
                revision,
                payout_month: month.into(),
                gross_cents,
                net_basis,
            })
        })
        .collect()
}

/// The original JSON view normalizes payment fields but spreads the validated
/// netBasis keys in their original order. Keep that order for SQL JSON.stringify
/// bytes while the typed tax calculation API above remains unchanged.
pub fn validate_annual_salary_payment_values(value: &Value) -> Result<Value, AnnualPaymentError> {
    let typed = validate_annual_salary_payments(value)?;
    let mut normalized = serde_json::to_value(typed)
        .map_err(|_| AnnualPaymentError::Invalid("Die Sonderzahlungen sind ungültig."))?;
    for (payment, original) in normalized
        .as_array_mut()
        .expect("validated payment array")
        .iter_mut()
        .zip(value.as_array().expect("validated payment array"))
    {
        if let Some(basis) = original["netBasis"].as_object() {
            let normalized_basis = &payment["netBasis"];
            let mut ordered = serde_json::Map::new();
            for key in basis.keys() {
                ordered.insert(key.clone(), normalized_basis[key].clone());
            }
            payment["netBasis"] = Value::Object(ordered);
        }
    }
    Ok(normalized)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnualPaymentForecast {
    pub gross_cents: i64,
    pub total_gross_cents: i64,
    pub net_included: bool,
    pub pension_omitted: bool,
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddedAnnualPayment {
    #[serde(serialize_with = "serialize_available")]
    pub pay: Box<AvailableNetPay>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annual_payment: Option<AnnualPaymentForecast>,
}

fn serialize_available<S: serde::Serializer>(
    pay: &AvailableNetPay,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    #[derive(Serialize)]
    struct Snapshot<'a> {
        status: &'static str,
        #[serde(flatten)]
        pay: &'a AvailableNetPay,
    }
    Snapshot {
        status: "available",
        pay,
    }
    .serialize(serializer)
}

fn amount(pay: &AvailableNetPay, name: &str) -> Result<i64, AnnualPaymentError> {
    pay.amounts
        .get(name)
        .copied()
        .ok_or(AnnualPaymentError::Invalid(
            "Die Jahressteuergrundlagen der Nachzahlung sind widersprüchlich.",
        ))
}

fn childless(profile: &NetPayProfile, month: &str) -> Result<bool, AnnualPaymentError> {
    let invalid = || AnnualPaymentError::Invalid("Das Geburtsdatum ist ungültig.");
    let birth = parse_date(&profile.birth_date).map_err(|_| invalid())?;
    let birthday = birth.checked_add(23.years()).map_err(|_| invalid())?;
    Ok(!profile.is_parent
        && birthday < parse_date(&format!("{month}-01")).map_err(|_| invalid())?)
}

pub fn add_annual_salary_payment(
    pay: &AvailableNetPay,
    profile: &NetPayProfile,
    raw_payments: &Value,
) -> Result<AddedAnnualPayment, AnnualPaymentError> {
    let payments = validate_annual_salary_payments(raw_payments)?;
    let Some(payment) = payments
        .iter()
        .find(|payment| payment.payout_month == pay.month && payment.gross_cents != 0)
    else {
        return Ok(AddedAnnualPayment {
            pay: Box::new(pay.clone()),
            annual_payment: None,
        });
    };
    let gross = amount(pay, "grossCents")?;
    let taxable = amount(pay, "taxableGrossCents")?;
    let social = amount(pay, "socialInsuranceGrossCents")?;
    let total_gross = gross + payment.gross_cents;
    let pension_omitted = pay.pension.as_ref().is_some_and(|p| p.scheme != "NONE");
    let excluded = |note: &str| AddedAnnualPayment {
        pay: Box::new(pay.clone()),
        annual_payment: Some(AnnualPaymentForecast {
            gross_cents: payment.gross_cents,
            total_gross_cents: total_gross,
            net_included: false,
            pension_omitted,
            note: note.into(),
        }),
    };
    let Some(basis) = &payment.net_basis else {
        return Ok(excluded(
            "Netto ohne Sonderzahlung · Jahresgrundlagen ergänzen.",
        ));
    };
    let month = pay
        .month
        .get(5..)
        .and_then(|month| month.parse::<i64>().ok())
        .ok_or(AnnualPaymentError::Invalid("Ungültiger Auszahlungsmonat."))?;
    let (days, mut annual_taxable, mut health_assessed, mut pension_assessed) = match basis {
        AnnualPaymentBasis::Payroll {
            annual_taxable_gross_cents,
            social_insurance_days,
            health_assessed_cents,
            pension_assessed_cents,
        } => (
            *social_insurance_days,
            *annual_taxable_gross_cents,
            *health_assessed_cents,
            *pension_assessed_cents,
        ),
        AnnualPaymentBasis::ConstantPay => (
            month * 30,
            taxable * 12,
            social.min(HEALTH_MONTHLY_LIMIT_CENTS) * month,
            social.min(PENSION_MONTHLY_LIMIT_CENTS) * month,
        ),
    };
    if matches!(basis, AnnualPaymentBasis::ConstantPay) {
        let mut earlier: Vec<_> = payments
            .iter()
            .filter(|prior| {
                prior.payout_month.starts_with(&pay.month[..4]) && prior.payout_month < pay.month
            })
            .collect();
        earlier.sort_by(|a, b| a.payout_month.cmp(&b.payout_month));
        for prior in earlier {
            let prior_month = prior.payout_month[5..]
                .parse::<i64>()
                .map_err(|_| AnnualPaymentError::Invalid("Ungültiger Auszahlungsmonat."))?;
            let regular_health = social.min(HEALTH_MONTHLY_LIMIT_CENTS);
            let regular_pension = social.min(PENSION_MONTHLY_LIMIT_CENTS);
            let used_health = health_assessed - regular_health * month;
            let used_pension = pension_assessed - regular_pension * month;
            health_assessed += prior.gross_cents.min(
                ((HEALTH_MONTHLY_LIMIT_CENTS - regular_health) * prior_month - used_health).max(0),
            );
            pension_assessed += prior.gross_cents.min(
                ((PENSION_MONTHLY_LIMIT_CENTS - regular_pension) * prior_month - used_pension)
                    .max(0),
            );
            annual_taxable += prior.gross_cents;
        }
    }
    let health_limit = HEALTH_MONTHLY_LIMIT_CENTS * days / 30;
    let pension_limit = PENSION_MONTHLY_LIMIT_CENTS * days / 30;
    if annual_taxable < taxable
        || health_assessed < pay.social_insurance.health_basis_cents
        || pension_assessed < pay.social_insurance.pension_basis_cents
    {
        return Ok(excluded(
            "Netto ohne Sonderzahlung · Die Jahreswerte müssen den laufenden Auszahlungsmonat einschließen.",
        ));
    }
    if health_assessed > health_limit || pension_assessed > pension_limit {
        return Ok(excluded(
            "Die bisherigen SV-Beitragsgrundlagen überschreiten die anteiligen Jahresgrenzen. Bitte prüfen.",
        ));
    }
    let limits = SocialInsuranceLimits {
        health_cents: health_limit - health_assessed,
        pension_cents: pension_limit - pension_assessed,
    };
    if month <= 3
        && (payment.gross_cents > limits.health_cents || payment.gross_cents > limits.pension_cents)
    {
        return Ok(excluded(
            "Netto ohne Sonderzahlung · Für die Märzklausel fehlen die Vorjahresdaten.",
        ));
    }
    let childless = childless(profile, &pay.month)?;
    let extra =
        calculate_social_insurance_2026(payment.gross_cents, profile, childless, Some(limits))?;
    let prior = &pay.social_insurance;
    let social_insurance = SocialInsurance {
        health_basis_cents: prior.health_basis_cents + extra.health_basis_cents,
        pension_basis_cents: prior.pension_basis_cents + extra.pension_basis_cents,
        health_standard_cents: prior.health_standard_cents + extra.health_standard_cents,
        health_additional_cents: prior.health_additional_cents + extra.health_additional_cents,
        health_cents: prior.health_cents + extra.health_cents,
        care_cents: prior.care_cents + extra.care_cents,
        pension_cents: prior.pension_cents + extra.pension_cents,
        unemployment_cents: prior.unemployment_cents + extra.unemployment_cents,
        total_cents: prior.total_cents + extra.total_cents,
    };
    let tax = calculate_tax_2026(
        taxable,
        profile,
        childless,
        Some(OneOffTaxInput {
            gross_cents: payment.gross_cents,
            annual_taxable_gross_cents: annual_taxable,
        }),
    )?;
    let net_cents = total_gross
        - tax.total_cents
        - social_insurance.total_cents
        - pay.pension.as_ref().map_or(0, |p| p.employee_cents)
        - pay.additional_net_deduction_cents.unwrap_or(0);
    if !(0..=crate::money::MAX_SAFE_INTEGER).contains(&net_cents) {
        return Ok(excluded(
            "Netto ohne Sonderzahlung · Die Jahresgrundlagen ergeben kein gültiges Ergebnis.",
        ));
    }
    let mut result = pay.clone();
    result.amounts.insert("grossCents".into(), total_gross);
    result
        .amounts
        .insert("taxableGrossCents".into(), taxable + payment.gross_cents);
    result.amounts.insert(
        "socialInsuranceGrossCents".into(),
        social + payment.gross_cents,
    );
    result.tax = tax;
    result.social_insurance = social_insurance;
    result.net_cents = net_cents;
    let mut note = if matches!(basis, AnnualPaymentBasis::ConstantPay) {
        "Sonderzahlung enthalten · Jahresprognose mit gleichbleibendem laufendem Entgelt und durchgehender SV-Pflicht seit Januar."
    } else { "Sonderzahlung enthalten · mit deinen Jahresgrundlagen." }.to_owned();
    if pension_omitted {
        note.push_str(" Zusatzversorgung und deren Steuer-/SV-Auswirkungen für die Sonderzahlung fehlen noch.");
    }
    Ok(AddedAnnualPayment {
        pay: Box::new(result),
        annual_payment: Some(AnnualPaymentForecast {
            gross_cents: payment.gross_cents,
            total_gross_cents: total_gross,
            net_included: true,
            pension_omitted,
            note,
        }),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossYearEstimate {
    pub assumed_payment: &'static str,
    pub annual_taxable_gross_cents: i64,
    pub annual_basis: &'static str,
}
#[derive(Debug, Clone, Serialize)]
pub struct CrossYearTax {
    pub tax: Tax,
    pub estimate: CrossYearEstimate,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ArrearsPayrollBasis<'a> {
    pub month: &'a str,
    pub rules_year: i16,
    pub taxable_gross_cents: i64,
}

pub fn estimate_cross_year_arrears_tax(
    base: &AvailableNetPay,
    regular: &AvailableNetPay,
    profile: &NetPayProfile,
    raw_payments: &Value,
    prior_year_taxable: i64,
    included_annual_gross: i64,
) -> Result<CrossYearTax, AnnualPaymentError> {
    if base.calculation_basis.rules_year != 2026 {
        return Err(AnnualPaymentError::Invalid(
            "Die Steuergrundlagen des Auszahlungsjahres fehlen.",
        ));
    }
    estimate_cross_year_arrears_tax_basis(
        ArrearsPayrollBasis {
            month: &base.month,
            rules_year: base.calculation_basis.rules_year,
            taxable_gross_cents: amount(base, "taxableGrossCents")?,
        },
        amount(regular, "taxableGrossCents")?,
        profile,
        raw_payments,
        prior_year_taxable,
        included_annual_gross,
    )
}

pub(crate) fn estimate_cross_year_arrears_tax_basis(
    base: ArrearsPayrollBasis<'_>,
    regular_taxable_gross_cents: i64,
    profile: &NetPayProfile,
    raw_payments: &Value,
    prior_year_taxable: i64,
    included_annual_gross: i64,
) -> Result<CrossYearTax, AnnualPaymentError> {
    if base.rules_year != 2026 {
        return Err(AnnualPaymentError::Invalid(
            "Die Steuergrundlagen des Auszahlungsjahres fehlen.",
        ));
    }
    let payments = validate_annual_salary_payments(raw_payments)?;
    let payment = payments
        .iter()
        .find(|payment| payment.payout_month == base.month);
    let payroll_basis = payment.and_then(|p| p.net_basis.as_ref()).and_then(|b| {
        if let AnnualPaymentBasis::Payroll {
            annual_taxable_gross_cents,
            ..
        } = b
        {
            Some(*annual_taxable_gross_cents)
        } else {
            None
        }
    });
    let annual_taxable = payroll_basis.unwrap_or(
        regular_taxable_gross_cents * 12
            + payments
                .iter()
                .filter(|payment| {
                    payment.payout_month.starts_with(&base.month[..4])
                        && payment.payout_month.as_str() < base.month
                })
                .map(|payment| payment.gross_cents)
                .sum::<i64>(),
    );
    let taxable = base.taxable_gross_cents;
    if !(0..=crate::money::MAX_SAFE_INTEGER).contains(&prior_year_taxable)
        || annual_taxable < taxable
        || annual_taxable > crate::money::MAX_SAFE_INTEGER
    {
        return Err(AnnualPaymentError::Invalid(
            "Die Jahressteuergrundlagen der Nachzahlung sind widersprüchlich.",
        ));
    }
    let one_off = prior_year_taxable
        .checked_add(included_annual_gross)
        .ok_or(AnnualPaymentError::Invalid(
            "Die Jahressteuergrundlagen der Nachzahlung sind widersprüchlich.",
        ))?;
    let tax = calculate_tax_2026(
        taxable,
        profile,
        childless(profile, base.month)?,
        Some(OneOffTaxInput {
            gross_cents: one_off,
            annual_taxable_gross_cents: annual_taxable,
        }),
    )?;
    Ok(CrossYearTax {
        tax,
        estimate: CrossYearEstimate {
            assumed_payment: "MONTH_END",
            annual_taxable_gross_cents: annual_taxable,
            annual_basis: if payroll_basis.is_some() {
                "PAYROLL"
            } else {
                "CURRENT_REGULAR_PAY"
            },
        },
    })
}
