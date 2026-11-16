use super::*;
use std::collections::BTreeMap;
fn window(v: &Value, start: f64, end: f64) -> bool {
    n(v, "startMinute") == start && n(v, "endMinute") == end
}
pub(super) fn check(pkg: &Value, out: &mut Vec<ValidationIssue>) {
    let rules = &pkg["rules"];
    if let Some(policy) = rules.get("caritasTimePremiumPolicy") {
        let root = "/rules/caritasTimePremiumPolicy";
        if invalid_range(pkg, policy) {
            issue(
                out,
                "CARITAS_TIME_PREMIUM_RANGE",
                root,
                "Policy dates must lie within the package.",
            );
        }
        if !window(&policy["nightWindow"], 1260.0, 360.0)
            || !window(&policy["preHolidayWindow"], 360.0, 0.0)
            || !window(&policy["saturdayWindow"], 780.0, 1260.0)
            || [
                ("nightBasisPoints", 2000.0),
                ("sundayBasisPoints", 2500.0),
                ("holidayWithTimeOffBasisPoints", 3500.0),
                ("holidayWithoutTimeOffBasisPoints", 13500.0),
                ("preHolidayBasisPoints", 3500.0),
                ("saturdayBasisPoints", 2000.0),
            ]
            .iter()
            .any(|(k, base)| n(policy, k) != *base)
            || a(&policy["preHolidayMonthDays"]).len() != 2
            || !includes(policy, "preHolidayMonthDays", "12-24")
            || !includes(policy, "preHolidayMonthDays", "12-31")
        {
            issue(
                out,
                "CARITAS_TIME_PREMIUM_VALUE",
                root,
                "The federal Anlage 31/32 baseline must preserve its windows, rates and holiday collision rules.",
            );
        }
        unknown_sources(pkg, policy, root, out);
    }
    if let Some(policy) = rules.get("caritasOvertimePolicy") {
        let root = "/rules/caritasOvertimePolicy";
        if invalid_range(pkg, policy)
            || s(policy, "validFrom") < "2025-01-01"
            || s(policy, "validTo") > "2026-12-31"
        {
            issue(
                out,
                "CARITAS_OVERTIME_RANGE",
                root,
                "Overtime policy dates need reviewed package coverage.",
            );
        }
        let mut expected: BTreeMap<&str, f64> = super::super::caritas_annual::CARE_GROUPS
            .iter()
            .map(|g| {
                (
                    *g,
                    if ["p4", "p6", "p7", "p8", "p9", "p10", "p11"].contains(g) {
                        3000.0
                    } else {
                        1500.0
                    },
                )
            })
            .collect();
        for band in a(&policy["rateBands"]) {
            for group in a(&band["groupIds"]) {
                let group = group.as_str().unwrap_or("");
                if expected.remove(group) != Some(n(band, "premiumBasisPoints")) {
                    issue(
                        out,
                        "CARITAS_OVERTIME_RATE",
                        format!("{root}/rateBands"),
                        format!("Incorrect or repeated group {group}."),
                    );
                }
            }
        }
        if !expected.is_empty() {
            issue(
                out,
                "CARITAS_OVERTIME_RATE",
                format!("{root}/rateBands"),
                "P-group rates are incomplete.",
            );
        }
        let expected = if s(policy, "validFrom").starts_with("2025") {
            "caritas-avr-text-2025-1"
        } else {
            "caritas-avr-text-2026-03"
        };
        if !includes(policy, "sourceIds", expected) {
            issue(
                out,
                "CARITAS_OVERTIME_SOURCE",
                format!("{root}/sourceIds"),
                "The dated AVR text source is required.",
            );
        }
        unknown_sources(pkg, policy, root, out);
    }
    if let Some(policy) = rules.get("caritasAnnualPaymentPolicy") {
        let root = "/rules/caritasAnnualPaymentPolicy";
        let year_text = s(policy, "validFrom")
            .get(..4)
            .unwrap_or(s(policy, "validFrom"));
        let year = year_text.parse::<f64>().unwrap_or(f64::NAN);
        let year_string = if year.fract() == 0.0 {
            format!("{year:.0}")
        } else {
            year.to_string()
        };
        if !valid_date(s(policy, "validFrom"))
            || !valid_date(s(policy, "validTo"))
            || s(policy, "validFrom") < s(pkg, "validFrom")
            || (pkg["validTo"] != Value::Null && s(policy, "validTo") > s(pkg, "validTo"))
            || s(policy, "validTo").get(..4) != Some(year_string.as_str())
            || ![2025.0, 2026.0].contains(&year)
            || s(policy, "validFrom") > format!("{year_string}-11-01").as_str()
            || s(policy, "validTo") < format!("{year_string}-11-30").as_str()
        {
            issue(
                out,
                "CARITAS_ANNUAL_RANGE",
                root,
                "One claim year and its November payout must be covered.",
            );
        }
        let mut seen: Vec<f64> = vec![];
        for band in a(&policy["rateBands"]) {
            let rate = n(band, "rateBasisPoints");
            let expected = if rate == 8600.0 {
                Some(&["p4", "p6", "p7", "p8"][..])
            } else if rate == 7600.0 {
                Some(&["p9", "p10", "p11", "p12", "p13", "p14", "p15", "p16"][..])
            } else {
                None
            };
            if expected.is_none()
                || seen.contains(&rate)
                || expected.is_some_and(|expected| {
                    a(&band["groupIds"]).len() != expected.len()
                        || a(&band["groupIds"])
                            .iter()
                            .any(|g| !expected.contains(&g.as_str().unwrap_or("")))
                })
            {
                issue(
                    out,
                    "CARITAS_ANNUAL_RATE",
                    format!("{root}/rateBands"),
                    "P-group rate mapping is incomplete.",
                );
            }
            if !seen.contains(&rate) {
                seen.push(rate);
            }
        }
        if seen.len() != 2 {
            issue(
                out,
                "CARITAS_ANNUAL_RATE",
                format!("{root}/rateBands"),
                "Both sourced rate bands are required.",
            );
        }
        if policy["eastTariff2025UsesWestTable"]
            != Value::Bool(region(pkg) == Some("ost") && year == 2025.0)
        {
            issue(
                out,
                "CARITAS_ANNUAL_EAST_BASIS",
                format!("{root}/eastTariff2025UsesWestTable"),
                "The east-tariff West-table exception expires at the end of 2025.",
            );
        }
        if !includes(
            policy,
            "sourceIds",
            if year == 2025.0 {
                "caritas-avr-text-2025-1"
            } else {
                "caritas-avr-text-2026-03"
            },
        ) || (region(pkg) == Some("ost")
            && year == 2026.0
            && !includes(policy, "sourceIds", "caritas-bk-2025-03-east-annual"))
        {
            issue(
                out,
                "CARITAS_ANNUAL_SOURCE",
                format!("{root}/sourceIds"),
                "The AVR and east amendment must be cited.",
            );
        }
        unknown_sources(pkg, policy, root, out);
    }
    if pkg["validTo"] == Value::Null || s(pkg, "validTo") > "2026-12-31" {
        issue(
            out,
            "CARITAS_2027_TRANSITION",
            "/validTo",
            "The AVR 2027 transition requires a separately verified contract.",
        );
    }
}
