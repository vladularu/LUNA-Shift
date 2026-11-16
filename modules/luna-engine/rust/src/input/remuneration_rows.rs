//! Original SQL source admission for monthly remuneration evidence.
use super::{InputError, raw_json, require_instant};
use crate::remuneration::{
    assessment,
    base::{BaseError, absence},
    context::model::ContextError,
    overtime,
};
use serde_json::{Value, json};
use std::sync::Arc;
fn error(message: &str) -> InputError {
    InputError::source(message, "Error")
}
fn class(name: &str) -> &'static str {
    match name {
        "ValidationError" => "ValidationError",
        "RemunerationProfileError" => "RemunerationProfileError",
        "RangeError" => "RangeError",
        _ => "Error",
    }
}
fn classified(message: impl Into<String>, name: &'static str) -> InputError {
    if matches!(name, "ValidationError" | "RemunerationProfileError") {
        InputError::user_facing_source(message, name)
    } else {
        InputError::source(message, name)
    }
}
fn stored_json(row: &Value, key: &str) -> Result<Value, InputError> {
    if !raw_json::sql_json_is_text(row, key) {
        return Err(InputError::source(
            "Die gespeicherten Vergütungsdaten enthalten ungültiges JSON.",
            "SyntaxError",
        ));
    }
    raw_json::parse_sql_json(row, key).map_err(|_| {
        InputError::source(
            "Die gespeicherten Vergütungsdaten enthalten ungültiges JSON.",
            "SyntaxError",
        )
    })
}
pub fn map_paid_absence_row(row: &Value) -> Result<Value, InputError> {
    // Missing is not the explicit NULL which revokes paid time.
    // Both JS undefined and false fail at the paid-minutes validator. This
    // deliberately invalid scalar preserves its original position in the
    // validation order; NULL would incorrectly revoke the confirmation.
    let missing_paid = Value::Bool(false);
    let paid = row.get("paid_minutes").unwrap_or(&missing_paid);
    let mut value = json!({"shiftId":row["shift_id"],"shiftRevision":row["shift_revision"],"shiftDate":row["shift_date"],"shiftUpdatedAt":row["shift_updated_at"],"timeZone":row["time_zone"],"paidMinutes":paid,"revision":row["revision"],"confirmedAt":row["confirmed_at"],"updatedAt":row["updated_at"]});
    raw_json::normalize_integral_numbers(&mut value);
    let checked = absence::validate_paid_absence(&value).map_err(|e| {
        let name = match e {
            BaseError::Context(ContextError::Employment(_)) => "RemunerationProfileError",
            BaseError::AbsenceInstant(_) => "ValidationError",
            BaseError::Engine(crate::EngineError::InvalidTimeZone) => "RangeError",
            _ => "Error",
        };
        classified(e.to_string(), name)
    })?;
    serde_json::to_value(checked).map_err(|_| error("Ungültige Abwesenheitsbestätigung."))
}
pub fn map_overtime_allocation_row(row: &Value) -> Result<Value, InputError> {
    let allocations = stored_json(row, "allocations_json")?;
    let value = json!({"shiftId":row["shift_id"],"shiftRevision":row["shift_revision"],"timeZone":row["time_zone"],"allocations":allocations,"revision":row["revision"],"confirmedAt":row["confirmed_at"],"updatedAt":row["updated_at"]});
    let checked = overtime::saved::validate_overtime_allocation(&value)
        .map_err(|e| classified(e.to_string(), class(e.class_name())))?;
    serde_json::to_value(checked).map_err(|_| error("Ungültige Überstundenaufteilung."))
}

/// Import-only parent rule after the original native row validators. Historical
/// stale confirmations stay inert; no source or calculation result is admitted.
pub fn require_paid_absence_parent(candidate: &Value, shift: &Value) -> Result<(), InputError> {
    let future_time = super::simple_profile::js_milliseconds(&candidate["shiftUpdatedAt"])
        .zip(super::simple_profile::js_milliseconds(&shift["updatedAt"]))
        .is_some_and(|(a, b)| a > b);
    if candidate["shiftId"] != shift["id"]
        || candidate["shiftRevision"]
            .as_f64()
            .zip(shift["revision"].as_f64())
            .is_some_and(|(a, b)| a > b)
        || future_time
    {
        return Err(error(
            "Ungültige Eintragszuordnung der Abwesenheitsbestätigung.",
        ));
    }
    if !candidate["paidMinutes"].is_null()
        && candidate["shiftRevision"] == shift["revision"]
        && candidate["shiftDate"] == shift["date"]
        && candidate["shiftUpdatedAt"] == shift["updatedAt"]
        && !absence::is_own_paid_absence(shift)
    {
        return Err(error("Der Eintrag ist keine bestätigbare Abwesenheit."));
    }
    Ok(())
}

/// Same confirmed overtime/day-allocation rule as the original repository.
/// Minute intervals are derived only by the existing native remuneration kernel.
pub fn require_overtime_allocation_matches_shift(
    candidate: &Value,
    shift: &Value,
) -> Result<(), InputError> {
    if candidate["allocations"].is_null() {
        return Ok(());
    }
    if candidate["shiftId"] != shift["id"]
        || candidate["shiftRevision"] != shift["revision"]
        || !shift["deletedAt"].is_null()
        || !crate::pay::pattern::is_pay_work_shift(shift)
        || shift["tariffOvertimeConfirmed"] != true
        || shift["overtimeMinutes"].as_f64().is_none_or(|n| n <= 0.0)
    {
        return Err(error(
            "Bitte zunächst die auszahlbaren Überstunden ausdrücklich bestätigen.",
        ));
    }
    let zone = candidate["timeZone"]
        .as_str()
        .ok_or_else(|| error("Ungültige Zeitzone."))?;
    let days = crate::remuneration::base::shift_days::remuneration_shift_days(shift, zone)
        .map_err(|e| InputError::source(e.to_string(), "RangeError"))?;
    let allocations = candidate["allocations"]
        .as_array()
        .ok_or_else(|| error("Ungültige Überstundenaufteilung."))?;
    let overtime = shift["overtimeMinutes"].as_f64().unwrap();
    let sum = allocations
        .iter()
        .map(|row| row["minutes"].as_f64().unwrap_or(f64::NAN))
        .sum::<f64>();
    if overtime > days.iter().map(|day| day.net_minutes).sum::<f64>()
        || sum != overtime
        || allocations.iter().any(|row| {
            days.iter()
                .find(|day| row["date"] == day.date)
                .is_none_or(|day| {
                    row["minutes"]
                        .as_f64()
                        .is_none_or(|n| n > day.until - day.from)
                })
        })
    {
        return Err(error(
            "Die Aufteilung muss alle bestätigten Überstunden innerhalb der Diensttage zuordnen.",
        ));
    }
    Ok(())
}
pub fn require_allowance_month(value: &Value) -> Result<&str, InputError> {
    let text = value
        .as_str()
        .filter(|s| {
            s.len() == 7
                && s.as_bytes()[4] == b'-'
                && s.bytes()
                    .enumerate()
                    .all(|(i, b)| i == 4 || b.is_ascii_digit())
        })
        .ok_or_else(|| error("Ungültiger Zulagenmonat."))?;
    crate::employment::require_remuneration_date(&format!("{text}-01"))
        .map_err(|e| classified(e.to_string(), "RemunerationProfileError"))?;
    Ok(text)
}
pub fn map_allowance_decision_row(row: &Value) -> Result<Value, InputError> {
    let month = require_allowance_month(&row["month"])?;
    let revision = row["revision"]
        .as_f64()
        .filter(|n| {
            n.is_finite() && n.fract() == 0.0 && n.abs() <= crate::money::MAX_SAFE_INTEGER as f64
        })
        .ok_or_else(|| error("Ungültige Zulagenrevision."))?;
    if revision < 1.0 {
        return Err(InputError::validation("Ungültige Datensatzrevision."));
    }
    let updated = require_instant(&row["updated_at"], "Aktualisierung")?;
    let decisions = assessment::decisions::validate_scoped_allowance_decisions(&stored_json(
        row,
        "decisions_json",
    )?)
    .map_err(|e| classified(e.to_string(), class(e.class_name())))?;
    if decisions.iter().any(|d| {
        d["from"].as_str().is_none_or(|v| !v.starts_with(month))
            || d["through"].as_str().is_none_or(|v| !v.starts_with(month))
            || d["revision"].as_f64() != Some(revision)
            || d["updatedAt"] != updated
    }) {
        return Err(error(
            "Die Zulagenentscheidungen passen nicht zum gespeicherten Monat.",
        ));
    }
    Ok(json!({"month":month,"revision":revision as i64,"updatedAt":updated,"decisions":decisions}))
}
pub fn load_monthly_allowance_row(month: &Value, row: Option<&Value>) -> Result<Value, InputError> {
    let month = require_allowance_month(month)?;
    match row {
        Some(row) => map_allowance_decision_row(row),
        None => Ok(json!({"month":month,"revision":0,"updatedAt":null,"decisions":[]})),
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemunerationRowsKind {
    PaidAbsences,
    OvertimeAllocations,
    ScopedAllowances,
}
/// Source rows are retained, parsed/validated once and ordered like SQLite.
/// This owner has no Deserialize implementation or host Ready constructor.
pub struct RawRemunerationRows {
    raw: Arc<Vec<Value>>,
    saved: Arc<Vec<Value>>,
    kind: RemunerationRowsKind,
}
impl RawRemunerationRows {
    pub fn try_from_rows(
        kind: RemunerationRowsKind,
        raw: Arc<Vec<Value>>,
    ) -> Result<Self, InputError> {
        if raw.len() > crate::contract::MAX_SOURCE_ITEMS as usize {
            return Err(error("Zu viele Vergütungsnachweise."));
        }
        let column = if matches!(kind, RemunerationRowsKind::ScopedAllowances) {
            "month"
        } else {
            "shift_id"
        };
        let mut order = (0..raw.len()).collect::<Vec<_>>();
        order.sort_by(|a, b| raw[*a][column].as_str().cmp(&raw[*b][column].as_str()));
        let saved = order
            .into_iter()
            .map(|i| match kind {
                RemunerationRowsKind::PaidAbsences => map_paid_absence_row(&raw[i]),
                RemunerationRowsKind::OvertimeAllocations => map_overtime_allocation_row(&raw[i]),
                RemunerationRowsKind::ScopedAllowances => map_allowance_decision_row(&raw[i]),
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            raw,
            saved: Arc::new(saved),
            kind,
        })
    }
    pub fn raw_rows(&self) -> &Arc<Vec<Value>> {
        &self.raw
    }
    pub fn saved(&self) -> &Arc<Vec<Value>> {
        &self.saved
    }
    pub fn kind(&self) -> RemunerationRowsKind {
        self.kind
    }
    pub fn allowance_month(&self, month: &str) -> Result<Value, InputError> {
        if !matches!(self.kind, RemunerationRowsKind::ScopedAllowances) {
            return Err(error("Ungültige Quelle der Zulagenentscheidungen."));
        }
        require_allowance_month(&json!(month))?;
        Ok(self
            .saved
            .iter()
            .find(|r| r["month"] == month)
            .cloned()
            .unwrap_or_else(|| json!({"month":month,"revision":0,"updatedAt":null,"decisions":[]})))
    }
}

#[cfg(test)]
mod parent_reference {
    use super::*;
    #[test]
    fn original_existing_raw_fixture_parent_outcomes_and_error_ancestry_match() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../reference/backup-parents-golden.json"
        ))
        .unwrap();
        assert_eq!(fixture["cases"].as_array().unwrap().len(), 744);
        for case in fixture["cases"].as_array().unwrap() {
            let input = &case["input"];
            let result = match case["operation"].as_str().unwrap() {
                "paid-parent" => require_paid_absence_parent(&input["candidate"], &input["shift"]),
                "overtime-parent" => {
                    require_overtime_allocation_matches_shift(&input["candidate"], &input["shift"])
                }
                other => panic!("unknown original case {other}"),
            };
            let actual = match result {
                Ok(()) => json!({"value":null}),
                Err(error) => {
                    json!({"error":{"name":error.name(),"message":error.message(),"userFacing":error.user_facing_message().is_some()}})
                }
            };
            assert_eq!(actual, case["expected"], "{}", case["id"]);
        }
    }
}
