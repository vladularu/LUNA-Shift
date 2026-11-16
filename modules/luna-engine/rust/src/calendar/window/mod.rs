//! Immutable source-index/date-overlay composition. No runtime admission yet.
mod borrowed;
mod index;
mod model;
mod projection;
mod source;
mod view;
pub use borrowed::{
    CalendarEntrySource, CalendarRecordRef, CalendarRecordSource, SharedCalendarSourceIndex,
};
pub use model::{WindowBounds, WindowError, WindowOptions, WindowSpec};
pub use projection::{PreparedCalendarWindow, SortedCalendarWindow};
pub use source::CalendarSourceIndex;
pub use view::{CalendarEntryView, CalendarWindowView};
