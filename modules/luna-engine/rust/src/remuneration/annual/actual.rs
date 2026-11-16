use super::{AnnualError, integer};
use crate::input::trim_javascript;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActualOwnAnnualPayment<'a> {
    pub version: u8,
    pub payment_id: &'a str,
    pub entitlement_year: i32,
    pub payout_month: &'a str,
    pub title: &'a str,
    pub gross_cents: i64,
    pub revision: i64,
}
pub fn validate_actual_own_annual_payments(
    value: &Value,
) -> Result<Vec<ActualOwnAnnualPayment<'_>>, AnnualError> {
    let rows = value.as_array().ok_or(AnnualError::ActualOwn)?;
    validate_actual_own_annual_payment_rows(rows)
}
pub fn validate_actual_own_annual_payment_rows(
    rows: &[Value],
) -> Result<Vec<ActualOwnAnnualPayment<'_>>, AnnualError> {
    if rows.len() > 4096 {
        return Err(AnnualError::ActualOwn);
    }
    let mut seen = BTreeSet::new();
    let mut result = Vec::with_capacity(rows.len());
    for entry in rows {
        let keys = [
            "version",
            "paymentId",
            "entitlementYear",
            "payoutMonth",
            "title",
            "grossCents",
            "revision",
        ];
        let row = entry
            .as_object()
            .filter(|row| row.len() == keys.len() && keys.iter().all(|key| row.contains_key(*key)))
            .ok_or(AnnualError::ActualOwn)?;
        let id = row["paymentId"]
            .as_str()
            .filter(|id| {
                !id.is_empty()
                    && id.len() <= 80
                    && id.as_bytes()[0].is_ascii_alphanumeric()
                    && id
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
            })
            .ok_or(AnnualError::ActualOwn)?;
        let year = integer(&row["entitlementYear"])
            .filter(|year| (1900..=4099).contains(year))
            .ok_or(AnnualError::ActualOwn)? as i32;
        let month = row["payoutMonth"]
            .as_str()
            .filter(|month| {
                month.len() == 7
                    && month.as_bytes()[4] == b'-'
                    && month
                        .bytes()
                        .enumerate()
                        .all(|(i, b)| i == 4 || b.is_ascii_digit())
                    && *month >= "1900-01"
                    && *month <= "4099-12"
                    && month
                        .get(5..)
                        .and_then(|month| month.parse::<u8>().ok())
                        .is_some_and(|month| (1..=12).contains(&month))
            })
            .ok_or(AnnualError::ActualOwn)?;
        let title = row["title"]
            .as_str()
            .filter(|title| {
                !title.is_empty()
                    && trim_javascript(title) == *title
                    && title.encode_utf16().count() <= 100
                    && !title.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
            })
            .ok_or(AnnualError::ActualOwn)?;
        let gross = integer(&row["grossCents"])
            .filter(|n| (0..=1_000_000_000).contains(n))
            .ok_or(AnnualError::ActualOwn)?;
        let revision = integer(&row["revision"])
            .filter(|n| *n >= 1)
            .ok_or(AnnualError::ActualOwn)?;
        if integer(&row["version"]) != Some(1) || !seen.insert((year, id)) {
            return Err(AnnualError::ActualOwn);
        }
        result.push(ActualOwnAnnualPayment {
            version: 1,
            payment_id: id,
            entitlement_year: year,
            payout_month: month,
            title,
            gross_cents: gross,
            revision,
        });
    }
    Ok(result)
}
