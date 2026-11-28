//! Offline monthly net pay. Domain statuses remain distinct from kernel errors.
pub(crate) mod absence_pay;
pub mod annual_payment;
pub mod automation;
pub mod gross_evidence;
pub mod payment_projection;
pub mod payment_schedule;
pub mod payout_forecast;
pub mod pension;
pub mod premium_trace;
pub mod provider;
pub mod settings;
pub mod sfn;
pub mod social_insurance;

use crate::calendar::parse_date;
use crate::tax::{Decimal, Pap2026Input, PapError, calculate_pap_2026};
use jiff::{ToSpan, civil::Date};
use pension::{Pension, calculate_pension_2026};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use social_insurance::{
    SocialInsurance, TRANSITION_ZONE_UPPER_CENTS, calculate_social_insurance_2026,
    care_discount_count,
};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CalculationMode {
    #[default]
    Verified,
    Forecast,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalculationBasis {
    pub payroll_year: i16,
    pub rules_year: i16,
    pub status: &'static str,
    pub revision: &'static str,
}

fn valid_month(month: &str) -> bool {
    month.len() == 7
        && month.as_bytes()[4] == b'-'
        && month
            .bytes()
            .enumerate()
            .all(|(i, b)| i == 4 || b.is_ascii_digit())
        && matches!(
            &month[5..],
            "01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12"
        )
}

pub fn resolve_calculation_basis(month: &str, mode: CalculationMode) -> Option<CalculationBasis> {
    if !valid_month(month) {
        return None;
    }
    match &month[..4] {
        "2026" => Some(CalculationBasis {
            payroll_year: 2026,
            rules_year: 2026,
            status: "VERIFIED",
            revision: "DE-NET-2026-VERIFIED-v1",
        }),
        "2027" if mode == CalculationMode::Forecast => Some(CalculationBasis {
            payroll_year: 2027,
            rules_year: 2026,
            status: "PREVIOUS_YEAR_ESTIMATE",
            revision: "DE-NET-2027-ESTIMATE-2026-v1",
        }),
        _ => None,
    }
}

/// JSON numbers can use exponent or decimal notation. Validate them as exact
/// integers before converting; numeric strings never stand in for numbers.
pub(super) fn integer_in_range(value: &Value, minimum: i64, maximum: i64) -> Option<i64> {
    let number = value.as_number()?;
    let integer = if let Some(value) = number.as_i64() {
        value
    } else {
        let decimal = Decimal::parse(&number.to_string()).ok()?;
        let integer = decimal.trunc_i64().ok()?;
        if decimal != Decimal::from_i64(integer) {
            return None;
        }
        integer
    };
    (minimum..=maximum).contains(&integer).then_some(integer)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetPayProfile {
    pub birth_date: String,
    pub tax_class: i64,
    pub factor_permille: Option<i64>,
    pub church_tax_rate_percent: i64,
    pub child_allowance_half_units: i64,
    pub is_parent: bool,
    pub children_under25: i64,
    pub works_in_saxony: bool,
    pub health_additional_rate_bps: i64,
    pub monthly_tax_allowance_cents: i64,
}

impl NetPayProfile {
    /// Validation matches the computation contract; extra profile keys are ignored.
    pub fn parse(value: &Value) -> Option<Self> {
        value.as_object()?;
        let birth_date = value["birthDate"].as_str()?;
        parse_date(birth_date).ok()?;
        let tax_class = integer_in_range(&value["taxClass"], 1, 6)?;
        let church_tax_rate_percent = integer_in_range(&value["churchTaxRatePercent"], 0, 9)?;
        if ![0, 8, 9].contains(&church_tax_rate_percent) {
            return None;
        }
        let child_allowance_half_units =
            integer_in_range(&value["childAllowanceHalfUnits"], 0, 20)?;
        let children_under25 = integer_in_range(&value["childrenUnder25"], 0, 20)?;
        let is_parent = value["isParent"].as_bool()?;
        let works_in_saxony = value["worksInSaxony"].as_bool()?;
        if (!is_parent && children_under25 != 0)
            || (tax_class > 4 && child_allowance_half_units != 0)
        {
            return None;
        }
        let factor_permille = match value.get("factorPermille")? {
            Value::Null => None,
            value if tax_class == 4 => Some(integer_in_range(value, 1, 999)?),
            _ => return None,
        };
        Some(Self {
            birth_date: birth_date.into(),
            tax_class,
            factor_permille,
            church_tax_rate_percent,
            child_allowance_half_units,
            is_parent,
            children_under25,
            works_in_saxony,
            health_additional_rate_bps: integer_in_range(
                &value["healthAdditionalRateBps"],
                0,
                10_000,
            )?,
            monthly_tax_allowance_cents: integer_in_range(
                &value["monthlyTaxAllowanceCents"],
                0,
                10_000_000,
            )?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tax {
    pub wage_tax_cents: i64,
    pub solidarity_cents: i64,
    pub church_tax_basis_cents: i64,
    pub church_tax_cents: i64,
    pub total_cents: i64,
}

#[derive(Debug, Clone, Copy)]
pub struct OneOffTaxInput {
    pub gross_cents: i64,
    pub annual_taxable_gross_cents: i64,
}

/// Monthly PAP mapping, also used when a supported one-off payment is supplied.
pub fn calculate_tax_2026(
    taxable_gross_cents: i64,
    profile: &NetPayProfile,
    childless_surcharge: bool,
    one_off: Option<OneOffTaxInput>,
) -> Result<Tax, PapError> {
    if !(0..=10_000_000).contains(&taxable_gross_cents)
        || !(0..=10_000_000).contains(&profile.monthly_tax_allowance_cents)
        || !(1..=6).contains(&profile.tax_class)
        || !(0..=10_000).contains(&profile.health_additional_rate_bps)
        || !(0..=20).contains(&profile.child_allowance_half_units)
        || !(0..=20).contains(&profile.children_under25)
        || ![0, 8, 9].contains(&profile.church_tax_rate_percent)
        || profile
            .factor_permille
            .is_some_and(|f| !(1..=999).contains(&f))
        || one_off.is_some_and(|v| {
            !(0..=crate::money::MAX_SAFE_INTEGER).contains(&v.gross_cents)
                || !(0..=crate::money::MAX_SAFE_INTEGER).contains(&v.annual_taxable_gross_cents)
        })
    {
        return Err(PapError::InvalidDecimal);
    }
    let zero = Decimal::zero;
    let output = calculate_pap_2026(Pap2026Input {
        re4: Some(Decimal::from_i64(taxable_gross_cents)),
        lzz: Some(2),
        stkl: Some(profile.tax_class),
        af: Some(i64::from(profile.factor_permille.is_some())),
        f: Some(
            profile
                .factor_permille
                .map(|factor| Decimal::from_parts(factor, 3))
                .unwrap_or_else(Decimal::one),
        ),
        r: Some(i64::from(profile.church_tax_rate_percent != 0)),
        zkf: Some(
            Decimal::from_i64(profile.child_allowance_half_units)
                .div_exact(Decimal::from_i64(2))?,
        ),
        kvz: Some(Decimal::from_parts(profile.health_additional_rate_bps, 2)),
        pvs: Some(i64::from(profile.works_in_saxony)),
        pvz: Some(i64::from(childless_surcharge)),
        pva: Some(Decimal::from_i64(care_discount_count(profile))),
        pkv: Some(0),
        krv: Some(0),
        alv: Some(0),
        alter1: Some(0),
        lzzfreib: Some(Decimal::from_i64(profile.monthly_tax_allowance_cents)),
        lzzhinzu: Some(zero()),
        sonstb: Some(Decimal::from_i64(one_off.map_or(0, |v| v.gross_cents))),
        jre4: Some(Decimal::from_i64(
            one_off.map_or(0, |v| v.annual_taxable_gross_cents),
        )),
        jfreib: Some(Decimal::from_i64(profile.monthly_tax_allowance_cents * 12)),
        ..Pap2026Input::default()
    })?;
    let wage_tax_cents = output.lstlzz.trunc_i64()? + output.sts.trunc_i64()?;
    let solidarity_cents = output.solzlzz.trunc_i64()? + output.solzs.trunc_i64()?;
    let bk = output.bk.trunc_i64()?;
    let bks = output.bks.trunc_i64()?;
    let church_tax_basis_cents = bk + bks;
    // Discard fractional cents separately for regular and one-off church tax.
    let church_tax_cents =
        bk * profile.church_tax_rate_percent / 100 + bks * profile.church_tax_rate_percent / 100;
    Ok(Tax {
        wage_tax_cents,
        solidarity_cents,
        church_tax_basis_cents,
        church_tax_cents,
        total_cents: wage_tax_cents + solidarity_cents + church_tax_cents,
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableNetPay {
    pub month: String,
    pub rule_version: &'static str,
    pub calculation_basis: CalculationBasis,
    pub amounts: BTreeMap<String, i64>,
    pub tax: Tax,
    pub social_insurance: SocialInsurance,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pension: Option<Pension>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additional_net_deduction_cents: Option<i64>,
    pub net_cents: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status")]
pub enum NetPayResult {
    #[serde(rename = "available")]
    Available(Box<AvailableNetPay>),
    #[serde(rename = "missing-profile")]
    MissingProfile { reason: &'static str },
    #[serde(rename = "invalid-input")]
    InvalidInput { reason: &'static str },
    #[serde(rename = "unsupported")]
    Unsupported { reason: &'static str },
}

fn age_on(birth_date: Date, date: Date) -> i16 {
    let years = date.year() - birth_date.year();
    years - i16::from((date.month(), date.day()) < (birth_date.month(), birth_date.day()))
}

pub(crate) fn js_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => {
            Decimal::parse(&value.to_string()).map_or(true, |value| value != Decimal::zero())
        }
        Value::String(value) => !value.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// Validate in the existing order, retaining missing/null/zero and unsupported
/// boundaries. PAP errors are separate from an ordinary unavailable net result.
pub fn calculate_monthly_net_pay(
    input: &Value,
    mode: CalculationMode,
) -> Result<NetPayResult, PapError> {
    use NetPayResult::{InvalidInput, MissingProfile, Unsupported};
    let Some(month) = input["month"].as_str().filter(|month| valid_month(month)) else {
        return Ok(InvalidInput {
            reason: "Der Abrechnungsmonat ist ungültig.",
        });
    };
    let Some(calculation_basis) = resolve_calculation_basis(month, mode) else {
        return Ok(Unsupported {
            reason: if mode == CalculationMode::Forecast {
                "Für dieses Jahr fehlen Berechnungsgrundlagen für eine vorläufige Netto-Prognose."
            } else {
                "Der Prototyp unterstützt ausschließlich 2026."
            },
        });
    };
    if input["profile"].is_null() {
        return Ok(MissingProfile {
            reason: "Die Angaben für die Netto-Prognose fehlen.",
        });
    }
    let Some(profile) = NetPayProfile::parse(&input["profile"]) else {
        return Ok(InvalidInput {
            reason: "Die Steuer- oder Versicherungsangaben sind ungültig.",
        });
    };
    let Some(special_cases) = input["specialCases"].as_array() else {
        return Ok(InvalidInput {
            reason: "Der Beschäftigungsumfang muss bestätigt werden.",
        });
    };
    let apprentice = input["employmentKind"] == "APPRENTICE";
    if input.get("employmentKind").is_some() && !apprentice && input["employmentKind"] != "EMPLOYEE"
    {
        return Ok(InvalidInput {
            reason: "Die Beschäftigungsart ist ungültig.",
        });
    }
    if special_cases
        .iter()
        .any(|value| value != "APPRENTICE" || !apprentice)
    {
        return Ok(Unsupported {
            reason: "Dieser Abrechnungsfall ist noch nicht unterstützt.",
        });
    }
    let invalid_amounts = || InvalidInput {
        reason: "Die Bruttobeträge sind ungültig oder widersprüchlich.",
    };
    let Some(amounts) = input["amounts"].as_object() else {
        return Ok(invalid_amounts());
    };
    let Some(mut adjusted_amounts) = amounts
        .iter()
        .map(|(key, value)| Some((key.clone(), integer_in_range(value, 0, 10_000_000)?)))
        .collect::<Option<BTreeMap<_, _>>>()
    else {
        return Ok(invalid_amounts());
    };
    let Some(gross) = integer_in_range(&input["amounts"]["grossCents"], 1, 10_000_000) else {
        return Ok(invalid_amounts());
    };
    let Some(taxable) = integer_in_range(&input["amounts"]["taxableGrossCents"], 0, gross) else {
        return Ok(invalid_amounts());
    };
    let Some(social) = integer_in_range(
        &input["amounts"]["socialInsuranceGrossCents"],
        taxable,
        gross,
    ) else {
        return Ok(invalid_amounts());
    };
    let Some(regular_social) = integer_in_range(
        &input["amounts"]["regularMonthlySocialInsuranceGrossCents"],
        1,
        10_000_000,
    ) else {
        return Ok(invalid_amounts());
    };
    let Ok(birth_date) = parse_date(&profile.birth_date) else {
        return Ok(InvalidInput {
            reason: "Das Geburtsdatum ist ungültig.",
        });
    };
    let month_start = parse_date(&format!("{month}-01")).map_err(|_| PapError::InvalidDecimal)?;
    let year_start = Date::new(month_start.year(), 1, 1).map_err(|_| PapError::InvalidDecimal)?;
    if age_on(birth_date, month_start) < if apprentice { 15 } else { 18 }
        || age_on(birth_date, year_start) >= 64
    {
        return Ok(Unsupported {
            reason: "Dieser Alters- oder Versorgungsfall ist nicht unterstützt.",
        });
    }
    let birthday23 = birth_date
        .checked_add(23.years())
        .map_err(|_| PapError::InvalidDecimal)?;
    let childless_surcharge = !profile.is_parent && birthday23 < month_start;
    let additional = match input.get("additionalNetDeductionCents") {
        None | Some(Value::Null) => Some(0),
        Some(value) => integer_in_range(value, 0, 10_000_000),
    };
    let Some(additional) = additional else {
        return Ok(InvalidInput {
            reason: "Die weiteren Netto-Abzüge sind ungültig.",
        });
    };
    let (pension, regular_pension) = if js_truthy(&input["pension"]) {
        let pension = match calculate_pension_2026(&input["pension"], "contributionBasisCents") {
            Ok(value) => value,
            Err(reason) => return Ok(Unsupported { reason }),
        };
        let regular_pension =
            match calculate_pension_2026(&input["pension"], "regularContributionBasisCents") {
                Ok(value) => value,
                Err(reason) => return Ok(Unsupported { reason }),
            };
        (Some(pension), Some(regular_pension))
    } else {
        (None, None)
    };
    let taxable = taxable + pension.as_ref().map_or(0, |p| p.taxable_adjustment_cents);
    let social = social
        + pension
            .as_ref()
            .map_or(0, |p| p.social_insurance_adjustment_cents);
    let regular_social = regular_social
        + regular_pension
            .as_ref()
            .map_or(0, |p| p.social_insurance_adjustment_cents);
    if [taxable, social, regular_social]
        .iter()
        .any(|value| !(0..=10_000_000).contains(value))
    {
        return Ok(InvalidInput {
            reason: "Die Zusatzversorgungsbeträge passen nicht zum Entgelt.",
        });
    }
    adjusted_amounts.insert("taxableGrossCents".into(), taxable);
    adjusted_amounts.insert("socialInsuranceGrossCents".into(), social);
    adjusted_amounts.insert(
        "regularMonthlySocialInsuranceGrossCents".into(),
        regular_social,
    );
    if regular_social
        <= if apprentice {
            32_500
        } else {
            TRANSITION_ZONE_UPPER_CENTS
        }
    {
        return Ok(Unsupported {
            reason: if apprentice {
                "Ausbildungsentgelte bis 325 Euro benötigen eine gesonderte Beitragsberechnung."
            } else {
                "Mini- und Midijobs benötigen eine eigene Berechnung."
            },
        });
    }
    let social_insurance =
        calculate_social_insurance_2026(social, &profile, childless_surcharge, None)?;
    let tax = calculate_tax_2026(taxable, &profile, childless_surcharge, None)?;
    let net_cents = gross
        - tax.total_cents
        - social_insurance.total_cents
        - pension.as_ref().map_or(0, |p| p.employee_cents)
        - additional;
    if net_cents < 0 {
        return Ok(InvalidInput {
            reason: "Die Abzüge übersteigen das angegebene Brutto.",
        });
    }
    Ok(NetPayResult::Available(Box::new(AvailableNetPay {
        month: month.into(),
        rule_version: "DE-2026-PAP1-SV2026-PROTOTYPE",
        calculation_basis,
        amounts: adjusted_amounts,
        tax,
        social_insurance,
        pension,
        additional_net_deduction_cents: (additional != 0).then_some(additional),
        net_cents,
    })))
}
