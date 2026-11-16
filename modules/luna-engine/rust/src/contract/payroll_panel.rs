//! A bounded requested view, never caller-provided calculated finance.
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PayrollPanel {
    Components,
    Basis,
    SpecialDuties,
    TariffAssessment,
}
pub(super) fn optional<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<PayrollPanel>, D::Error> {
    PayrollPanel::deserialize(d).map(Some)
}
