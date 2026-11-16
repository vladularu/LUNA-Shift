use super::*;
enum RateKind {
    Care,
    Shift,
    Premium,
}
struct Coverage<'a> {
    pkg: &'a Value,
    values: &'a Value,
    pairs: &'a [String],
    from: &'a str,
    kind: RateKind,
    provision: Option<&'a str>,
    mode: Mode,
}
fn coverage(input: Coverage<'_>, out: &mut Vec<ValidationIssue>) {
    let Coverage {
        pkg,
        values,
        pairs,
        from,
        kind,
        provision,
        mode,
    } = input;
    let (root, code) = match kind {
        RateKind::Care => ("/rules/caritasCareAllowanceRates", "CARITAS_RATE_COVERAGE"),
        RateKind::Shift => (
            "/rules/caritasShiftAllowanceRates",
            "CARITAS_SHIFT_COVERAGE",
        ),
        RateKind::Premium => ("/rules/caritasTimePremiumRates", "CARITAS_PREMIUM_COVERAGE"),
    };
    for pair_id in pairs {
        let label = provision.map_or_else(|| pair_id.clone(), |p| format!("{p}:{pair_id}"));
        let mut dated: Vec<&Value> = a(values)
            .iter()
            .filter(|r| pair(r) == *pair_id && provision.is_none_or(|p| s(r, "provisionId") == p))
            .collect();
        dated.sort_by_key(|r| s(r, "validFrom"));
        let mut next = from.to_owned();
        for rate in &dated {
            if !valid_date(s(rate, "validFrom")) || !valid_date(s(rate, "validTo")) {
                continue;
            }
            if s(rate, "validFrom") != next {
                issue(out, code, root, format!("Gap or overlap in {label}."));
            }
            next = next_date(s(rate, "validTo")).expect("valid rate date");
        }
        if (mode.care() && dated.is_empty()) || Some(next) != next_date(s(pkg, "validTo")) {
            issue(out, code, root, format!("Incomplete coverage for {label}."));
        }
    }
}
pub(super) fn check(pkg: &Value, mode: Mode, out: &mut Vec<ValidationIssue>) {
    let rules = &pkg["rules"];
    let pairs = pairs(pkg);
    let regional_source = if region(pkg) == Some("ost") {
        "caritas-rk-ost-2025-allowances".to_owned()
    } else {
        format!("caritas-rk-{}-2025", region(pkg).unwrap_or("undefined"))
    };
    if let Some(rates) = rules.get("caritasCareAllowanceRates") {
        let root = "/rules/caritasCareAllowanceRates";
        let mut ids = BTreeSet::new();
        for (i, rate) in a(rates).iter().enumerate() {
            let path = format!("{root}/{i}");
            if !ids.insert(s(rate, "id")) {
                issue(
                    out,
                    "CARITAS_RATE_ID",
                    &path,
                    "Duplicate care-allowance rate id.",
                );
            }
            if !pairs.contains(&pair(rate)) {
                issue(
                    out,
                    "CARITAS_RATE_SELECTION",
                    &path,
                    "Unknown annex or regional territory.",
                );
            }
            if invalid_range(pkg, rate) {
                issue(
                    out,
                    "CARITAS_RATE_RANGE",
                    &path,
                    "Invalid or out-of-package allowance-rate range.",
                );
            }
            if s(rate, "provisionId") == "SECTION_12_4" {
                if !includes(rate, "sourceIds", "caritas-bk-2025-02-corrected")
                    || !includes(rate, "sourceIds", &regional_source)
                {
                    issue(
                        out,
                        "CARITAS_RATE_SOURCE",
                        &path,
                        if mode.care() {
                            "§ 12(4) requires the federal amount and regional adoption source."
                        } else {
                            "§ 12(4) needs federal and regional sources."
                        },
                    );
                }
            } else if !includes(rate, "sourceIds", "caritas-dg-2024-care-allowances") {
                issue(
                    out,
                    "CARITAS_RATE_SOURCE",
                    &path,
                    if mode.care() {
                        "§ 12(3) requires the regional-rate source."
                    } else {
                        "§ 12(3) needs the regional-rate source."
                    },
                );
            }
            unknown_sources(pkg, rate, &path, out);
        }
        if pkg["validTo"] != Value::Null
            && valid_date(s(pkg, "validTo"))
            && (mode.care() || valid_date(s(pkg, "validFrom")))
        {
            for provision in ["SECTION_12_3", "SECTION_12_4"] {
                let from = if provision == "SECTION_12_4" && s(pkg, "validFrom") < "2025-07-01" {
                    "2025-07-01"
                } else {
                    s(pkg, "validFrom")
                };
                coverage(
                    Coverage {
                        pkg,
                        values: rates,
                        pairs: &pairs,
                        from,
                        kind: RateKind::Care,
                        provision: Some(provision),
                        mode,
                    },
                    out,
                );
            }
        }
    }
    if let Some(rates) = rules.get("caritasShiftAllowanceRates") {
        let root = "/rules/caritasShiftAllowanceRates";
        let mut ids = BTreeSet::new();
        for (i, rate) in a(rates).iter().enumerate() {
            let path = format!("{root}/{i}");
            if !ids.insert(s(rate, "id")) {
                issue(out, "CARITAS_SHIFT_ID", &path, "Duplicate shift-rate id.");
            }
            if !pairs.contains(&pair(rate)) {
                issue(
                    out,
                    "CARITAS_SHIFT_SELECTION",
                    &path,
                    "Unknown annex or regional territory.",
                );
            }
            if invalid_range(pkg, rate) || s(rate, "validFrom") < "2025-07-01" {
                issue(
                    out,
                    "CARITAS_SHIFT_RANGE",
                    &path,
                    "Invalid or out-of-package shift-rate range.",
                );
            }
            if !includes(rate, "sourceIds", "caritas-bk-2025-02-corrected")
                || !includes(rate, "sourceIds", &regional_source)
            {
                issue(
                    out,
                    "CARITAS_SHIFT_SOURCE",
                    &path,
                    "Federal rate and regional adoption required.",
                );
            }
            unknown_sources(pkg, rate, &path, out);
        }
        if pkg["validTo"] != Value::Null && valid_date(s(pkg, "validTo")) {
            let from = if s(pkg, "validFrom") >= "2025-07-01" {
                s(pkg, "validFrom")
            } else {
                "2025-07-01"
            };
            coverage(
                Coverage {
                    pkg,
                    values: rates,
                    pairs: &pairs,
                    from,
                    kind: RateKind::Shift,
                    provision: None,
                    mode,
                },
                out,
            );
        }
    }
    if !mode.care()
        && let Some(rates) = rules.get("caritasTimePremiumRates")
    {
        let root = "/rules/caritasTimePremiumRates";
        let mut ids = BTreeSet::new();
        for (i, rate) in a(rates).iter().enumerate() {
            let path = format!("{root}/{i}");
            if !ids.insert(s(rate, "id")) {
                issue(
                    out,
                    "CARITAS_PREMIUM_ID",
                    &path,
                    "Duplicate time-premium rate id.",
                );
            }
            if !pairs.contains(&pair(rate)) {
                issue(
                    out,
                    "CARITAS_PREMIUM_SELECTION",
                    &path,
                    "Unknown annex or regional territory.",
                );
            }
            let year = s(rate, "validFrom")
                .get(..4)
                .unwrap_or(s(rate, "validFrom"));
            if invalid_range(pkg, rate)
                || Some(year) != s(rate, "validTo").get(..4)
                || !["2025", "2026"].contains(&year)
            {
                issue(
                    out,
                    "CARITAS_PREMIUM_RANGE",
                    &path,
                    "Invalid or out-of-package premium-rate range.",
                );
            }
            if !includes(rate, "sourceIds", &format!("caritas-dcv-premiums-{year}")) {
                issue(
                    out,
                    "CARITAS_PREMIUM_SOURCE",
                    &path,
                    "The matching annual DCV premium table is required.",
                );
            }
            if [
                ("nightBasisPoints", 2000.0),
                ("sundayBasisPoints", 2500.0),
                ("holidayWithTimeOffBasisPoints", 3500.0),
                ("holidayWithoutTimeOffBasisPoints", 13500.0),
                ("preHolidayBasisPoints", 3500.0),
                ("saturdayBasisPoints", 2000.0),
            ]
            .iter()
            .any(|(k, base)| n(rate, k) > *base)
                && a(&rate["sourceIds"]).len() < 2
            {
                issue(
                    out,
                    "CARITAS_PREMIUM_SOURCE",
                    &path,
                    "An increased rate needs an additional source.",
                );
            }
            unknown_sources(pkg, rate, &path, out);
        }
        if pkg["validTo"] != Value::Null
            && valid_date(s(pkg, "validFrom"))
            && valid_date(s(pkg, "validTo"))
        {
            coverage(
                Coverage {
                    pkg,
                    values: rates,
                    pairs: &pairs,
                    from: s(pkg, "validFrom"),
                    kind: RateKind::Premium,
                    provision: None,
                    mode,
                },
                out,
            );
        }
    }
}
