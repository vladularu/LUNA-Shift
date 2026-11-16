//! Original Provider load selection and retained-entry policy.
//! Pure native policy only: no owner admission, Ready-source deserialization or IO capability.
mod model;
mod reconcile;
mod rows;
mod state;
mod template_overlay;
pub use model::{CalendarLoadRange, ScopeEntries, ScopeEntry, ScopeError};
pub use rows::{PreparedScopeEntries, RawScopeRows};
pub use state::{
    CalendarLoadedScope, ScopeCompletionDraft, ScopeLoadCompletion, ScopeLoadFailure,
    ScopeLoadStart, ScopeLoadStatus,
};
pub use template_overlay::TemplateDisplay;
#[cfg(test)]
mod overlay_tests;
#[cfg(test)]
mod tests;
