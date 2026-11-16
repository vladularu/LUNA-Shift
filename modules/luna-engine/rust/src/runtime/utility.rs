//! Closed, bounded adapters over existing native kernels. This entry point does
//! not implement financial reports or turn raw form drafts into snapshot facts.
use super::{
    SnapshotRegistry,
    utility_lease::{UtilityFenceError, UtilityLease, UtilityOwnerMarker},
};
use crate::{
    EngineError, calendar,
    contract::{
        self,
        utility::{
            MAX_UTILITY_OUTPUT_BYTES, UtilityGuard, UtilityKind, UtilityOperation, UtilityRequest,
            ValidatorKind,
        },
    },
    input::{self, InputError},
    time, time_zone,
};
use serde::Serialize;
use serde_json::{Value, json};
use std::io::{self, Write};

#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UtilityOutcome {
    Value {
        value: Value,
    },
    InputError {
        name: String,
        message: String,
    },
    RecordError {
        name: String,
        message: String,
        #[serde(rename = "userFacing")]
        user_facing: bool,
    },
    DomainError {
        code: EngineError,
    },
    OperationLimit,
}
fn value<T: Serialize>(value: Result<T, EngineError>) -> UtilityOutcome {
    match value {
        Ok(value) => match serde_json::to_value(value) {
            Ok(value) => UtilityOutcome::Value { value },
            Err(_) => UtilityOutcome::DomainError {
                code: EngineError::Overflow,
            },
        },
        Err(code) => UtilityOutcome::DomainError { code },
    }
}
fn validation(result: Result<Value, InputError>) -> UtilityOutcome {
    match result {
        Ok(value) => UtilityOutcome::Value { value },
        Err(error) => UtilityOutcome::InputError {
            name: error.name().to_owned(),
            message: error.message().to_owned(),
        },
    }
}
/// The recurrence kernel copies the full entry per occurrence. Editor preview
/// therefore has an explicit small transport scope before calling that kernel;
/// full calendar-window expansion is a different source-bound operation.
fn appointment_series(appointment: &Value, start: &str, end: &str) -> UtilityOutcome {
    let range = calendar::parse_date(start)
        .and_then(|start| calendar::parse_date(end).map(|end| (start, end)));
    let (start_day, end_day) = match range {
        Ok(range) => range,
        Err(code) => return UtilityOutcome::DomainError { code },
    };
    let days = match start_day.until(end_day) {
        Ok(span) => span.get_days(),
        Err(_) => {
            return UtilityOutcome::DomainError {
                code: EngineError::InvalidDate,
            };
        }
    };
    if !(0..=366).contains(&days)
        || !matches!(serde_json::to_vec(appointment),Ok(bytes) if bytes.len()<=2048)
        || appointment
            .get("recurrence")
            .and_then(|rule| rule.get("interval"))
            .and_then(Value::as_f64)
            .is_some_and(|interval| interval <= 0.0)
    {
        return UtilityOutcome::OperationLimit;
    }
    value(calendar::recurrence::expand_appointment_series(
        appointment,
        start,
        end,
    ))
}
/// Raw civil clock is an immutable host observation, not a host-computed date.
fn civil_clock(milliseconds: i64, zone: &str) -> Result<Value, EngineError> {
    if milliseconds.unsigned_abs() > 9_007_199_254_740_991 {
        return Err(EngineError::InvalidDate);
    }
    let stamp =
        jiff::Timestamp::from_millisecond(milliseconds).map_err(|_| EngineError::InvalidDate)?;
    let date = stamp.to_zoned(time_zone::zone(zone)?).date();
    Ok(
        json!({"date":date.to_string(),"month":format!("{:04}-{:02}",date.year(),date.month()),"timeZone":zone}),
    )
}
pub fn calculate(operation: &UtilityOperation) -> UtilityOutcome {
    match operation {
        UtilityOperation::TemplateActions { command } => validation(command.execute()),
        UtilityOperation::EntryReminder { command } => value(command.execute()),
        UtilityOperation::CivilClock {
            epoch_milliseconds,
            time_zone,
        } => value(civil_clock(*epoch_milliseconds, time_zone)),
        UtilityOperation::MonthGrid { month } => value(calendar::month_grid(month)),
        UtilityOperation::MonthRange { month } => value(calendar::month_range(month)),
        UtilityOperation::AddMonths { month, amount } => {
            value(calendar::add_months(month, *amount))
        }
        UtilityOperation::IsoWeek { date } => value(calendar::iso_week(date)),
        UtilityOperation::ShiftDuration { draft, time_zone } => {
            value(time::shift_minutes(draft, time_zone))
        }
        UtilityOperation::ShiftBounds { draft, time_zone } => {
            value(time::shift_bounds(draft, time_zone))
        }
        UtilityOperation::AppointmentSeries {
            appointment,
            start_date,
            end_date,
        } => appointment_series(appointment, start_date, end_date),
        UtilityOperation::ValidateInput { validator, input } => validation(match validator {
            ValidatorKind::UserProfile => input::profile::validate_profile(input),
            ValidatorKind::Shift => input::calendar::validate_shift(input),
            ValidatorKind::Template => input::calendar::validate_template(input),
            ValidatorKind::Appointment => input::calendar::validate_appointment(input),
            ValidatorKind::MonthlyTariffDecision => {
                input::calendar::validate_monthly_tariff_decision(input)
            }
            ValidatorKind::EmploymentData => input::employment::validate_employment_data(input),
            ValidatorKind::EmploymentDecode => input::employment::decode_employment_payload(input),
        }),
        UtilityOperation::MapRecordRows { row_kind, rows } => {
            if rows.len() > input::record_rows::MAX_RECORD_ROWS {
                UtilityOutcome::OperationLimit
            } else {
                match input::record_rows::map_rows(*row_kind, rows) {
                    Ok(value) => UtilityOutcome::Value { value },
                    Err(error) => UtilityOutcome::RecordError {
                        name: error.name().to_owned(),
                        message: error.message().to_owned(),
                        user_facing: error.user_facing_message().is_some(),
                    },
                }
            }
        }
        UtilityOperation::ProfileForm { command } => UtilityOutcome::Value {
            value: super::profile_form_facade::profile_form(command),
        },
        UtilityOperation::DutyFormCommand { command } => validation(command.execute()),
        UtilityOperation::DutyFormFeedback { duty, parent, date } => validation(
            input::special_duty_feedback::feedback(duty, parent, date.as_deref()),
        ),
        UtilityOperation::NetForm { command } => {
            validation(super::financial_facade::net_form(command))
        }
        UtilityOperation::PayrollForm { .. } => UtilityOutcome::InputError {
            name: "Error".into(),
            message: "Bitte die Gehaltsangaben erneut laden.".into(),
        },
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Reply<'a> {
    ok: bool,
    state: &'static str,
    wire_schema_version: u32,
    engine_version: &'static str,
    calculation_contract_version: &'static str,
    guard: &'a UtilityGuard,
    operation: UtilityKind,
    result: &'a UtilityOutcome,
}
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UtilityExecutionError {
    Fence(UtilityFenceError),
    OutputLimit,
}
impl From<UtilityFenceError> for UtilityExecutionError {
    fn from(error: UtilityFenceError) -> Self {
        Self::Fence(error)
    }
}
struct LimitedBytes(Vec<u8>);
impl Write for LimitedBytes {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.0.len().saturating_add(bytes.len()) > MAX_UTILITY_OUTPUT_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::FileTooLarge,
                "Utility output limit",
            ));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
/// Retains the source lease through serialization and the final native
/// publication check. The host must check its own draft/owner again before UI
/// publication or a database write, which is outside this core's atomic scope.
pub struct UtilityCompletion {
    lease: UtilityLease,
    result: UtilityOutcome,
}
impl UtilityCompletion {
    pub fn is_current(&self) -> Result<bool, UtilityFenceError> {
        self.lease.is_current()
    }
    pub fn serialize_current(&self) -> Result<Vec<u8>, UtilityExecutionError> {
        if !self.is_current()? {
            return Err(UtilityFenceError::Stale.into());
        }
        let reply = Reply {
            ok: true,
            state: "COMPLETED",
            wire_schema_version: contract::SCHEMA_VERSION,
            engine_version: crate::ENGINE_VERSION,
            calculation_contract_version: contract::CONTRACT_VERSION,
            guard: self.lease.guard(),
            operation: self.lease.kind(),
            result: &self.result,
        };
        let mut bytes = LimitedBytes(Vec::with_capacity(1024));
        serde_json::to_writer(&mut bytes, &reply)
            .map_err(|_| UtilityExecutionError::OutputLimit)?;
        if !self.is_current()? {
            return Err(UtilityFenceError::Stale.into());
        }
        Ok(bytes.0)
    }
}
pub fn prepare(
    registry: &SnapshotRegistry,
    marker: &UtilityOwnerMarker,
    request: &UtilityRequest,
) -> Result<UtilityCompletion, UtilityFenceError> {
    let lease = registry.lease_utility(marker, request.guard(), request.operation().kind())?;
    if !lease.is_current()? {
        return Err(UtilityFenceError::Stale);
    }
    let result = if let UtilityOperation::PayrollForm { command } = request.operation() {
        let facts = lease.facts().ok_or(UtilityFenceError::MissingSnapshot)?;
        validation(super::payroll_form::calculate(facts, command))
    } else {
        calculate(request.operation())
    };
    Ok(UtilityCompletion { lease, result })
}
