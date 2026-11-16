//! Stateless adapter used by the existing utility channel. App/OS lifecycle
//! remains with its caller; all reminder choices delegate to the same kernel.
use super::{NotificationSource, NotificationStep};
use crate::EngineError;
use serde::Deserialize;
use serde_json::{Value, json};
#[derive(Debug, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum ReminderCommand {
    Describe {
        entry: Value,
    },
    #[serde(rename_all = "camelCase")]
    Step {
        entry: Value,
        time_zone: String,
        opening_epoch_milliseconds: i64,
        position: u32,
        observed_epoch_milliseconds: i64,
    },
}
impl ReminderCommand {
    pub fn execute(&self) -> Result<Value, EngineError> {
        match self {
            Self::Describe { entry } => Ok(
                json!({"needsPermission":NotificationSource::from_entry(entry)?.needs_permission()}),
            ),
            Self::Step {
                entry,
                time_zone,
                opening_epoch_milliseconds,
                position,
                observed_epoch_milliseconds,
            } => {
                // Original permits at most48 appointment dates and two specs.
                // The caller keeps only the position; no native resource is added.
                if *position > 96 {
                    return Err(EngineError::Overflow);
                }
                let source = NotificationSource::from_entry(entry)?;
                let mut cursor = source.plan(time_zone, *opening_epoch_milliseconds)?;
                for index in 0..=*position {
                    match cursor.step(*observed_epoch_milliseconds)? {
                        NotificationStep::Finished => return Ok(json!({"state":"FINISHED"})),
                        NotificationStep::Skipped if index == *position => {
                            return Ok(json!({"state":"SKIPPED","nextPosition":position+1}));
                        }
                        NotificationStep::Schedule(candidate) if index == *position => {
                            return Ok(json!({
                            "state":"SCHEDULE","nextPosition":position+1,"candidate":{
                                "occurrenceDate":candidate.occurrence_date(),"epochMilliseconds":candidate.epoch_milliseconds(),
                                "isAlarm":candidate.is_alarm(),"content":candidate.content()}}));
                        }
                        _ => (),
                    }
                }
                Err(EngineError::InvalidCalendarEntry)
            }
        }
    }
}
