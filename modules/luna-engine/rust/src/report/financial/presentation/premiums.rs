use super::*;
pub(super) fn premium_amount(lines: &[Value]) -> f64 {
    lines.iter().fold(0.0, |sum, line| {
        sum + js_round(number(&line["amount"]) * 100.0)
    }) / 100.0
}
pub(super) fn breakdown(
    breakdowns: &[Value],
    shifts: &[Value],
    filter: Option<&str>,
    ranks: &CollationRanks,
) -> Result<Value, EngineError> {
    let mut categories: Vec<Value> = Vec::new();
    for row in breakdowns {
        for line in array(&row["premiumLines"]) {
            let key = text(line, "key");
            let cents = js_round(number(&line["amount"]) * 100.0);
            if let Some(category) = categories.iter_mut().find(|c| text(c, "key") == key) {
                category["cents"] = json!(number(&category["cents"]) + cents);
            } else {
                let label = match key {
                    "night" => json!("Nacht"),
                    "sunday" => json!("Sonntag"),
                    "holiday" => json!("Feiertag"),
                    "saturday" => json!("Samstag"),
                    "preholiday" => json!("Vorfeiertag"),
                    _ => line["label"].clone(),
                };
                categories.push(json!({"key":key,"label":label,"cents":cents}));
            }
        }
    }
    let active = filter.filter(|filter| categories.iter().any(|c| text(c, "key") == *filter));
    let rows = breakdowns
        .iter()
        .filter_map(|source| {
            let lines = array(&source["premiumLines"])
                .iter()
                .filter(|line| active.is_none_or(|filter| text(line, "key") == filter))
                .cloned()
                .collect::<Vec<_>>();
            if lines.is_empty() {
                return None;
            }
            let mut row = source.clone();
            row["premiumLines"] = json!(lines);
            with_shift(&mut row, shift_by_id(shifts, text(source, "shiftId")));
            Some(row)
        })
        .collect();
    let rows = sort(rows, ranks, true, "shiftId")?;
    let amount = rows
        .iter()
        .flat_map(|row| array(&row["premiumLines"]))
        .fold(0.0, |total, line| {
            total + js_round(number(&line["amount"]) * 100.0)
        })
        / 100.0;
    for category in &mut categories {
        let cents = category.as_object_mut().unwrap().remove("cents").unwrap();
        category["amount"] = json!(number(&cents) / 100.0);
    }
    Ok(json!({"categories":categories,"activeFilter":active,"rows":rows,"amount":amount}))
}
