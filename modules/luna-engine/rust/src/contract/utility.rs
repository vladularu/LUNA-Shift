//! K0 bounded raw utility contract; never accepts precomputed Ready facts.
use super::*;
pub const MAX_UTILITY_INPUT_BYTES: usize = 256 * 1024;
pub const MAX_UTILITY_OUTPUT_BYTES: usize = 1024 * 1024;
pub const MAX_UTILITY_NODES: u32 = 16_384;
pub const MAX_UTILITY_DEPTH: u32 = 24;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UtilityGuard {
    owner_scope: String,
    owner_epoch: u64,
    request_id: String,
    draft_revision: u64,
    #[serde(
        default,
        deserialize_with = "present_snapshot",
        skip_serializing_if = "Option::is_none"
    )]
    snapshot: Option<SnapshotIdentity>,
}
fn present_snapshot<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<SnapshotIdentity>, D::Error> {
    SnapshotIdentity::deserialize(deserializer).map(Some)
}
impl UtilityGuard {
    pub fn owner_scope(&self) -> &str {
        &self.owner_scope
    }
    pub fn owner_epoch(&self) -> u64 {
        self.owner_epoch
    }
    pub fn request_id(&self) -> &str {
        &self.request_id
    }
    pub fn draft_revision(&self) -> u64 {
        self.draft_revision
    }
    pub fn snapshot(&self) -> Option<&SnapshotIdentity> {
        self.snapshot.as_ref()
    }
    /// Convert only an explicit report-snapshot locator into the existing
    /// utility lease guard. This establishes no native source readiness.
    pub(crate) fn bind_report_snapshot(
        &self,
        identity: &SnapshotIdentity,
    ) -> Result<Self, ContractError> {
        if self.snapshot.is_some() {
            return Err(ContractError::InvalidRequest);
        }
        let mut bound = self.clone();
        bound.snapshot = Some(identity.clone());
        bound.validate()?;
        Ok(bound)
    }
    pub(crate) fn validate(&self) -> Result<(), ContractError> {
        OwnerIdentity::new(&self.owner_scope, self.owner_epoch)?;
        identifier(&self.request_id)?;
        revision(self.draft_revision)?;
        if let Some(snapshot) = &self.snapshot {
            snapshot.validate()?;
            if snapshot.owner_scope() != self.owner_scope
                || snapshot.owner_epoch() != self.owner_epoch
            {
                return Err(ContractError::IdentityMismatch);
            }
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UtilityKind {
    CivilClock,
    MonthGrid,
    MonthRange,
    AddMonths,
    IsoWeek,
    ShiftDuration,
    ShiftBounds,
    AppointmentSeries,
    ValidateInput,
    MapRecordRows,
    EntryReminder,
    TemplateActions,
    NetForm,
    PayrollForm,
    ProfileForm,
    DutyFormFeedback,
    DutyFormCommand,
    FinancialCollation,
    CalendarWindow,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ValidatorKind {
    UserProfile,
    Shift,
    Template,
    Appointment,
    MonthlyTariffDecision,
    EmploymentData,
    EmploymentDecode,
}
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum UtilityOperation {
    TemplateActions {
        command: crate::input::template_actions::TemplateActionCommand,
    },
    EntryReminder {
        command: crate::calendar::notifications::command::ReminderCommand,
    },
    #[serde(rename_all = "camelCase")]
    CivilClock {
        epoch_milliseconds: i64,
        time_zone: String,
    },
    MonthGrid {
        month: String,
    },
    MonthRange {
        month: String,
    },
    AddMonths {
        month: String,
        amount: i32,
    },
    IsoWeek {
        date: String,
    },
    #[serde(rename_all = "camelCase")]
    ShiftDuration {
        draft: crate::time::ShiftTime,
        time_zone: String,
    },
    #[serde(rename_all = "camelCase")]
    ShiftBounds {
        draft: crate::time::ShiftTime,
        time_zone: String,
    },
    #[serde(rename_all = "camelCase")]
    AppointmentSeries {
        appointment: Value,
        start_date: String,
        end_date: String,
    },
    ValidateInput {
        validator: ValidatorKind,
        input: Value,
    },
    #[serde(rename_all = "camelCase")]
    MapRecordRows {
        row_kind: crate::input::record_rows::RecordRowKind,
        rows: Vec<Value>,
    },
    NetForm {
        command: crate::input::net_form_command::NetFormCommand,
    },
    PayrollForm {
        command: crate::input::payroll_form_command::PayrollFormCommand,
    },
    ProfileForm {
        command: crate::input::profile_form_command::ProfileFormCommand,
    },
    DutyFormFeedback {
        duty: Value,
        parent: Value,
        date: Option<String>,
    },
    DutyFormCommand {
        command: crate::input::special_duty_command::DutyFormCommand,
    },
}
impl UtilityOperation {
    pub fn kind(&self) -> UtilityKind {
        match self {
            Self::TemplateActions { .. } => UtilityKind::TemplateActions,
            Self::EntryReminder { .. } => UtilityKind::EntryReminder,
            Self::CivilClock { .. } => UtilityKind::CivilClock,
            Self::MonthGrid { .. } => UtilityKind::MonthGrid,
            Self::MonthRange { .. } => UtilityKind::MonthRange,
            Self::AddMonths { .. } => UtilityKind::AddMonths,
            Self::IsoWeek { .. } => UtilityKind::IsoWeek,
            Self::ShiftDuration { .. } => UtilityKind::ShiftDuration,
            Self::ShiftBounds { .. } => UtilityKind::ShiftBounds,
            Self::AppointmentSeries { .. } => UtilityKind::AppointmentSeries,
            Self::ValidateInput { .. } => UtilityKind::ValidateInput,
            Self::MapRecordRows { .. } => UtilityKind::MapRecordRows,
            Self::NetForm { .. } => UtilityKind::NetForm,
            Self::PayrollForm { .. } => UtilityKind::PayrollForm,
            Self::ProfileForm { .. } => UtilityKind::ProfileForm,
            Self::DutyFormFeedback { .. } => UtilityKind::DutyFormFeedback,
            Self::DutyFormCommand { .. } => UtilityKind::DutyFormCommand,
        }
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UtilityRequest {
    wire_schema_version: u32,
    expected_engine_version: String,
    calculation_contract_version: String,
    guard: UtilityGuard,
    operation: UtilityOperation,
}
impl UtilityRequest {
    pub fn guard(&self) -> &UtilityGuard {
        &self.guard
    }
    pub fn operation(&self) -> &UtilityOperation {
        &self.operation
    }
}
pub fn parse_utility_request(bytes: &[u8]) -> Result<UtilityRequest, ContractError> {
    if bytes.len() > MAX_UTILITY_INPUT_BYTES {
        return Err(ContractError::InputTooLarge);
    }
    let mut budget = JsonBudget {
        nodes: MAX_JSON_NODES - MAX_UTILITY_NODES,
        error: None,
    };
    let mut parser = serde_json::Deserializer::from_slice(bytes);
    let value = BoundedSeed {
        depth: MAX_JSON_DEPTH - MAX_UTILITY_DEPTH,
        budget: &mut budget,
    }
    .deserialize(&mut parser)
    .map_err(|_| budget.error.unwrap_or(ContractError::InvalidJson))?;
    parser.end().map_err(|_| ContractError::InvalidJson)?;
    let request: UtilityRequest =
        serde_json::from_value(value).map_err(|_| ContractError::MalformedEnvelope)?;
    if request.wire_schema_version != SCHEMA_VERSION {
        return Err(ContractError::UnsupportedSchema);
    }
    if request.expected_engine_version != crate::ENGINE_VERSION {
        return Err(ContractError::UnsupportedEngine);
    }
    if request.calculation_contract_version != CONTRACT_VERSION {
        return Err(ContractError::UnsupportedContract);
    }
    request.guard.validate()?;
    if matches!(request.operation, UtilityOperation::PayrollForm { .. })
        && request.guard.snapshot().is_none()
    {
        return Err(ContractError::InvalidRequest);
    }
    Ok(request)
}
