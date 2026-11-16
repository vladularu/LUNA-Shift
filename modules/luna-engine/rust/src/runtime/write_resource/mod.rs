//! Private raw storage contexts and single-use native write permits. The host
//! transports SQL rows and raw user intents; it cannot deserialize a ready plan.
mod calendar_delta;
mod permit;
mod source;
use crate::input::{InputError, profile_write::ProfileWriteError};
pub use calendar_delta::{
    CommittedCalendarChange, CommittedCalendarDelta, CommittedEntryKind, CommittedTemplateAction,
};
pub use permit::{CommittedNativeWrite, NativeWritePermit, TakenNativeWrite};
pub use source::{NativeWriteContext, WriteContextKind, WriteContextStamp};
#[derive(Debug)]
pub enum WriteResourceError {
    InvalidContext,
    InvalidStamp,
    OwnerChanged,
    ForeignPermit,
    AlreadyTaken,
    NotTaken,
    AlreadyCompleted,
    InputTooLarge,
    Poisoned,
    Input(InputError),
    Profile(ProfileWriteError),
}
impl From<InputError> for WriteResourceError {
    fn from(value: InputError) -> Self {
        Self::Input(value)
    }
}
impl From<ProfileWriteError> for WriteResourceError {
    fn from(value: ProfileWriteError) -> Self {
        Self::Profile(value)
    }
}
