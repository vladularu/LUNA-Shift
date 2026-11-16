//! Explicit view intent. A sender can select work, never supply ready finance.
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct PayrollPageIntent;
impl Serialize for PayrollPageIntent {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_bool(true)
    }
}
impl<'de> Deserialize<'de> for PayrollPageIntent {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        if bool::deserialize(d)? {
            Ok(Self)
        } else {
            Err(serde::de::Error::custom(
                "payrollPage must be true when present",
            ))
        }
    }
}
pub(super) fn optional<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<PayrollPageIntent>, D::Error> {
    PayrollPageIntent::deserialize(d).map(Some)
}
