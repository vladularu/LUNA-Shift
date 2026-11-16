//! Same-Core loaded calendar admission. No host Ready entry list or report slot.
mod controller;
mod lease;
mod quota;
mod rank;
mod raw;
mod source;
mod types;
pub use controller::CalendarLoadedPool;
pub use lease::{LoadedReadSource, LoadedSubmissionCapture};
pub use raw::MAX_LOADED_SOURCE_BYTES;
pub use types::{
    CalendarLoadTicket, LoadedCompletionDraft, LoadedPoolError, LoadedQueryDraft, LoadedRawIntake,
    LoadedSnapshot, LoadedStart,
};
