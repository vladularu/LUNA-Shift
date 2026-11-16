use super::{
    super::{CalendarClockLease, CalendarRowsLease},
    CalendarAssemblyError,
};
use serde_json::json;
enum Receipt {
    Rows(CalendarRowsLease),
    Clock(CalendarClockLease),
}
pub struct CalendarSourceCompletion(Receipt);
impl CalendarSourceCompletion {
    pub(super) fn rows(lease: CalendarRowsLease) -> Self {
        Self(Receipt::Rows(lease))
    }
    pub(super) fn clock(lease: CalendarClockLease) -> Self {
        Self(Receipt::Clock(lease))
    }
    pub fn is_current(&self) -> Result<bool, CalendarAssemblyError> {
        match &self.0 {
            Receipt::Rows(lease) => lease.is_current(),
            Receipt::Clock(lease) => lease.is_current(),
        }
        .map_err(Into::into)
    }
    pub fn serialize_current(&self) -> Result<Vec<u8>, CalendarAssemblyError> {
        if !self.is_current()? {
            return Err(crate::runtime::RegistryError::StaleSnapshot.into());
        }
        let mut value = match &self.0 {
            Receipt::Rows(lease) => {
                let availability = match lease.rows() {
                    Ok(_) => json!({"state":"READY"}),
                    Err(reason) => json!({"state":"UNAVAILABLE","reason":reason}),
                };
                json!({"ok":true,"state":"CALENDAR_ROWS_REGISTERED","identity":lease.identity(),"availability":availability})
            }
            Receipt::Clock(lease) => {
                json!({"ok":true,"state":"CALENDAR_CLOCK_REGISTERED","identity":lease.identity(),"clock":lease.clock().metadata()})
            }
        };
        value["wireSchemaVersion"] = json!(crate::contract::SCHEMA_VERSION);
        value["engineVersion"] = json!(crate::ENGINE_VERSION);
        value["calculationContractVersion"] = json!(crate::contract::CONTRACT_VERSION);
        let bytes = serde_json::to_vec(&value).map_err(|_| CalendarAssemblyError::OutputLimit)?;
        if bytes.len() > 8192 {
            return Err(CalendarAssemblyError::OutputLimit);
        }
        if !self.is_current()? {
            return Err(crate::runtime::RegistryError::StaleSnapshot.into());
        }
        Ok(bytes)
    }
}
