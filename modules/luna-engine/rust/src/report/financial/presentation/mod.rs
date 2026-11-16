//! Monetary presentation over native payroll outputs; locale comparison stays platform-owned.
mod deductions;
mod earned;
mod premiums;
mod services;
#[cfg(test)]
mod tests;
use crate::{EngineError, calendar::recurrence::CollationRanks};
pub(crate) use deductions::deductions;
use serde_json::{Value, json};
pub(crate) use services::{premium_summary, service_summary};
use std::collections::BTreeSet;

const CATEGORIES: [(&str, &str); 5] = [
    ("NIGHT", "Nacht"),
    ("SUNDAY", "Sonntag"),
    ("HOLIDAY", "Feiertag"),
    ("SATURDAY", "Samstag"),
    ("OTHER", "Weitere"),
];
fn array(value: &Value) -> &[Value] {
    value.as_array().map(Vec::as_slice).unwrap_or_default()
}
fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}
fn number(value: &Value) -> f64 {
    value.as_f64().unwrap_or(0.0)
}
fn sum<'a>(values: impl Iterator<Item = &'a Value>, field: &str) -> f64 {
    values.fold(0.0, |total, v| total + number(&v[field]))
}
// Math.round rounds negative ties toward +infinity. Adding 0.5 first would
// incorrectly round the representable value immediately below +0.5 upward.
pub(crate) fn js_round(value: f64) -> f64 {
    if value.fract() == -0.5 {
        value.ceil()
    } else {
        value.round()
    }
}
fn nullish<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.get(key).filter(|v| !v.is_null())
}
fn shift_by_id<'a>(shifts: &'a [Value], id: &str) -> Option<&'a Value> {
    shifts.iter().rev().find(|s| text(s, "id") == id)
}
fn with_shift(row: &mut Value, shift: Option<&Value>) {
    if let Some(shift) = shift {
        row["shift"] = shift.clone();
    }
}
fn sort(
    rows: Vec<Value>,
    ranks: &CollationRanks,
    start_time: bool,
    id_field: &str,
) -> Result<Vec<Value>, EngineError> {
    let mut ranked = rows
        .into_iter()
        .map(|row| {
            let date = ranks.rank(text(&row, "date"))?;
            let start = if start_time {
                ranks.rank(text(&row["shift"], "startTime"))?
            } else {
                0
            };
            let id = ranks.rank(text(&row, id_field))?;
            Ok(((date, start, id), row))
        })
        .collect::<Result<Vec<_>, EngineError>>()?;
    ranked.sort_by_key(|(key, _)| *key);
    Ok(ranked.into_iter().map(|(_, row)| row).collect())
}
/// Additional exact comparison strings, including tax-only/missing-shift IDs.
/// The platform merges these into its localeCompare rank preflight. Labels are
/// returned too for preflight convenience, but category order is first-seen.
pub(crate) fn collation_candidates(
    pay: Option<&Value>,
    classification: Option<&Value>,
    shifts: &[Value],
) -> BTreeSet<String> {
    let mut values = BTreeSet::from([String::new()]);
    for shift in shifts {
        for key in ["id", "date", "startTime"] {
            values.insert(text(shift, key).into());
        }
    }
    if let Some(pay) = pay {
        for row in array(&pay["shiftBreakdowns"])
            .iter()
            .chain(array(&pay["specialDutyBreakdowns"]))
        {
            for key in ["shiftId", "date"] {
                values.insert(text(row, key).into());
            }
        }
    }
    if let Some(classification) = classification {
        for row in array(&classification["shifts"]) {
            values.insert(
                nullish(row, "sourceShiftId")
                    .and_then(Value::as_str)
                    .unwrap_or_else(|| text(row, "shiftId"))
                    .into(),
            );
        }
    }
    values.extend(CATEGORIES.iter().map(|(_, label)| (*label).to_owned()));
    values.extend(
        [
            "Vorfeiertag",
            "Bereitschaften",
            "Lohnsteuer",
            "Solidaritätszuschlag",
            "Kirchensteuer",
            "Rentenversicherung",
            "Arbeitslosenversicherung",
            "Krankenversicherung",
            "Pflegeversicherung",
            "Zusatzversorgung",
            "Weitere Netto-Abzüge",
        ]
        .map(str::to_owned),
    );
    values
}
pub(crate) fn breakdown(
    breakdowns: &[Value],
    shifts: &[Value],
    filter: Option<&str>,
    ranks: &CollationRanks,
) -> Result<Value, EngineError> {
    premiums::breakdown(breakdowns, shifts, filter, ranks)
}
pub(crate) fn salary_rows(
    pay: Option<&Value>,
    classification: Option<&Value>,
    shifts: &[Value],
    filter: Option<&str>,
    ranks: &CollationRanks,
) -> Result<Vec<Value>, EngineError> {
    services::salary_rows(pay, classification, shifts, filter, ranks)
}
pub(crate) fn earned_rows(
    pay: Option<&Value>,
    classification: Option<&Value>,
    shifts: &[Value],
    filter: Option<&str>,
    ranks: &CollationRanks,
) -> Result<Vec<Value>, EngineError> {
    earned::earned_rows(pay, classification, shifts, filter, ranks)
}
pub(crate) fn special_amount(line: &Value) -> Value {
    earned::special_amount(line)
}
pub(crate) fn row_premium_amount(row: &Value) -> Value {
    json!(premiums::premium_amount(array(&row["premiumLines"])))
}
/// Monetary expressions used inside the original detail JSX, evaluated before
/// handing display rows to the host. Original helper representations stay pure.
pub(crate) fn decorate_rows(rows: &mut Value, has_classification: bool) {
    if let Some(rows) = rows.as_array_mut() {
        for row in rows {
            row["premiumAmount"] = row_premium_amount(row);
            if let Some(lines) = row["premiumLines"].as_array_mut() {
                for line in lines {
                    for (input, output) in
                        [("amount", "amountCents"), ("hourlyRate", "hourlyRateCents")]
                    {
                        line[output] = line[input]
                            .as_f64()
                            .map(|amount| json!(js_round(amount * 100.0)))
                            .unwrap_or(Value::Null);
                    }
                }
            }
            if nullish(row, "specialDuty").is_some() {
                let amount = row["amountCents"].as_f64().filter(|_| has_classification);
                row["taxableAmountCents"] = amount
                    .map(|amount| json!(amount - number(&row["tax"]["taxFreeCents"])))
                    .unwrap_or(Value::Null);
                row["socialInsuranceLiableAmountCents"] = amount
                    .map(|amount| json!(amount - number(&row["tax"]["socialInsuranceFreeCents"])))
                    .unwrap_or(Value::Null);
            }
        }
    }
}
