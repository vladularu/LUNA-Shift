use super::*;
fn expected(pkg: &Value, v: &Value, date: &str, mode: Mode) -> f64 {
    if s(v, "variantId") == "ANLAGE_32"
        || ["BW", "MITTE"].contains(&s(v, "regionId"))
        || ((!mode.care() || s(pkg, "packageId") == "avr-caritas-p-ost")
            && s(v, "regionId") == "OST_TARIF_WEST_BERLIN"
            && date < "2025-07-01")
    {
        2340.0
    } else {
        2310.0
    }
}
pub(super) fn check(pkg: &Value, mode: Mode, out: &mut Vec<ValidationIssue>) {
    let Some(working) = pkg["rules"].get("employmentWorkingTimeRules") else {
        return;
    };
    let root = "/rules/employmentWorkingTimeRules";
    let pairs = pairs(pkg);
    let mut ids = BTreeSet::new();
    let mut invalid = !valid_date(s(pkg, "validFrom"))
        || pkg["validTo"] == Value::Null
        || !valid_date(s(pkg, "validTo"));
    if mode.care()
        && s(pkg, "packageId") == "avr-caritas-p-ost"
        && s(pkg, "validFrom") < "2025-07-01"
        && a(&pkg["rules"]["selection"]["variants"]).iter().any(|v| {
            a(&v["regions"])
                .iter()
                .any(|r| s(r, "id") == "OST_TARIF_WEST")
        })
    {
        issue(
            out,
            "CARITAS_WORKING_TIME_TERRITORY_AMBIGUOUS",
            root,
            "Before July 2025, Ost tariff territory West cannot distinguish Berlin from Hamburg.",
        );
    }
    for (i, rule) in a(working).iter().enumerate() {
        let path = format!("{root}/{i}");
        if !ids.insert(s(rule, "id")) {
            issue(
                out,
                "CARITAS_WORKING_TIME_ID",
                &path,
                "Duplicate working-time id.",
            );
        }
        if !pairs.contains(&pair(rule)) {
            issue(
                out,
                "CARITAS_WORKING_TIME_SELECTION",
                &path,
                if mode.care() {
                    "Unknown annex or regional territory."
                } else {
                    "Unknown annex or tariff territory."
                },
            );
        } else if valid_date(s(rule, "validFrom"))
            && rule["validTo"] != Value::Null
            && valid_date(s(rule, "validTo"))
        {
            let start = expected(pkg, rule, s(rule, "validFrom"), mode);
            let end = expected(pkg, rule, s(rule, "validTo"), mode);
            if start != end || n(rule, "fullTimeWeeklyMinutes") != start {
                issue(
                    out,
                    "CARITAS_WORKING_TIME_VALUE",
                    &path,
                    if mode.care() {
                        "Unexpected regional full-time weekly minutes or an unsplit dated change."
                    } else {
                        "Unexpected full-time weekly minutes or an unsplit dated change."
                    },
                );
            }
        }
        unknown_sources(pkg, rule, &path, out);
        if invalid_range(pkg, rule) {
            invalid = true;
            issue(
                out,
                "CARITAS_WORKING_TIME_RANGE",
                path,
                if mode.care() {
                    "Invalid or out-of-package working-time range."
                } else {
                    "Invalid or out-of-package date range."
                },
            );
        }
    }
    if !invalid {
        for p in pairs {
            let mut dated: Vec<&Value> = a(working).iter().filter(|r| pair(r) == p).collect();
            dated.sort_by_key(|r| s(r, "validFrom"));
            let mut next = s(pkg, "validFrom").to_owned();
            for rule in &dated {
                if s(rule, "validFrom") != next {
                    issue(
                        out,
                        "CARITAS_WORKING_TIME_COVERAGE",
                        root,
                        format!("Gap or overlap in {p}."),
                    );
                }
                next = next_date(s(rule, "validTo")).expect("valid date checked above");
            }
            if (mode.care() && dated.is_empty()) || Some(next) != next_date(s(pkg, "validTo")) {
                issue(
                    out,
                    "CARITAS_WORKING_TIME_COVERAGE",
                    root,
                    format!("Incomplete coverage for {p}."),
                );
            }
        }
    }
}
