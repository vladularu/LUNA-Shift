use super::*;
struct Candidate<'a> {
    name: &'a str,
    component: &'a str,
    letter: &'a str,
    full: f64,
    prior: f64,
    uses_table: bool,
}
pub fn advanced(
    pkg: &RulePackage,
    input: &Value,
    validator: &impl NativePackageValidator,
) -> Result<Value, BaseError> {
    let (b, w) = match super::allowances::preflight(pkg, input, validator)? {
        Ok(v) => v,
        Err(reason) => return Ok(unavailable(reason)),
    };
    if !js_truthy(&input["fullMonthEntitlementConfirmed"]) {
        return Ok(unavailable("FULL_MONTH_ENTITLEMENT_UNCONFIRMED"));
    }
    let selection = selected(
        pkg,
        input["variantId"].as_str().unwrap_or(""),
        input["regionId"].as_str().unwrap_or(""),
    );
    let Some(selection) = selection.filter(|s| {
        s.groups
            .iter()
            .any(|g| g.id == input["groupId"] && g.levels.iter().any(|l| l == &input["stepId"]))
    }) else {
        return Ok(unavailable("UNKNOWN_SELECTION"));
    };
    let policies: Vec<_> = rows(pkg.rules(), "avrddAdvancedAllowancePolicies")
        .iter()
        .filter(|r| {
            r["validFrom"]
                .as_str()
                .is_some_and(|d| d <= b.start.as_str())
                && (r["validTo"].is_null()
                    || r["validTo"].as_str().is_some_and(|d| b.end.as_str() <= d))
        })
        .collect();
    if policies.len() != 1 {
        return Ok(unavailable("MISSING_POLICY"));
    }
    let policy = policies[0];
    let names = ["practice", "palliativeOrWound", "intensive", "specialist"];
    let claims = &input["claims"];
    if names
        .iter()
        .any(|name| !js_truthy(&claims[*name]) || claims[*name]["status"] == "UNKNOWN")
    {
        return Ok(unavailable("ALLOWANCE_FACTS_UNCONFIRMED"));
    }
    let eligible = |name: &str| claims[name]["status"] == "ELIGIBLE_CONFIRMED";
    if names.iter().all(|name| !eligible(name)) {
        return Ok(unavailable("NO_ALLOWANCE_CONFIRMED"));
    }
    let group = &input["groupId"];
    let legacy = policy["phase"] == "LEGACY_EFG";
    let post = policy["phase"] == "POST_2026_07_EFGH";
    if ((eligible("practice") || eligible("palliativeOrWound"))
        && group != "eg7"
        && (legacy || eligible("palliativeOrWound")))
        || (eligible("practice") && post && group != "eg7" && group != "eg8")
        || (eligible("intensive") && group != "eg8")
        || (eligible("specialist") && group != "eg7" && group != "eg8")
    {
        return Ok(unavailable("GROUP_NOT_ELIGIBLE"));
    }
    if eligible("specialist") {
        if input["specialistContext"] == "UNKNOWN" {
            return Ok(unavailable("SPECIALIST_SCOPE_UNCONFIRMED"));
        }
        if legacy && input["specialistContext"] != "LEGACY_SCOPE_CONFIRMED" {
            return Ok(unavailable("SPECIALIST_SCOPE_UNSUPPORTED"));
        }
        if post
            && input["specialistContext"] == "HOSPICE_PALLIATIVE_CONFIRMED"
            && eligible("palliativeOrWound")
        {
            return Ok(unavailable("HOSPICE_PALLIATIVE_COMBINATION_UNRESOLVED"));
        }
    }
    for name in names {
        if !eligible(name) {
            continue;
        }
        if claims[name].get("priorIndividualMonthlyCents") == Some(&Value::Null) {
            return Ok(unavailable("INDIVIDUAL_OFFSET_UNKNOWN"));
        }
        if !claims[name]["priorIndividualMonthlyCents"]
            .as_f64()
            .is_some_and(|n| safe(n) && n >= 0.0)
        {
            return Ok(unavailable("INVALID_INDIVIDUAL_OFFSET"));
        }
    }
    let table = rows(pkg.rules(), "payTables")
        .iter()
        .find(|t| t["id"] == selection.region["payTableId"]);
    let needed = eligible("palliativeOrWound")
        || (eligible("practice") && policy["practiceMode"] == "HALF_EG8_DIFFERENCE");
    let difference = if needed {
        let entry = |group: &str| {
            table
                .map_or(&[][..], |t| rows(t, "entries"))
                .iter()
                .filter(|e| e["groupId"] == group && e["stepId"] == input["stepId"])
                .collect::<Vec<_>>()
        };
        let a = entry("eg7");
        let b = entry("eg8");
        if a.len() != 1
            || b.len() != 1
            || b[0]["monthlyCents"].as_f64() <= a[0]["monthlyCents"].as_f64()
        {
            return Ok(unavailable("MISSING_TABLE_VALUE"));
        }
        let n = (b[0]["monthlyCents"]
            .as_f64()
            .ok_or(BaseError::InvalidCalculation)?
            - a[0]["monthlyCents"]
                .as_f64()
                .ok_or(BaseError::InvalidCalculation)?)
            * policy["eg8DifferenceBasisPoints"]
                .as_f64()
                .ok_or(BaseError::InvalidCalculation)?;
        if !safe(n) {
            return Ok(unavailable("AMOUNT_OVERFLOW"));
        }
        Some(round_remuneration_cents(n, 10000.0)? as f64)
    } else {
        None
    };
    let practice = if policy["practiceMode"] == "FIXED_MONTHLY" {
        policy["practiceMonthlyCents"].as_f64()
    } else {
        difference
    };
    if eligible("practice") && practice.is_none() {
        return Ok(unavailable("MISSING_POLICY"));
    }
    let mut candidates = Vec::new();
    for (name, component, letter, full, uses_table) in [
        (
            "practice",
            "PRACTICE",
            "e",
            practice,
            policy["practiceMode"] == "HALF_EG8_DIFFERENCE",
        ),
        (
            "palliativeOrWound",
            "PALLIATIVE_OR_WOUND",
            if legacy { "e" } else { "f" },
            difference,
            true,
        ),
        (
            "intensive",
            "INTENSIVE",
            if legacy { "f" } else { "g" },
            policy["intensiveMonthlyCents"].as_f64(),
            false,
        ),
        (
            "specialist",
            "SPECIALIST",
            if legacy { "g" } else { "h" },
            policy["specialistMonthlyCents"].as_f64(),
            false,
        ),
    ] {
        if eligible(name) {
            candidates.push(Candidate {
                name,
                component,
                letter,
                full: full.ok_or(BaseError::InvalidCalculation)?,
                prior: claims[name]["priorIndividualMonthlyCents"]
                    .as_f64()
                    .ok_or(BaseError::InvalidCalculation)?,
                uses_table,
            });
        }
    }
    if let (Some(practice), Some(palliative)) = (
        candidates.iter().position(|c| c.name == "practice"),
        candidates
            .iter()
            .position(|c| c.name == "palliativeOrWound"),
    ) {
        if legacy {
            if candidates[practice].prior != candidates[palliative].prior {
                return Ok(unavailable("LEGACY_COMBINATION_AMBIGUOUS"));
            }
            candidates[practice].component = "LEGACY_EG7_COMBINED";
            candidates.remove(palliative);
        } else {
            if candidates[practice].full == candidates[palliative].full {
                return Ok(unavailable("EQUAL_RATE_COMBINATION_UNRESOLVED"));
            }
            let removed = if candidates[practice].full > candidates[palliative].full {
                palliative
            } else {
                practice
            };
            candidates.remove(removed);
        }
    }
    let mut positions = Vec::new();
    for c in candidates {
        let n = c.full * w;
        if !safe(n) {
            return Ok(unavailable("AMOUNT_OVERFLOW"));
        }
        let personal = round_remuneration_cents(n, 2340.0)?;
        let sources = if c.uses_table {
            source_ids(&[policy, table.unwrap_or(&Value::Null)])
        } else {
            rows(policy, "sourceIds").iter().collect()
        };
        positions.push(json!({"component":c.component,"legalLetter":c.letter,"fullTimeMonthlyCents":c.full as i64,"personalMonthlyCents":personal,"priorIndividualMonthlyCents":c.prior as i64,"tariffTopUpCents":(personal as f64-c.prior).max(0.0) as i64,"sourceIds":sources}));
    }
    Ok(
        json!({"kind":"draft-confirmed-advanced-allowances","status":"estimated","completeGross":false,"workMonth":input["workMonth"],"packageId":pkg.package_id,"versionId":pkg.version_id,"positions":positions}),
    )
}
