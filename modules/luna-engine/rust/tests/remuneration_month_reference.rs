#[path = "support/value_pool.rs"]
mod value_pool;
use luna_engine::{
    remuneration::{
        annual::tariff::TariffAnnualComposeError,
        base::calculation::{AnnexAMonthConfirmation, SueMonthConfirmation},
        base::prepared::PaidAbsenceIndex,
        draft_facts::{
            model::ConfirmationKind, month::validate_saved_draft_confirmation,
            premium::validate_saved_annex_a_premium_facts,
        },
        month::{
            MonthlyRemunerationError,
            calculation::{
                calculate_assessed_monthly_remuneration,
                calculate_assessed_monthly_remuneration_prepared,
                calculate_dated_monthly_remuneration,
                calculate_dated_monthly_remuneration_prepared,
            },
            input::*,
        },
        overtime::prepared::OvertimeAllocationIndex,
        tariff_annual::saved::validate_saved_tariff_annual_claims,
    },
    rules::RuleResolver,
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};
fn rows<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value[key].as_array().map(Vec::as_slice).unwrap_or(&[])
}
fn evaluate(
    raw: &Value,
    operation: &str,
    resolver: &RuleResolver,
    use_prepared: bool,
) -> Result<Value, MonthlyRemunerationError> {
    let work = Arc::new(raw["workProfile"].clone());
    let paid_index = use_prepared
        .then(|| PaidAbsenceIndex::new(Arc::new(rows(raw, "paidAbsences").to_vec())))
        .transpose()?;
    let overtime_index = use_prepared
        .then(|| {
            OvertimeAllocationIndex::new(Arc::new(rows(raw, "savedOvertimeAllocations").to_vec()))
        })
        .transpose()?;
    let empty = json!([]);
    let claims = validate_saved_tariff_annual_claims(
        raw.get("tariffAnnualClaims")
            .filter(|v| !v.is_null())
            .unwrap_or(&empty),
    )
    .map_err(TariffAnnualComposeError::from)?;
    let annex = rows(raw, "savedAnnexAConfirmations")
        .iter()
        .map(|v| validate_saved_draft_confirmation(v, ConfirmationKind::AnnexA))
        .collect::<Result<Vec<_>, _>>()?;
    let premium = rows(raw, "savedAnnexAPremiumFacts")
        .iter()
        .map(validate_saved_annex_a_premium_facts)
        .collect::<Result<Vec<_>, _>>()?;
    let sue = rows(raw, "savedSueConfirmations")
        .iter()
        .map(|v| validate_saved_draft_confirmation(v, ConfirmationKind::SueMonth))
        .collect::<Result<Vec<_>, _>>()?;
    let sue_allowances = rows(raw, "savedSueAllowanceConfirmations")
        .iter()
        .map(|v| validate_saved_draft_confirmation(v, ConfirmationKind::SueAllowance))
        .collect::<Result<Vec<_>, _>>()?;
    let allocations: BTreeMap<String, Vec<Value>> = raw
        .get("overtimeAllocations")
        .map(|v| serde_json::from_value(v.clone()).unwrap())
        .unwrap_or_default();
    let annex_override: Option<AnnexAMonthConfirmation> = raw
        .get("annexAConfirmation")
        .filter(|v| !v.is_null())
        .map(|v| serde_json::from_value(v.clone()).unwrap());
    let sue_override: Option<SueMonthConfirmation> = raw
        .get("sueConfirmation")
        .filter(|v| !v.is_null())
        .map(|v| serde_json::from_value(v.clone()).unwrap());
    let context = MonthContext {
        month: raw["month"].as_str().unwrap(),
        shifts: rows(raw, "shifts"),
        work_profile: &work,
        history: rows(raw, "history"),
    };
    let evidence = MonthEvidence {
        overtime_allocations: &allocations,
        saved_overtime_allocations: overtime_index.as_ref().map_or_else(
            || rows(raw, "savedOvertimeAllocations"),
            |i| i.raw().as_slice(),
        ),
        paid_absences: paid_index
            .as_ref()
            .map_or_else(|| rows(raw, "paidAbsences"), |i| i.raw().as_slice()),
        actual_annual_payments: rows(raw, "actualAnnualPayments"),
        tariff_annual_claims: &claims,
        tvl_shift_work: rows(raw, "tvlShiftWork"),
        saved_annex_a_confirmations: &annex,
        saved_annex_a_premium_facts: &premium,
        annex_a_pause_details: rows(raw, "annexAPauseDetails"),
        annex_a_entries_complete: raw["annexAEntriesComplete"] == true,
        annex_a_pause_details_complete: raw["annexAPauseDetailsComplete"] == true,
        saved_sue_confirmations: &sue,
        saved_sue_allowance_confirmations: &sue_allowances,
    };
    let confirmations = MonthConfirmations {
        annex_a: annex_override.as_ref(),
        sue: sue_override.as_ref(),
    };
    let indices = paid_index.as_ref().zip(overtime_index.as_ref()).map(
        |(paid_absences, overtime_allocations)| PreparedMonthIndices {
            paid_absences,
            overtime_allocations,
        },
    );
    Ok(if operation == "assessed" {
        let input = AssessedMonthInput {
            context,
            evidence,
            confirmations,
            settings: &raw["settings"],
            decisions: rows(raw, "decisions"),
            legacy_decision: raw.get("legacyDecision").filter(|v| !v.is_null()),
        };
        serde_json::to_value(match indices {
            Some(indices) => {
                calculate_assessed_monthly_remuneration_prepared(&input, indices, resolver)?
            }
            None => calculate_assessed_monthly_remuneration(&input, resolver)?,
        })
        .unwrap()
    } else {
        let input = DatedMonthInput {
            context,
            evidence,
            confirmations,
            allowance_entitlements: rows(raw, "allowanceEntitlements"),
        };
        serde_json::to_value(match indices {
            Some(indices) => {
                calculate_dated_monthly_remuneration_prepared(&input, indices, resolver)?
            }
            None => calculate_dated_monthly_remuneration(&input, resolver)?,
        })
        .unwrap()
    })
}
fn difference(a: &Value, e: &Value, p: &str) -> String {
    match (a, e) {
        (Value::Object(a), Value::Object(e)) => {
            for (k, v) in e {
                if a.get(k) != Some(v) {
                    return difference(a.get(k).unwrap_or(&Value::Null), v, &format!("{p}.{k}"));
                }
            }
            format!("{p}:object keys")
        }
        (Value::Array(a), Value::Array(e)) => {
            for (i, (a, e)) in a.iter().zip(e).enumerate() {
                if a != e {
                    return difference(a, e, &format!("{p}[{i}]"));
                }
            }
            format!("{p}: lengths {} vs {}", a.len(), e.len())
        }
        _ => format!("{p}: actual {a}; expected {e}"),
    }
}
#[test]
fn complete_dated_and_assessed_months_match_original_source_from_raw_facts() {
    compare(false);
}
#[test]
fn snapshot_indices_preserve_complete_source_results() {
    compare(true);
}
fn compare(use_prepared: bool) {
    let data = value_pool::decode(include_str!(
        "../../reference/remuneration-month-golden.json"
    ));
    assert_eq!(
        data["sourceDigest"],
        "92f8505f38e00e19c45c4e7957ac1d559e2712fa9a59e769bab83467e6cbb0d9"
    );
    let resolvers: BTreeMap<String, RuleResolver> = data["catalogs"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(key, d)| {
            let catalog = serde_json::from_str(d["catalogJson"].as_str().unwrap()).unwrap();
            let history = d["historicalJson"]
                .as_str()
                .map(|s| serde_json::from_str(s).unwrap());
            let mut resolver = RuleResolver::new(
                catalog,
                serde_json::from_value(d["packageIds"].clone()).unwrap(),
                history,
            )
            .unwrap();
            if let Some(ranks) = d.get("collationRanks") {
                resolver =
                    resolver.with_collation_ranks(serde_json::from_value(ranks.clone()).unwrap());
            }
            (key.clone(), resolver)
        })
        .collect();
    let mut failures = vec![];
    let mut checked = 0;
    for case in data["cases"].as_array().unwrap() {
        let raw: Value = serde_json::from_str(case["inputJson"].as_str().unwrap()).unwrap();
        let result = evaluate(
            &raw,
            case["operation"].as_str().unwrap(),
            &resolvers[case["track"].as_str().unwrap()],
            use_prepared,
        );
        let actual = match result {
            Ok(value) => json!({"value":value}),
            Err(e) => json!({"error":{"name":e.class_name(),"message":e.to_string()}}),
        };
        checked += 1;
        if actual != case["expected"] {
            failures.push(format!(
                "{} {}",
                case["id"],
                difference(&actual, &case["expected"], "$")
            ));
        }
    }
    assert_eq!(checked, 4133);
    assert!(
        failures.is_empty(),
        "{} mismatches\n{}",
        failures.len(),
        failures
            .iter()
            .take(25)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n\n")
    );
    eprintln!("Full native monthly remuneration: {checked} exact complete source outputs/errors");
}
