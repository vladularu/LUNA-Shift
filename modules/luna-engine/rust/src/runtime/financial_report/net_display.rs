//! Original display precision over native net results, separate from tax math.
use crate::runtime::report::ReportIssue;
use serde_json::{Value, json};
pub(crate) fn present(pay: &Value) -> Result<Value, ReportIssue> {
    let cents = pay["netCents"]
        .as_f64()
        .filter(|n| n.is_finite())
        .ok_or_else(|| ReportIssue::new("NET_AMOUNT_DISPLAY_INVALID"))?;
    let provisional = pay["calculationBasis"]["status"] == "PREVIOUS_YEAR_ESTIMATE";
    // Preserve the original display expression's division/multiplication order.
    let euros = if provisional {
        crate::report::financial::presentation::js_round(cents / 1000.0) * 10.0
    } else {
        cents / 100.0
    };
    if !euros.is_finite() {
        return Err(ReportIssue::new("NET_AMOUNT_DISPLAY_INVALID"));
    }
    // JSON.stringify normalizes numeric -0 on a later host-cache roundtrip.
    Ok(
        json!({"euros":euros,"fractionDigits":if provisional{0}else{2},"negativeZero":euros==0.0&&euros.is_sign_negative()}),
    )
}
pub(crate) fn timing_label(forecast: &Value) -> Result<Option<String>, ReportIssue> {
    if forecast
        .pointer("/payrollTimingEstimate/crossYearTaxEstimate")
        .is_none_or(|v| !crate::net::js_truthy(v))
    {
        return Ok(None);
    }
    // The existing native note builder already preserves this exact source label.
    Ok(super::detail_panels::basis_notes(forecast)?
        .into_iter()
        .next())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn original_amount_precision_and_negative_zero_match_every_frozen_boundary() {
        let source: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../reference/premium-deduction-display-golden.json"
        )))
        .unwrap();
        let cases = source["netDisplayBoundary"].as_array().unwrap();
        assert_eq!(cases.len(), 63);
        for (index, case) in cases.iter().enumerate() {
            let mut pay = case["pay"].clone();
            if case["inputNegativeZero"] == true {
                pay["netCents"] = serde_json::json!(-0.0);
            }
            let actual = present(&pay).unwrap();
            let number = actual["euros"].as_f64().unwrap();
            let expected = case["expected"]["euros"].as_f64().unwrap();
            assert_eq!(number, expected, "amount boundary {index}");
            if number != 0.0 {
                assert_eq!(
                    number.to_bits(),
                    expected.to_bits(),
                    "exact float boundary {index}"
                );
            }
            assert_eq!(
                number.is_sign_negative() && number == 0.0,
                case["negativeZero"].as_bool().unwrap(),
                "signed zero boundary {index}"
            );
            assert_eq!(
                actual["negativeZero"], case["negativeZero"],
                "cache-stable sign boundary {index}"
            );
            assert_eq!(
                actual["fractionDigits"], case["expected"]["fractionDigits"],
                "precision boundary {index}"
            );
        }
    }
    #[test]
    fn original_year_change_labels_reuse_all_frozen_note_scenarios() {
        let source: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../reference/premium-deduction-display-golden.json"
        )))
        .unwrap();
        let cases = source["metadata"].as_array().unwrap();
        assert_eq!(cases.len(), 24);
        for case in cases {
            let forecast = &case["forecast"];
            let expected = if crate::net::js_truthy(
                &forecast["payrollTimingEstimate"]["crossYearTaxEstimate"],
            ) {
                case["expected"]["basisNotes"]
                    .as_array()
                    .unwrap()
                    .first()
                    .and_then(Value::as_str)
            } else {
                None
            };
            assert_eq!(timing_label(forecast).unwrap().as_deref(), expected);
        }
        assert!(present(&serde_json::json!({"netCents":null})).is_err());
        assert!(present(&serde_json::json!({"netCents":"0"})).is_err());
    }
}
