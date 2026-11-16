//! Bounded prepared calendar resources with independent typed CalendarOnly or
//! existing report-snapshot admission. Neither locator is a ready source fact.
mod display;
mod model;
mod pages;
mod pool;
mod resource;
use super::SnapshotRegistry;
pub use model::{Completion, PoolStats, WindowPoolError};
use std::sync::{Arc, Mutex, atomic::AtomicBool};

#[derive(Clone)]
pub struct CalendarWindowPool {
    registry: SnapshotRegistry,
    book: Arc<Mutex<resource::Book>>,
    raw: Arc<AtomicBool>,
}
impl CalendarWindowPool {
    pub fn new(registry: SnapshotRegistry) -> Self {
        Self {
            registry,
            book: Arc::new(Mutex::new(resource::Book {
                bytes: 4096,
                ..Default::default()
            })),
            raw: Arc::new(AtomicBool::new(false)),
        }
    }
}
