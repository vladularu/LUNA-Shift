use super::*;
pub(super) fn special_amount(line: &Value) -> Value {
    if line["complete"] != true || line["baseAmountCents"].is_null() {
        return Value::Null;
    }
    let callout = nullish(line, "calloutPay");
    if callout.is_some_and(|c| {
        [
            "baseAmountCents",
            "overtimePremiumCents",
            "timePremiumCents",
        ]
        .iter()
        .any(|key| c[*key].is_null())
    }) {
        return Value::Null;
    }
    json!(
        number(&line["baseAmountCents"])
            + callout
                .map(|c| number(&c["baseAmountCents"]))
                .unwrap_or(0.0)
            + callout
                .map(|c| number(&c["overtimePremiumCents"]))
                .unwrap_or(0.0)
            + callout
                .map(|c| number(&c["timePremiumCents"]))
                .unwrap_or(0.0)
    )
}
pub(super) fn earned_rows(
    pay: Option<&Value>,
    classification: Option<&Value>,
    shifts: &[Value],
    filter: Option<&str>,
    ranks: &CollationRanks,
) -> Result<Vec<Value>, EngineError> {
    let premiums = salary_rows(pay, classification, shifts, filter, ranks)?;
    let duties = pay
        .map(|p| array(&p["specialDutyBreakdowns"]))
        .unwrap_or_default();
    if classification.is_none() && filter.is_some_and(|f| f.starts_with("sfn:")) {
        let category = filter.unwrap().strip_prefix("sfn:").unwrap();
        let mut ordinary = salary_rows(pay, None, shifts, None, ranks)?;
        for row in &mut ordinary {
            row["amountCents"] = json!(
                array(&row["premiumLines"])
                    .iter()
                    .filter(
                        |line| crate::net::premium_trace::premium_category(text(line, "key"))
                            == category
                    )
                    .fold(0.0, |total, line| total
                        + js_round(number(&line["amount"]) * 100.0))
            );
        }
        for line in duties {
            let traces =
                crate::pay::special::trace::payroll_traces_from_lines(std::slice::from_ref(line));
            let amount = traces
                .iter()
                .flat_map(|t| array(&t["payments"]))
                .filter(|payment| {
                    payment
                        .get("category")
                        .filter(|v| !v.is_null())
                        .and_then(Value::as_str)
                        .unwrap_or_else(|| {
                            if payment["kind"] == "NIGHT" {
                                "NIGHT"
                            } else {
                                "OTHER"
                            }
                        })
                        == category
                })
                .fold(0.0, |total, payment| {
                    total + number(&payment["amountCents"])
                });
            let mut row = json!({"id":line["shiftId"],"date":line["date"],"tax":null,"premiumLines":[],"amountCents":amount});
            with_shift(&mut row, shift_by_id(shifts, text(line, "shiftId")));
            ordinary.push(row);
        }
        ordinary.retain(|r| number(&r["amountCents"]) > 0.0);
        return sort(ordinary, ranks, false, "id");
    }
    if filter.is_some_and(|f| f != "special-duty") {
        return Ok(premiums);
    }
    let mut rows = if filter.is_none() {
        premiums
            .iter()
            .filter(|r| !duties.iter().any(|d| d["shiftId"] == r["id"]))
            .cloned()
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    for line in duties {
        let tax = premiums
            .iter()
            .find(|r| r["id"] == line["shiftId"])
            .map(|r| &r["tax"])
            .unwrap_or(&Value::Null);
        let mut row = json!({"id":line["shiftId"],"date":line["date"],"tax":tax,"premiumLines":[],"amountCents":special_amount(line),"specialDuty":line});
        with_shift(&mut row, shift_by_id(shifts, text(line, "shiftId")));
        rows.push(row);
    }
    sort(rows, ranks, true, "id")
}
