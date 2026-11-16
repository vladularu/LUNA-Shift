use super::integer_in_range;
use crate::money::round_ratio;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pension {
    pub scheme: String,
    pub contribution_basis_cents: i64,
    pub employee_cents: i64,
    pub taxable_adjustment_cents: i64,
    pub social_insurance_adjustment_cents: i64,
}

struct Rules {
    employee: i64,
    employee_capital: i64,
    employer_capital: i64,
    employer_umlage: i64,
    flat_tax_allowance: i64,
    shared_capital: Option<i64>,
}

fn rules(scheme: &str) -> Option<Rules> {
    let (
        employee,
        employee_capital,
        employer_capital,
        employer_umlage,
        flat_tax_allowance,
        shared_capital,
    ) = match scheme {
        "VBL_WEST" => (181, 0, 0, 549, 9203, None),
        "VBL_EAST" => (425, 425, 200, 106, 8948, None),
        "KZVK" => (40, 40, 560, 0, 0, None),
        "KZVK_DORTMUND" => (75, 75, 525, 0, 0, None),
        "EZVK_DARMSTADT" => (0, 0, 660, 0, 0, Some(660)),
        "EZVK_KARLSRUHE" => (0, 0, 700, 0, 0, Some(700)),
        "BVK_I" => (0, 0, 400, 375, 8948, None),
        "BVK_II" => (0, 0, 480, 0, 0, None),
        "KVBW_I" => (55, 0, 65, 575, 8948, None),
        "KVBW_II" => (40, 40, 810, 0, 0, None),
        "RZVK" => (0, 0, 0, 425, 8948, None),
        "KVW_I" => (0, 0, 0, 450, 8948, None),
        "KVW_II" => (40, 40, 400, 250, 8948, None),
        "KVK_I" => (65, 0, 0, 585, 8948, None),
        "ZVK_DARMSTADT_I" => (50, 0, 0, 570, 8948, None),
        "ZVK_DARMSTADT_II" => (40, 40, 611, 0, 0, None),
        "KVBBG" => (240, 240, 240, 110, 8948, None),
        "ZVK_SACHSEN" => (240, 240, 246, 160, 8948, None),
        "ZVK_THUERINGEN" => (240, 240, 200, 170, 8948, None),
        _ => return None,
    };
    Some(Rules {
        employee,
        employee_capital,
        employer_capital,
        employer_umlage,
        flat_tax_allowance,
        shared_capital,
    })
}

fn rate(cents: i64, bps: i64) -> Result<i64, &'static str> {
    // All validated products are small nonnegative integers, so exact HALF_UP
    // has the same result as Math.round without relying on floating-point money.
    round_ratio(cents * bps, 10_000).map_err(|_| "Die Zusatzversorgungsgrundlage ist ungültig.")
}

/// The raw boundary preserves missing versus explicitly null employee rates.
pub fn calculate_pension_2026(input: &Value, basis_field: &str) -> Result<Pension, &'static str> {
    let basis = integer_in_range(&input[basis_field], 0, 10_000_000)
        .ok_or("Die Zusatzversorgungsgrundlage ist ungültig.")?;
    let scheme = input["scheme"].as_str().unwrap_or("");
    if scheme == "OTHER" {
        return Err("Für diese Zusatzversorgung fehlen die Beitrags- und Steuerregeln.");
    }
    if scheme == "NONE" {
        return Ok(Pension {
            scheme: scheme.into(),
            contribution_basis_cents: basis,
            employee_cents: 0,
            taxable_adjustment_cents: 0,
            social_insurance_adjustment_cents: 0,
        });
    }
    let rules = rules(scheme).ok_or("Die Zusatzversorgung ist ungültig.")?;
    let own_rate = match rules.shared_capital {
        Some(shared) => integer_in_range(&input["employeeRateBps"], 0, shared / 2),
        None if input.get("employeeRateBps").is_none() => Some(rules.employee),
        None => None,
    }
    .ok_or("Der Eigenanteil der Zusatzversorgung fehlt oder ist ungültig.")?;
    if basis > 897_396 {
        return Err("Für dieses Entgelt müssen zusätzliche Versorgungsbeiträge geprüft werden.");
    }
    let employee_cents = rate(basis, own_rate)?;
    let employer_capital = rate(
        basis,
        rules
            .shared_capital
            .map(|shared| shared - own_rate)
            .unwrap_or(rules.employer_capital),
    )?;
    let employee_capital = rate(
        basis,
        if rules.shared_capital.is_some() {
            own_rate
        } else {
            rules.employee_capital
        },
    )?;
    let employee_tax_free = employee_capital.min((67_600 - employer_capital).max(0));
    let employer_taxable = (employer_capital - 67_600).max(0);
    let employee_sv_free = employee_capital.min((33_800 - employer_capital).max(0));
    let employer_sv_liable = (employer_capital - 33_800).max(0);
    let umlage_bps = rules.employer_umlage;
    let umlage = rate(basis, umlage_bps)?;
    let umlage_tax_free = umlage.min((33_800 - employer_capital - employee_tax_free).max(0));
    let umlage_taxable = (umlage - umlage_tax_free - rules.flat_tax_allowance).max(0);
    let exempt_umlage = umlage - umlage_taxable;
    let capped_umlage = exempt_umlage.min(10_000);
    let hinzurechnung = if umlage_bps == 0 {
        0
    } else {
        (round_ratio(capped_umlage * umlage_bps.min(250), umlage_bps)
            .map_err(|_| "Die Zusatzversorgungsgrundlage ist ungültig.")?
            - 1_330)
            .max(0)
    };
    let umlage_sv = umlage_taxable + (exempt_umlage - 10_000).max(0) + hinzurechnung;
    Ok(Pension {
        scheme: scheme.into(),
        contribution_basis_cents: basis,
        employee_cents,
        taxable_adjustment_cents: employer_taxable - employee_tax_free + umlage_taxable,
        social_insurance_adjustment_cents: employer_sv_liable - employee_sv_free + umlage_sv,
    })
}
