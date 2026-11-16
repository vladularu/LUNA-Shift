//! Explicitly incomplete AVR-DD draft components; no regular salary activation.
mod allowances;
mod base;
use crate::{
    calendar::{MonthRange, month_range, parse_date},
    net::js_truthy,
    remuneration::{
        base::{BaseError, round_remuneration_cents},
        context::{
            model::NativePackageValidator,
            selection::{ResolvedSelection, resolve_tariff_selection},
        },
    },
    rules::RulePackage,
};
pub use allowances::{care, shift};
pub use base::base;
use serde_json::{Value, json};
mod advanced;
mod overtime;
mod time;
pub use advanced::advanced;
pub use overtime::overtime;
pub use time::time;
fn source_ids<'a>(values: &[&'a Value]) -> Vec<&'a Value> {
    let mut out = Vec::new();
    for value in values {
        for source in rows(value, "sourceIds") {
            if !out.contains(&source) {
                out.push(source);
            }
        }
    }
    out
}
fn unavailable(reason: &str) -> Value {
    json!({"kind":"unavailable","reason":reason})
}
fn rows<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v[key].as_array().map_or(&[], Vec::as_slice)
}
fn safe(n: f64) -> bool {
    n.is_finite() && n.fract() == 0.0 && n.abs() <= crate::money::MAX_SAFE_INTEGER as f64
}
fn real_date(date: &str) -> bool {
    date.len() == 10
        && date.bytes().enumerate().all(|(i, c)| {
            if i == 4 || i == 7 {
                c == b'-'
            } else {
                c.is_ascii_digit()
            }
        })
        && parse_date(date).is_ok()
}
fn bounds(month: &str) -> Option<MonthRange> {
    crate::input::calendar::require_local_month(&json!(month)).ok()?;
    month_range(month).ok()
}
fn selected<'a>(
    pkg: &'a RulePackage,
    variant: &str,
    region: &str,
) -> Option<ResolvedSelection<'a>> {
    resolve_tariff_selection(pkg, variant, region).filter(|s| {
        s.family_id == "avr-dd"
            && s.engine_id == "avr-dd-v1"
            && s.capabilities
                .as_object()
                .is_some_and(|c| c.values().all(|v| v == "UNSUPPORTED"))
    })
}
fn weekly(pkg: &RulePackage, input: &Value) -> Option<f64> {
    let n = input["contractedWeeklyMinutes"].as_f64()?;
    (pkg.rules()["avrddStagePolicy"]["standardFullTimeWeeklyMinutes"] == 2340
        && safe(n)
        && (60.0..=2340.0).contains(&n))
    .then_some(n)
}
