use super::TemplateEditorDraft;
use crate::input::entry_editor_save::EntrySaveFailure;
use serde_json::{Value, json};

impl TemplateEditorDraft {
    pub fn save_state(&self) -> &'static str {
        if !self.busy {
            "IDLE"
        } else if self.fields["saving"] == true {
            "SAVING"
        } else {
            "DONE"
        }
    }
    /// Pure UI policy. The resource owner must first consume the genuine native
    /// sequence completion; a host boolean/receipt cannot authorize this call.
    pub fn submit_succeeded(&mut self, quick_date: Option<&str>) -> Vec<Value> {
        self.busy = true;
        self.fields["saving"] = json!(false);
        let mut effects = Vec::new();
        if quick_date.is_some_and(|date| !date.is_empty()) {
            effects.push(json!({"kind":"COMPLETE_SELECTION"}));
        }
        effects.extend([json!({"kind":"SUCCESS"}), json!({"kind":"BACK"})]);
        effects
    }
    pub fn submit_failed(
        &mut self,
        failure: &EntrySaveFailure,
        quick_date: Option<&str>,
        template_saved: bool,
    ) -> Vec<Value> {
        self.busy = false;
        self.fields["saving"] = json!(false);
        let message = if self.existing.is_null() && quick_date.is_some() && template_saved {
            "Vorlage gespeichert, Dienst nicht eingetragen. Versuche es erneut."
        } else {
            match failure {
                EntrySaveFailure::UserFacing(message) => message,
                EntrySaveFailure::Internal => "Vorlage konnte nicht gespeichert werden.",
            }
        };
        self.fields["error"] = json!(message);
        vec![json!({"kind":"WARNING"})]
    }
    /// Archive never enters SAVING/DONE and does not clear an earlier error on
    /// success. Both details are observable in the original form.
    pub fn archive_finished(&mut self, failure: Option<&EntrySaveFailure>) -> Vec<Value> {
        if self.existing.is_null() {
            return vec![];
        }
        if let Some(failure) = failure {
            self.fields["error"] = json!(match failure {
                EntrySaveFailure::UserFacing(message) => message.as_str(),
                EntrySaveFailure::Internal => "Löschen fehlgeschlagen.",
            });
            vec![]
        } else {
            vec![json!({"kind":"DELETION"}), json!({"kind":"BACK"})]
        }
    }
}
