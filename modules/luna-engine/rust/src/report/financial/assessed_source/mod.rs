//! Native assessed-month provider over immutable admitted source owners.
mod book;
mod cache;
mod fingerprint;
pub mod input;
pub mod requirements;
mod reuse;
mod row_index;
mod session;
pub use book::AssessedSourceBook;
pub use cache::CacheStats;
pub use reuse::SharedAssessedReuseCache;
pub use session::AssessedSession;
