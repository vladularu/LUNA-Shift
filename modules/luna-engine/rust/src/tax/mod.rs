//! Offline PAP 2026. Inputs/outputs use exact decimal arithmetic, not binary floats.
mod decimal;
mod pap_2026;

pub use decimal::{Decimal, PapError};
pub use pap_2026::{Pap2026Input, Pap2026Output, calculate_pap_2026};
