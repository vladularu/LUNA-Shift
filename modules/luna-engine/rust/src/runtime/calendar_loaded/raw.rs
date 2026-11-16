use super::{CalendarLoadedPool, LoadedPoolError, LoadedQueryDraft, LoadedRawIntake};
use crate::{
    calendar::loaded_scope::RawScopeRows,
    contract::{self, ContractError},
};
use serde_json::{Map, Value};
use std::sync::Arc;
pub const MAX_LOADED_SOURCE_BYTES: usize = super::quota::RAW_SOURCE_CEILING as usize;
fn array(object: &mut Map<String, Value>, field: &str) -> Result<Arc<[Value]>, LoadedPoolError> {
    match object.remove(field) {
        Some(Value::Array(rows)) if rows.iter().all(Value::is_object) => Ok(Arc::from(rows)),
        _ => Err(LoadedPoolError::Input(ContractError::MalformedEnvelope)),
    }
}
fn decode(raw: &[u8]) -> Result<Arc<RawScopeRows>, LoadedPoolError> {
    if raw.len() > MAX_LOADED_SOURCE_BYTES {
        return Err(LoadedPoolError::Input(ContractError::InputTooLarge));
    }
    let mut value = contract::bounded_json(raw).map_err(LoadedPoolError::Input)?;
    crate::input::raw_json::normalize_integral_numbers(&mut value);
    let Value::Object(mut object) = value else {
        return Err(LoadedPoolError::Input(ContractError::MalformedEnvelope));
    };
    if object.len() != 3
        || !["shiftRows", "appointmentRows", "templateRows"]
            .iter()
            .all(|key| object.contains_key(*key))
    {
        return Err(LoadedPoolError::Input(ContractError::MalformedEnvelope));
    }
    // Remove/move each original array directly into its immutable source owner.
    // Neither serde-from-value nor a second complete row tree is constructed.
    let shifts = array(&mut object, "shiftRows")?;
    let appointments = array(&mut object, "appointmentRows")?;
    let templates = array(&mut object, "templateRows")?;
    RawScopeRows::new(shifts, appointments, templates).map_err(LoadedPoolError::from)
}
impl CalendarLoadedPool {
    pub fn prepare_query_json(
        &self,
        intake: LoadedRawIntake,
        raw: &[u8],
    ) -> Result<LoadedQueryDraft, LoadedPoolError> {
        self.run(|state| self.check_ticket(state, &intake.ticket))?;
        let source = decode(raw)?;
        self.prepare_query(intake, source)
    }
}
