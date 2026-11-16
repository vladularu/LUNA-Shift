use super::util::*;
use crate::rules::validation::ValidationIssue;
use serde_json::Value;
use std::collections::BTreeMap;

pub(super) fn tvl_care(pkg: &Value) -> Vec<ValidationIssue> {
    let mut issues = vec![];
    let Some(p) = pkg["rules"]
        .get("tvlCareAllowancePolicy")
        .filter(|p| truth(Some(p)))
    else {
        return issues;
    };
    let root = "/rules/tvlCareAllowancePolicy";
    if n(pkg, "engineContractVersion") != 12.0 || pkg["packageId"] != "tvl-kr-tdl" {
        issue(
            &mut issues,
            "UNSUPPORTED_TVL_CARE_ALLOWANCE_POLICY",
            root,
            "Care allowances require the TV-L/KR contract.",
        );
    }
    let known = sources(pkg);
    for id in rows(p, "sourceIds") {
        if id.as_str().is_none_or(|id| !known.contains(id)) {
            issue(
                &mut issues,
                "UNKNOWN_SOURCE_ID",
                root,
                "Unknown care allowance source.",
            );
        }
    }
    let mut thresholds = BTreeMap::from([
        (2, 900.0),
        (3, 600.0),
        (4, 300.0),
        (5, 150.0),
        (6, 75.0),
        (7, 0.0),
    ]);
    for tier in rows(p, "leadershipTiers") {
        let number = tier["annexFNumber"]
            .as_f64()
            .filter(|n| n.fract() == 0.0 && (2.0..=7.0).contains(n))
            .map(|n| n as i64);
        if number.and_then(|n| thresholds.get(&n)).copied() != Some(n(tier, "minimumNursingStaff"))
        {
            issue(
                &mut issues,
                "TVL_KR_CARE_LEADERSHIP_TIERS",
                root,
                "Duplicate or incorrect leadership threshold.",
            );
        }
        if let Some(number) = number {
            thresholds.remove(&number);
        }
    }
    if !thresholds.is_empty() {
        issue(
            &mut issues,
            "TVL_KR_CARE_LEADERSHIP_TIERS",
            root,
            "Incomplete leadership threshold coverage.",
        );
    }
    let mut sorted: Vec<_> = rows(p, "leadershipTiers").iter().collect();
    sorted.sort_by(|a, b| {
        n(a, "minimumNursingStaff")
            .partial_cmp(&n(b, "minimumNursingStaff"))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    if sorted
        .windows(2)
        .any(|p| n(p[1], "monthlyCents") < n(p[0], "monthlyCents"))
    {
        issue(
            &mut issues,
            "TVL_KR_CARE_RATE_ORDER",
            root,
            "Leadership amounts must not decrease with staff size.",
        );
    }
    if n(p, "clinicalLowerMonthlyCents") > n(p, "clinicalHigherMonthlyCents") {
        issue(
            &mut issues,
            "TVL_KR_CARE_RATE_ORDER",
            root,
            "The higher clinical rate cannot be lower.",
        );
    }
    issues
}
pub(super) fn tval_shift(pkg: &Value) -> Vec<ValidationIssue> {
    let mut issues = vec![];
    let Some(p) = pkg["rules"]
        .get("tvalShiftAllowancePolicy")
        .filter(|p| truth(Some(p)))
    else {
        return issues;
    };
    let root = "/rules/tvalShiftAllowancePolicy";
    if n(pkg, "engineContractVersion") != 13.0 || pkg["packageId"] != "tval-pflege-tdl" {
        issue(
            &mut issues,
            "TVAL_SHIFT_CONTRACT",
            root,
            "Training shift allowances require the separate TVA-L contract.",
        );
    }
    if n(p, "shareBasisPoints") != 7500.0 || p["rounding"] != "RATE_THEN_TOTAL" {
        issue(
            &mut issues,
            "TVAL_SHIFT_SHARE",
            root,
            "Apply the three-quarter share with explicit monetary rounding.",
        );
    }
    if rows(p, "scopes").len() != 2
        || ["GENERAL", "SECTION_43"]
            .iter()
            .any(|id| rows(p, "scopes").iter().filter(|s| s["id"] == *id).count() != 1)
    {
        issue(
            &mut issues,
            "TVAL_SHIFT_SCOPES",
            root,
            "General and hospital employer rules must be distinct.",
        );
    }
    let known = sources(pkg);
    for scope in rows(p, "scopes") {
        let rates = &scope["rates"];
        if rows(rates, "sourceIds").is_empty()
            || rows(rates, "sourceIds")
                .iter()
                .any(|id| id.as_str().is_none_or(|id| !known.contains(id)))
        {
            issue(
                &mut issues,
                "TVAL_SHIFT_SOURCES",
                root,
                "Each employer rule needs known sources.",
            );
        }
        let valid_package = valid_date(s(pkg, "validFrom"))
            && (pkg["validTo"].is_null() || valid_date(s(pkg, "validTo")));
        let mut valid = valid_package;
        let mut expected = Some(s(pkg, "validFrom").to_owned());
        let mut periods: Vec<_> = rows(rates, "periods").iter().collect();
        periods.sort_by_key(|p| s(p, "validFrom"));
        if periods.is_empty() {
            valid = false;
        }
        if valid {
            for period in periods {
                if !valid_date(s(period, "validFrom"))
                    || expected.as_deref() != Some(s(period, "validFrom"))
                    || !period["validTo"].is_null()
                        && (!valid_date(s(period, "validTo"))
                            || s(period, "validTo") < s(period, "validFrom"))
                {
                    valid = false;
                    break;
                }
                expected = after(&period["validTo"]);
                if [
                    "shiftMonthlyCents",
                    "shiftHourlyCents",
                    "alternatingMonthlyCents",
                    "alternatingHourlyCents",
                ]
                .iter()
                .any(|key| {
                    let value = n(period, key);
                    !value.is_finite()
                        || value.fract() != 0.0
                        || value.abs() > crate::money::MAX_SAFE_INTEGER as f64
                        || value <= 0.0
                }) {
                    issue(
                        &mut issues,
                        "TVAL_SHIFT_RATE",
                        root,
                        "All four employee reference amounts must be positive cents.",
                    );
                }
            }
        }
        if !valid || expected != after(&pkg["validTo"]) {
            issue(
                &mut issues,
                "TVAL_SHIFT_COVERAGE",
                root,
                "Each scope must cover every package day exactly once.",
            );
        }
    }
    issues
}
pub(super) fn tval_premium(pkg: &Value) -> Vec<ValidationIssue> {
    let mut issues = vec![];
    let Some(p) = pkg["rules"]
        .get("tvalTimePremiumPolicy")
        .filter(|p| truth(Some(p)))
    else {
        return issues;
    };
    let root = "/rules/tvalTimePremiumPolicy";
    if n(pkg, "engineContractVersion") != 13.0
        || pkg["packageId"] != "tval-pflege-tdl"
        || pkg["rules"]["selection"]["engineId"] != "tval-pflege-v1"
    {
        issue(
            &mut issues,
            "TVAL_PREMIUM_CONTRACT",
            root,
            "Training premiums require the TVA-L contract.",
        );
    }
    if s(pkg, "validFrom") < "2023-10-01" {
        issue(
            &mut issues,
            "TVAL_PREMIUM_DATE",
            root,
            "Earlier coverage requires the historical night-minimum rule.",
        );
    }
    let known = sources(pkg);
    for id in rows(p, "sourceIds") {
        if id.as_str().is_none_or(|id| !known.contains(id)) {
            issue(
                &mut issues,
                "UNKNOWN_SOURCE_ID",
                format!("{root}/sourceIds"),
                format!("Unknown source: {}", id.as_str().unwrap_or("")),
            );
        }
    }
    for key in ["nightWindow", "preHolidayWindow", "saturdayWindow"] {
        if p[key]["startMinute"] == p[key]["endMinute"] {
            issue(
                &mut issues,
                "TVAL_PREMIUM_WINDOW",
                root,
                "Empty or ambiguous premium window.",
            );
        }
    }
    for day in rows(p, "preHolidayMonthDays") {
        if !day
            .as_str()
            .is_some_and(|day| valid_date(&format!("2000-{day}")))
        {
            issue(
                &mut issues,
                "TVAL_PREMIUM_MONTH_DAY",
                format!("{root}/preHolidayMonthDays"),
                "Invalid recurring date.",
            );
        }
    }
    if n(p, "holidayWithoutTimeOffBasisPoints") < n(p, "holidayWithTimeOffBasisPoints") {
        issue(
            &mut issues,
            "TVAL_PREMIUM_HOLIDAY",
            root,
            "Holiday time-off rates are reversed.",
        );
    }
    issues
}
pub(super) fn tval_overtime(pkg: &Value) -> Vec<ValidationIssue> {
    let mut issues = vec![];
    let Some(p) = pkg["rules"]
        .get("tvalOvertimePolicy")
        .filter(|p| truth(Some(p)))
    else {
        return issues;
    };
    let root = "/rules/tvalOvertimePolicy";
    if n(pkg, "engineContractVersion") != 13.0
        || pkg["packageId"] != "tval-pflege-tdl"
        || pkg["rules"]["selection"]["engineId"] != "tval-pflege-v1"
    {
        issue(
            &mut issues,
            "TVAL_OVERTIME_CONTRACT",
            root,
            "Training overtime requires the TVA-L contract.",
        );
    }
    let known = sources(pkg);
    for id in rows(p, "sourceIds") {
        if id.as_str().is_none_or(|id| !known.contains(id)) {
            issue(
                &mut issues,
                "UNKNOWN_SOURCE_ID",
                format!("{root}/sourceIds"),
                format!("Unknown source: {}", id.as_str().unwrap_or("")),
            );
        }
    }
    issues
}
pub(super) fn tval_care(pkg: &Value) -> Vec<ValidationIssue> {
    let mut issues = vec![];
    let Some(p) = pkg["rules"]
        .get("tvalCareAllowancePolicy")
        .filter(|p| truth(Some(p)))
    else {
        return issues;
    };
    let root = "/rules/tvalCareAllowancePolicy";
    if n(pkg, "engineContractVersion") != 13.0
        || pkg["packageId"] != "tval-pflege-tdl"
        || pkg["rules"]["selection"]["engineId"] != "tval-pflege-v1"
    {
        issue(
            &mut issues,
            "TVAL_CARE_CONTRACT",
            root,
            "Activity allowances require the TVA-L training contract.",
        );
    }
    let known = sources(pkg);
    for id in rows(p, "sourceIds") {
        if id.as_str().is_none_or(|id| !known.contains(id)) {
            issue(
                &mut issues,
                "UNKNOWN_SOURCE_ID",
                root,
                format!(
                    "Unknown activity-allowance source: {}",
                    id.as_str().unwrap_or("")
                ),
            );
        }
    }
    if n(p, "clinicalLowerMonthlyCents") > n(p, "clinicalHigherMonthlyCents") {
        issue(
            &mut issues,
            "TVAL_CARE_RATE_ORDER",
            root,
            "The higher clinical rate cannot be lower.",
        );
    }
    issues
}
