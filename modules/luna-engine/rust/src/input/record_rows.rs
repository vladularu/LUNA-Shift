//! Bounded raw-row normalization for mechanical SQL adapters; no source Ready admission.
use super::{InputError, calendar, calendar_rows};
use serde::{Deserialize, Serialize};
use serde_json::Value;
pub const MAX_RECORD_ROWS: usize = 128;
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RecordRowKind {
    Shift,
    Appointment,
    Template,
    TariffDecision,
    NetPayProfile,
    ShiftInput,
    AppointmentInput,
    TemplateInput,
    TariffDecisionInput,
    NetPayProfileInput,
}
pub fn map_rows(kind: RecordRowKind, rows: &[Value]) -> Result<Value, InputError> {
    if rows.len() > MAX_RECORD_ROWS {
        return Err(InputError::source(
            "Zu viele Datensätze in einem Verarbeitungsschritt.",
            "Error",
        ));
    }
    rows.iter()
        .map(|row| match kind {
            RecordRowKind::Shift => calendar_rows::map_shift(row),
            RecordRowKind::Appointment => calendar_rows::map_appointment(row),
            RecordRowKind::Template => calendar_rows::map_template(row),
            RecordRowKind::TariffDecision => calendar_rows::map_tariff_decision(row),
            RecordRowKind::NetPayProfile => super::finance_rows::map_net_pay_profile_row(row),
            RecordRowKind::ShiftInput => calendar::validate_shift(row),
            RecordRowKind::AppointmentInput => calendar::validate_appointment(row),
            RecordRowKind::TemplateInput => calendar::validate_template(row),
            RecordRowKind::TariffDecisionInput => calendar::normalize_tariff_decision_input(row),
            RecordRowKind::NetPayProfileInput => {
                super::finance_rows::normalize_net_pay_profile(row)
            }
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}
