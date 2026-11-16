use super::*;
fn classified_rows(classification: Option<&Value>) -> Vec<(String, Value)> {
    let mut rows: Vec<(String, Value)> = Vec::new();
    for tax in classification
        .map(|c| array(&c["shifts"]))
        .unwrap_or_default()
    {
        let id = nullish(tax, "sourceShiftId")
            .and_then(Value::as_str)
            .unwrap_or_else(|| text(tax, "shiftId"))
            .to_owned();
        if let Some((_, previous)) = rows.iter_mut().find(|(key, _)| *key == id) {
            let mut categories: Vec<Value> = Vec::new();
            for premium in array(&previous["premiumBreakdown"]) {
                if let Some(before) = categories
                    .iter_mut()
                    .find(|p| p["category"] == premium["category"])
                {
                    *before = premium.clone();
                } else {
                    categories.push(premium.clone());
                }
            }
            for premium in array(&tax["premiumBreakdown"]) {
                if let Some(before) = categories
                    .iter_mut()
                    .find(|p| p["category"] == premium["category"])
                {
                    *before = json!({"category":premium["category"],"paidPremiumCents":number(&before["paidPremiumCents"])+number(&premium["paidPremiumCents"]),"taxFreeCents":number(&before["taxFreeCents"])+number(&premium["taxFreeCents"]),"taxablePremiumCents":number(&before["taxablePremiumCents"])+number(&premium["taxablePremiumCents"])});
                } else {
                    categories.push(premium.clone());
                }
            }
            for field in [
                "workedMinutes",
                "nightMinutes",
                "dayMinutes",
                "paidPremiumCents",
                "taxFreeCents",
                "socialInsuranceFreeCents",
                "taxablePremiumCents",
                "socialInsuranceLiablePremiumCents",
            ] {
                previous[field] = json!(number(&previous[field]) + number(&tax[field]));
            }
            previous["shiftId"] = json!(id);
            previous["premiumBreakdown"] = json!(categories);
        } else {
            let mut tax = tax.clone();
            if nullish(&tax, "sourceShiftId")
                .and_then(Value::as_str)
                .is_some_and(|s| !s.is_empty())
            {
                tax["shiftId"] = json!(id);
            }
            rows.push((id, tax));
        }
    }
    rows
}
pub(crate) fn salary_rows(
    pay: Option<&Value>,
    classification: Option<&Value>,
    shifts: &[Value],
    filter: Option<&str>,
    ranks: &CollationRanks,
) -> Result<Vec<Value>, EngineError> {
    let classified = classified_rows(classification);
    let raw = pay
        .map(|pay| breakdown(array(&pay["shiftBreakdowns"]), shifts, filter, ranks))
        .transpose()?;
    let raw_rows = raw.as_ref().map(|r| array(&r["rows"])).unwrap_or_default();
    let category_filter = filter
        .and_then(|s| s.strip_prefix("sfn:"))
        .filter(|s| !s.is_empty());
    let mut ids: Vec<&str> = Vec::new();
    if filter.is_none() {
        for id in raw_rows
            .iter()
            .map(|r| text(r, "shiftId"))
            .chain(classified.iter().map(|(id, _)| id.as_str()))
        {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    } else if category_filter.is_some() || raw.is_none() {
        ids.extend(classified.iter().map(|(id, _)| id.as_str()));
    } else {
        ids.extend(raw_rows.iter().map(|r| text(r, "shiftId")));
    }
    let mut rows = Vec::new();
    for id in ids {
        let detail = raw_rows.iter().find(|r| text(r, "shiftId") == id);
        let tax = classified.iter().find(|(key, _)| key == id).map(|(_, v)| v);
        let shift = shift_by_id(shifts, id);
        let lines = detail
            .map(|r| array(&r["premiumLines"]))
            .unwrap_or_default();
        let amount = if let Some(category) = category_filter {
            tax.map(|t| {
                sum(
                    array(&t["premiumBreakdown"])
                        .iter()
                        .filter(|p| text(p, "category") == category),
                    "paidPremiumCents",
                )
            })
            .unwrap_or(0.0)
        } else if let Some(tax) = tax.filter(|_| filter.is_none()) {
            number(&tax["paidPremiumCents"])
        } else if detail.is_some() {
            js_round(premiums::premium_amount(lines) * 100.0)
        } else {
            tax.map(|t| number(&t["paidPremiumCents"])).unwrap_or(0.0)
        };
        if amount <= 0.0 {
            continue;
        }
        let date = detail
            .and_then(|r| nullish(r, "date"))
            .or_else(|| shift.and_then(|s| nullish(s, "date")))
            .cloned()
            .unwrap_or(json!(""));
        let mut row =
            json!({"id":id,"date":date,"tax":tax,"premiumLines":lines,"amountCents":amount});
        with_shift(&mut row, shift);
        rows.push(row);
    }
    sort(rows, ranks, true, "id")
}
pub(crate) fn service_summary(
    pay: Option<&Value>,
    classification: Option<&Value>,
    shifts: &[Value],
    include_special: bool,
    filter: Option<&str>,
    ranks: &CollationRanks,
) -> Result<Value, EngineError> {
    let all = if include_special {
        earned_rows(pay, classification, shifts, None, ranks)?
    } else {
        salary_rows(pay, classification, shifts, None, ranks)?
    };
    let special = all
        .iter()
        .filter(|r| nullish(r, "specialDuty").is_some())
        .collect::<Vec<_>>();
    let has_special = pay.is_some_and(|pay| {
        array(&pay["specialDutyBreakdowns"]).iter().any(|line| {
            nullish(&line["standbyPay"], "payrollTrace").is_some()
                || !array(&line["calloutPay"]["payrollTraces"]).is_empty()
        })
    });
    let mut categories = if has_special && (classification.is_some() || include_special) {
        let mut categories = Vec::new();
        for (category, label) in CATEGORIES {
            let key = format!("sfn:{category}");
            let amount = if include_special {
                sum(
                    earned_rows(pay, classification, shifts, Some(&key), ranks)?.iter(),
                    "amountCents",
                )
            } else {
                classification
                    .map(|c| {
                        array(&c["shifts"]).iter().fold(0.0, |total, s| {
                            total
                                + sum(
                                    array(&s["premiumBreakdown"])
                                        .iter()
                                        .filter(|p| text(p, "category") == category),
                                    "paidPremiumCents",
                                )
                        })
                    })
                    .unwrap_or(0.0)
            };
            if amount > 0.0 {
                categories.push(json!({"key":key,"label":label,"amount":amount}));
            }
        }
        categories
    } else if let Some(pay) = pay {
        array(&breakdown(array(&pay["shiftBreakdowns"]), shifts, None, ranks)?["categories"])
            .iter()
            .filter(|c| number(&c["amount"]) > 0.0)
            .cloned()
            .collect()
    } else {
        Vec::new()
    };
    if !special.is_empty() {
        categories.push(json!({"key":"special-duty","label":"Bereitschaften","amount":0}));
    }
    let active = filter.filter(|filter| categories.iter().any(|c| text(c, "key") == *filter));
    let rows = if include_special {
        earned_rows(pay, classification, shifts, active, ranks)?
    } else {
        salary_rows(pay, classification, shifts, active, ranks)?
    };
    let total = if !special.is_empty() || active.is_some() {
        if rows.iter().any(|r| r["amountCents"].is_null()) {
            Value::Null
        } else {
            json!(sum(rows.iter(), "amountCents"))
        }
    } else {
        classification
            .map(|c| c["paidPremiumCents"].clone())
            .unwrap_or_else(|| {
                json!(js_round(
                    pay.map(|p| number(&p["timePremiumAmount"])).unwrap_or(0.0) * 100.0
                ))
            })
    };
    let category = active.map(|filter| {
        filter
            .strip_prefix("sfn:")
            .unwrap_or_else(|| crate::net::premium_trace::premium_category(filter))
    });
    let lines = classification
        .map(|c| array(&c["shifts"]))
        .unwrap_or_default()
        .iter()
        .flat_map(|s| array(&s["premiumBreakdown"]))
        .filter(|p| category.is_some_and(|category| text(p, "category") == category))
        .collect::<Vec<_>>();
    let free = if let Some(classification) = classification {
        if active.is_none() {
            classification["taxFreeCents"].clone()
        } else if active == Some("special-duty") {
            json!(special.iter().fold(0.0, |total, row| total
                + number(&row["tax"]["taxFreeCents"])))
        } else if total.as_f64() == Some(sum(lines.iter().copied(), "paidPremiumCents")) {
            json!(sum(lines.iter().copied(), "taxFreeCents"))
        } else {
            Value::Null
        }
    } else {
        Value::Null
    };
    Ok(
        json!({"categories":categories,"activeFilter":active,"rows":rows,"totalCents":total,"taxFreeCents":free}),
    )
}
pub(crate) fn premium_summary(classification: &Value) -> Value {
    let rows = CATEGORIES
        .iter()
        .map(|(category, label)| {
            let lines = array(&classification["shifts"])
                .iter()
                .flat_map(|s| array(&s["premiumBreakdown"]))
                .filter(|p| text(p, "category") == *category)
                .collect::<Vec<_>>();
            let paid = sum(lines.iter().copied(), "paidPremiumCents");
            let free = sum(lines.iter().copied(), "taxFreeCents");
            json!({"category":category,"label":label,"paid":paid,"free":free,"taxable":paid-free})
        })
        .collect::<Vec<_>>();
    let relevant = rows
        .iter()
        .filter(|r| number(&r["paid"]) > 0.0)
        .collect::<Vec<_>>();
    json!({"rows":rows,"relevant":relevant,"paidPremiumCents":classification["paidPremiumCents"],"taxFreeCents":classification["taxFreeCents"],"socialInsuranceFreeCents":classification["socialInsuranceFreeCents"],"socialInsuranceLiablePremiumCents":number(&classification["paidPremiumCents"])-number(&classification["socialInsuranceFreeCents"])})
}
