//! Calendar-only checked sources. These are never report/finance snapshots.
pub mod assembly;
mod clock;
mod location;
mod registry;
mod rows;
pub use crate::contract::calendar_only::{CalendarClockIdentity, CalendarRowIdentity};
pub use clock::{CalendarClock, CalendarClockMetadata, CalendarClockOrigin};
pub(in crate::runtime) use registry::CalendarSlot;
pub use registry::{
    CalendarClockLease, CalendarClockMarker, CalendarRowsLease, CalendarRowsMarker,
};
pub use rows::CalendarRows;
