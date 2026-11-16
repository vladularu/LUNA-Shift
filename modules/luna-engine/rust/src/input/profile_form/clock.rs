use super::{InputError, shape_error};
/// One immutable raw instant; routines derive civil days in their original zones.
/// Not Deserialize as a precomputed host date or clock status.
pub struct FormClock(jiff::Timestamp);
impl FormClock {
    pub fn from_instant(instant: &str) -> Result<Self, InputError> {
        instant.parse().map(Self).map_err(|_| shape_error())
    }
    pub fn date_in(&self, time_zone: &str) -> Result<String, InputError> {
        let zone = crate::time::zone(time_zone).map_err(|_| shape_error())?;
        Ok(self.0.to_zoned(zone).date().to_string())
    }
}
