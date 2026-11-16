//! Original deletion UI policy only. A pending request is never a committed deletion.
use super::entry_editor_save::EntrySaveFailure;
use serde_json::{Value, json};
pub struct RawDeletePreparation {
    existing: Option<Value>,
    busy: bool,
}
impl RawDeletePreparation {
    pub fn prepare(existing: Option<&Value>, busy: bool) -> Self {
        Self {
            existing: existing.filter(|value| !value.is_null() && !busy).cloned(),
            busy,
        }
    }
    /// This is an intent only. The private source and physical row must still
    /// be bound to a real write context before any deletion can be committed.
    pub fn write_intent(&self) -> Option<&Value> {
        self.existing.as_ref()
    }
    pub fn begin(&self) -> Value {
        let events = self.existing.as_ref().map_or_else(Vec::new, |existing| {
            vec![
                json!({"kind":"SAVING","value":true}),
                json!({"kind":"ERROR","value":null}),
                json!({"kind":"DELETION_CHANGE","value":existing}),
            ]
        });
        let saving = self.busy || self.existing.is_some();
        json!({"state":"DELETE_PENDING","events":events,"writes":self.existing.iter().collect::<Vec<_>>(),"saving":saving,"savingRef":saving})
    }
    pub fn finish(self, failure: Option<&EntrySaveFailure>) -> Value {
        let mut events = Vec::new();
        let active = self.existing.is_some();
        if active {
            if let Some(failure) = failure {
                let message = match failure {
                    EntrySaveFailure::UserFacing(message) => message.as_str(),
                    EntrySaveFailure::Internal => "Eintrag konnte nicht gelöscht werden.",
                };
                events.extend([
                    json!({"kind":"DELETION_CHANGE","value":null}),
                    json!({"kind":"WARNING_FEEDBACK"}),
                    json!({"kind":"ERROR","value":message}),
                    json!({"kind":"SAVING","value":false}),
                ]);
            } else {
                events.extend([
                    json!({"kind":"DELETION_FEEDBACK"}),
                    json!({"kind":"EXIT","value":{}}),
                ]);
            }
        }
        // The original successful delete keeps savingRef set until the exit
        // handshake dismisses this immutable editor session.
        let saving = self.busy || (active && failure.is_none());
        json!({"state":"DELETE_RETURNED","deleted":active&&failure.is_none(),"events":events,"saving":saving,"savingRef":saving})
    }
}
