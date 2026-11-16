//! Closed stateless row/collection adapters; never source admission.
use super::{
    InputError, annual_rows as annual, calendar_rows, employment,
    remuneration_rows as remuneration, training_rows as training,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;
mod drafts;
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum Table {
    ActualAnnualPayment,
    TariffAnnualClaim,
    TrainingProfile,
    ShiftTraining,
    RemunerationProfile,
    OvertimeAllocation,
    PaidAbsence,
    AllowanceDecision,
    TvoedAnnexAMonth,
    TvoedAnnexAPremium,
    TvoedSueMonth,
    TvoedSueAllowance,
    TvlShiftWork,
    DrkEmployeeMonth,
    DrkTrainingMonth,
    CaritasMonth,
    CaritasWorkDay,
    CaritasOvertime,
}
impl Table {
    fn draft(self) -> Option<super::draft_rows::DraftRowsKind> {
        use super::draft_rows::DraftRowsKind as D;
        Some(match self {
            Self::TvoedAnnexAMonth => D::AnnexAMonth,
            Self::TvoedAnnexAPremium => D::AnnexAPremium,
            Self::TvoedSueMonth => D::SueMonth,
            Self::TvoedSueAllowance => D::SueAllowance,
            Self::TvlShiftWork => D::TvlShiftWork,
            Self::DrkEmployeeMonth => D::DrkEmployee,
            Self::DrkTrainingMonth => D::DrkTraining,
            Self::CaritasMonth => D::CaritasMonth,
            Self::CaritasWorkDay => D::CaritasWorkDay,
            Self::CaritasOvertime => D::CaritasOvertime,
            _ => return None,
        })
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Parents {
    shifts: Vec<Value>,
    time_zone: Option<String>,
    #[serde(default)]
    remuneration_profiles: Vec<Value>,
    #[serde(default)]
    training_profiles: Vec<Value>,
    #[serde(default)]
    overtime_allocations: Vec<Value>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Command {
    table: Table,
    rows: Vec<Value>,
    collection: bool,
    #[serde(default)]
    parents: Option<Parents>,
}
fn error(error: InputError, index: Option<usize>) -> Value {
    json!({"state":"RECORD_ERROR","name":error.name(),"message":error.message(),"userFacing":error.user_facing_message().is_some(),"rowIndex":index})
}
pub fn execute(raw: &[u8]) -> Result<Value, &'static str> {
    let value = crate::contract::bounded_json(raw).map_err(|_| "INVALID_STORED_ROWS_INPUT")?;
    let command: Command =
        serde_json::from_value(value).map_err(|_| "INVALID_STORED_ROWS_INPUT")?;
    if command.rows.len() > 50_000
        || command.parents.as_ref().is_some_and(|p| {
            [
                &p.shifts,
                &p.remuneration_profiles,
                &p.training_profiles,
                &p.overtime_allocations,
            ]
            .iter()
            .any(|rows| rows.len() > 50_000)
        })
    {
        return Err("STORED_ROWS_LIMIT");
    }
    if command.collection
        && !matches!(
            command.table,
            Table::ActualAnnualPayment
                | Table::TariffAnnualClaim
                | Table::TrainingProfile
                | Table::ShiftTraining
        )
    {
        return Err("INVALID_STORED_ROWS_INPUT");
    }
    if command.parents.is_some()
        && command.table.draft().is_none()
        && !matches!(
            command.table,
            Table::ShiftTraining | Table::OvertimeAllocation | Table::PaidAbsence
        )
    {
        return Err("INVALID_STORED_ROWS_INPUT");
    }
    let mapper = |row: &Value| match command.table {
        Table::ActualAnnualPayment => annual::map_actual_annual_payment_row(row),
        Table::TariffAnnualClaim => annual::map_tariff_annual_claim_row(row),
        Table::TrainingProfile => training::map_training_profile_row(row),
        Table::ShiftTraining => training::map_shift_training_row(row),
        Table::RemunerationProfile => employment::map_remuneration_profile_row(row),
        Table::OvertimeAllocation => remuneration::map_overtime_allocation_row(row),
        Table::PaidAbsence => remuneration::map_paid_absence_row(row),
        Table::AllowanceDecision => remuneration::map_allowance_decision_row(row),
        other => super::draft_rows::map_draft_evidence_row(other.draft().unwrap(), row),
    };
    let mut mapped = Vec::with_capacity(command.rows.len());
    for (index, row) in command.rows.iter().enumerate() {
        match mapper(row) {
            Ok(value) => mapped.push(value),
            Err(e) => return Ok(error(e, Some(index))),
        }
    }
    if let Some(parents) = command.parents {
        if let Some(kind) = command.table.draft() {
            if let Err((e, index)) = drafts::parents(kind, &mapped, &parents) {
                return Ok(error(e, index));
            }
        } else {
            let by_id = parents
                .shifts
                .iter()
                .filter_map(|row| row["id"].as_str().map(|id| (id, row)))
                .collect::<BTreeMap<_, _>>();
            let mut checked = BTreeMap::<&str, Value>::new();
            for (index, child) in mapped.iter().enumerate() {
                let id = child["shiftId"].as_str().unwrap();
                let Some(raw) = by_id.get(id) else {
                    return Ok(error(invalid_backup(), Some(index)));
                };
                if matches!(command.table, Table::OvertimeAllocation) {
                    if child["shiftRevision"]
                        .as_f64()
                        .zip(raw["revision"].as_f64())
                        .is_some_and(|(a, b)| a > b)
                    {
                        return Ok(error(invalid_backup(), Some(index)));
                    }
                    // Exactly the original import guard: historical rows and a
                    // different provided profile zone do not revalidate pay math.
                    if child["shiftRevision"].as_f64() != raw["revision"].as_f64()
                        || child["timeZone"].as_str() != parents.time_zone.as_deref()
                    {
                        continue;
                    }
                }
                let shift = match checked.entry(id) {
                    std::collections::btree_map::Entry::Occupied(entry) => entry.into_mut(),
                    std::collections::btree_map::Entry::Vacant(entry) => {
                        match calendar_rows::map_shift(raw) {
                            Ok(value) => entry.insert(value),
                            Err(e) => return Ok(error(e, Some(index))),
                        }
                    }
                };
                let result = match command.table {
                    Table::PaidAbsence => remuneration::require_paid_absence_parent(child, shift),
                    Table::OvertimeAllocation => {
                        remuneration::require_overtime_allocation_matches_shift(child, shift)
                    }
                    Table::ShiftTraining => {
                        crate::training::require_shift_training_parent(child, shift)
                            .map_err(training::training_error)
                    }
                    _ => unreachable!(),
                };
                if let Err(e) = result {
                    return Ok(error(e, Some(index)));
                }
            }
        }
    }
    if command.collection {
        // Original backup maps in caller order, then validates the saved
        // collection. Repository SQL sorting is a separate source operation.
        let checked = match command.table {
            Table::ActualAnnualPayment => {
                annual::validate_actual_annual_payment_collection(&mapped)
            }
            Table::TariffAnnualClaim => annual::validate_tariff_annual_claim_collection(&mapped),
            Table::TrainingProfile | Table::ShiftTraining => Ok(()),
            _ => unreachable!(),
        };
        if let Err(e) = checked {
            return Ok(error(e, None));
        }
    }
    Ok(json!({"state":"VALUE","value":mapped}))
}
fn invalid_backup() -> InputError {
    InputError::source(
        "Die Datei ist kein gültiges LUNA-Shift-Backup.",
        "LocalBackupValidationError",
    )
}
