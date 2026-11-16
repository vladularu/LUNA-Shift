//! Ordered domain report events; their metadata is resolved against native days.
use serde_json::{Value, json};
pub struct TrainingEvent {
    pub(super) day_date: String,
    pub(super) date: String,
    pub(super) code: &'static str,
    pub(super) severity: &'static str,
    pub(super) message: String,
    pub(super) section: &'static str,
    pub(super) shift_ids: Vec<String>,
}
impl TrainingEvent {
    pub fn day_date(&self) -> &str {
        &self.day_date
    }
    pub fn to_json(&self) -> Value {
        json!({"dayDate":self.day_date,"date":self.date,"code":self.code,"severity":self.severity,"message":self.message,"section":self.section,"shiftIds":self.shift_ids})
    }
}
