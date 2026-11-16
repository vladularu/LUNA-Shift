//! Full source-bound profile/history storage policy. Raw table rows are input;
//! calculated output profiles never become SnapshotFacts or host Ready inputs.
use super::super::{InputError, profile_editor::ProfileFields};
use super::sql_state::{State, project};
use serde_json::{Value, json};
use std::sync::Arc;
pub(super) const CONFLICT: &str = "Deine Angaben wurden inzwischen geändert. Bitte erneut öffnen.";
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileWriteRoute {
    EmploymentRepository,
    AppPort,
}
#[derive(Debug)]
pub enum ProfileWriteError {
    Input(InputError),
    Concurrency(&'static str),
}
impl ProfileWriteError {
    pub fn name(&self) -> &str {
        match self {
            Self::Input(e) => e.name(),
            Self::Concurrency(_) => "ConcurrencyError",
        }
    }
    pub fn message(&self) -> &str {
        match self {
            Self::Input(e) => e.message(),
            Self::Concurrency(message) => message,
        }
    }
    pub fn is_user_facing(&self) -> bool {
        match self {
            Self::Input(e) => e.user_facing_message().is_some(),
            Self::Concurrency(_) => true,
        }
    }
}
impl From<InputError> for ProfileWriteError {
    fn from(e: InputError) -> Self {
        Self::Input(e)
    }
}
pub struct ProfileWriteSource {
    raw: State,
}
pub struct NativeProfileWritePlan {
    body: Value,
    output: Value,
    state: State,
}
impl NativeProfileWritePlan {
    pub(crate) fn into_returned_profile(self) -> Arc<Value> {
        Arc::new(self.output)
    }
    pub fn value(&self) -> &Value {
        &self.body
    }
    pub fn returned_profile(&self) -> &Value {
        &self.output
    }
    /// Diagnostic/native commit-verification postimage, not a serialized source admission.
    pub fn reference_state(&self) -> Value {
        self.state.reference()
    }
}
impl ProfileWriteSource {
    pub fn try_from_raw_state(raw: Value) -> Result<Self, InputError> {
        State::new(raw).map(|raw| Self { raw })
    }
    pub fn prepare(
        &self,
        raw: &impl ProfileFields,
        route: ProfileWriteRoute,
        epoch: f64,
    ) -> Result<NativeProfileWritePlan, ProfileWriteError> {
        let mut state = self.raw.clone();
        let stored = state.load_profile()?;
        let validity = raw
            .field("validity")
            .filter(|value| crate::net::js_truthy(value));
        let mut output = if let Some(validity) = validity {
            let stored = stored.ok_or_else(|| {
                InputError::validation("Bitte zuerst dein Arbeitsprofil anlegen.")
            })?;
            let history = state.profiles()?;
            let projected = project(&state, stored.clone(), epoch)?;
            let legacy = state.pattern()?;
            let mut current = projected.as_ref().clone();
            if current.get("workPattern").is_none_or(Value::is_null) {
                current["workPattern"] = legacy.clone();
            }
            let timeline = crate::input::javascript_json::stringify(&json!(history.as_ref()))
                .map_err(|_| super::invalid())?;
            if validity["expectedProfileUpdatedAt"] != current["updatedAt"]
                || validity["expectedTimeline"] != timeline
            {
                return Err(ProfileWriteError::Concurrency(CONFLICT));
            }
            if validity
                .get("restoreTimeline")
                .is_some_and(crate::net::js_truthy)
            {
                super::sql_history::restore(
                    &mut state, raw, &stored, &current, &history, validity, epoch,
                )?
            } else {
                super::sql_history::save(
                    &mut state,
                    raw,
                    super::sql_history::EmploymentSaveContext {
                        stored: &stored,
                        current: &current,
                        history: &history,
                        validity,
                        legacy: &legacy,
                        epoch,
                    },
                )?
            }
        } else {
            let saved = state.write_profile(raw, epoch)?;
            if route == ProfileWriteRoute::EmploymentRepository {
                project(&state, saved, epoch)?
            } else {
                saved
            }
        };
        if route == ProfileWriteRoute::AppPort {
            output = project(&state, output, epoch)?;
            let mut profile = output.as_ref().clone();
            profile["employmentTimeline"] = json!(state.profiles()?.as_ref());
            output = Arc::new(profile);
        }
        let body = json!({"schemaVersion":1,"guards":state.guards,"mutations":state.ops});
        Ok(NativeProfileWritePlan {
            body,
            output: output.as_ref().clone(),
            state,
        })
    }
}
