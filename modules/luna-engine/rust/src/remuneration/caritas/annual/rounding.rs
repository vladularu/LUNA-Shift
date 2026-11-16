use super::*;
use num_bigint::BigInt;
use num_traits::ToPrimitive;
const DOCUMENTS: [(&str, &str, &str); 2] = [
    (
        "a4f8dea02fb84ba4f203a753bd362d82dec8ad8953f3befed99ac65e65ec2637",
        "https://www.lambertus.de/media/wysiwyg/websites/lam_lambertus/AVR-PDF_Version_2025.pdf",
        "2025-07-01",
    ),
    (
        "cb6fc32981eb120d5c05e68d6563725436001409e9bc728bc47d52d08d705aa7",
        "https://www.lambertus.de/media/wysiwyg/websites/lam_lambertus/AVR_Online-PDF_2026_final.pdf",
        "2026-03-19",
    ),
];
pub fn round_amount(
    pkg: &RulePackage,
    entitlement_year: &Value,
    basis: &Value,
    factor: &Value,
) -> Result<Value, BaseError> {
    let source_id = format!(
        "caritas-avr-jsz-{}",
        entitlement_year.as_f64().unwrap_or(f64::NAN)
    );
    let source = pkg
        .sources()
        .and_then(Value::as_array)
        .and_then(|sources| sources.iter().find(|s| s["id"] == source_id));
    let document = source.and_then(|source| {
        DOCUMENTS
            .iter()
            .find(|document| source["sha256"] == document.0)
            .map(|(_, url, date)| (*url, *date))
    });
    let Some((source, _)) = source.zip(document).filter(|(s, (url, date))| {
        rows(&basis["annualRule"], "sourceIds")
            .iter()
            .any(|id| *id == source_id)
            && s["url"] == *url
            && s["documentDate"] == *date
            && (entitlement_year.as_f64() != Some(2026.0) || s["documentDate"] == "2026-03-19")
    }) else {
        return Ok(unavailable("ROUNDING_SOURCE_MISSING"));
    };
    let n = integer(
        &basis["meanMonthlyBasis"]["numeratorCents"],
        0,
        MAX_SAFE_INTEGER,
    );
    let d = integer(
        &basis["meanMonthlyBasis"]["denominator"],
        1,
        MAX_SAFE_INTEGER,
    );
    let retained = integer(&factor["numerator"], 0, 12);
    let (Some(n), Some(d), Some(retained)) = (n, d, retained) else {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    };
    if factor["denominator"].as_f64() != Some(12.0) {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    }
    let rate = integer(&basis["annualRule"]["rateBasisPoints"], 0, MAX_SAFE_INTEGER)
        .ok_or(BaseError::InvalidCalculation)?;
    let numerator = BigInt::from(n) * BigInt::from(rate) * BigInt::from(retained);
    let denominator = BigInt::from(d) * BigInt::from(10000) * BigInt::from(12);
    let rounded = (&numerator * BigInt::from(2) + &denominator) / (&denominator * BigInt::from(2));
    let Some(amount) = rounded.to_i64().filter(|n| *n <= MAX_SAFE_INTEGER) else {
        return Ok(unavailable("AMOUNT_OVERFLOW"));
    };
    Ok(
        json!({"kind":"rounded-annual-payment-amount","amountCents":amount,"exactAmountCents":{"numerator":numerator.to_string(),"denominator":denominator.to_string()},"rateBasisPoints":rate,"roundingEvidence":{"policy":"AVR_ANLAGE_1_X_E_HALF_UP_FINAL_CENT","sourceId":source["id"],"sourceSection":"Anlage 1 Abschnitt X Absatz e","sourceSha256":source["sha256"]}}),
    )
}
