use super::*;
use crate::{
    remuneration::tariff_annual::{
        TariffAnnualError,
        model::ClaimVersion,
        saved::{ValidatedSavedClaims, validate_saved_tariff_annual_claims},
    },
    rules::RuleResolver,
};
pub fn payout_month(
    month: &str,
    raw: &Value,
    resolver: &RuleResolver,
    validator: &impl NativePackageValidator,
) -> Result<Value, TariffAnnualError> {
    if crate::input::calendar::require_local_month(&json!(month)).is_err() {
        return Ok(unavailable("INVALID_MONTH"));
    }
    let Ok(claims) = validate_saved_tariff_annual_claims(raw) else {
        return Ok(unavailable("INVALID_CLAIMS"));
    };
    payout_month_checked(month, &claims, resolver, validator)
}
/// Production snapshots retain this checked owner across all cash months; no repeated claim decoding.
pub fn payout_month_checked(
    month: &str,
    claims: &ValidatedSavedClaims,
    resolver: &RuleResolver,
    validator: &impl NativePackageValidator,
) -> Result<Value, TariffAnnualError> {
    if crate::input::calendar::require_local_month(&json!(month)).is_err() {
        return Ok(unavailable("INVALID_MONTH"));
    }
    let mut positions = Vec::new();
    let mut unresolved = Vec::new();
    let mut total = 0i128;
    for saved in claims.records() {
        let claim = saved.claim.data();
        if saved.revoked
            || claim.version != ClaimVersion::V3
            || !claim.selection.package_id.starts_with("avr-caritas-p-")
        {
            continue;
        }
        if let Some(actual) = &saved.actual_payment {
            if actual.payout_month == month {
                total += i128::from(actual.gross_cents);
                positions.push(json!({"claimId":claim.id,"entitlementYear":claim.year,"payoutMonth":month,"amountCents":actual.gross_cents,"origin":"actual","sourceIds":[]}));
            }
            continue;
        }
        let estimate = draft::draft_from_checked(resolver, &saved.claim, validator)?;
        if estimate["status"] != "estimated"
            || estimate["amountCents"].is_null()
            || estimate["payoutMonth"].is_null()
        {
            unresolved.push(claim.id.clone());
            continue;
        }
        if estimate["payoutMonth"] == month {
            total += i128::from(
                estimate["amountCents"]
                    .as_i64()
                    .ok_or(TariffAnnualError::Rule)?,
            );
            positions.push(json!({"claimId":claim.id,"entitlementYear":claim.year,"payoutMonth":month,"amountCents":estimate["amountCents"],"origin":"estimated","sourceIds":estimate["sourceIds"]}));
        }
    }
    if total > i128::from(MAX_SAFE_INTEGER) {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    }
    Ok(
        json!({"kind":"draft-known-payments","month":month,"knownSubtotalCents":total as i64,"complete":false,"positions":positions,"unresolvedClaimIds":unresolved}),
    )
}
