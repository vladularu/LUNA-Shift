//! Validated dated-remuneration inputs. Calculation families are activated only after their ports.
pub mod allowances;
pub mod annual;
pub mod assessment;
pub mod avrdd;
pub mod base;
pub mod care;
pub mod caritas;
pub mod context;
pub mod draft_facts;
pub mod draft_pay;
pub mod drk;
pub mod month;
pub mod overtime;
pub mod own_config;
pub mod premiums;
pub mod profile;
pub mod service_facts;
pub mod tariff_annual;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Presence<T> {
    #[default]
    Missing,
    Null,
    Value(T),
}
impl<T> Presence<T> {
    pub fn is_missing(&self) -> bool {
        matches!(self, Self::Missing)
    }
}
impl<T: Serialize> Serialize for Presence<T> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Missing | Self::Null => s.serialize_none(),
            Self::Value(value) => value.serialize(s),
        }
    }
}
impl<'de, T: Deserialize<'de>> Deserialize<'de> for Presence<T> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(match Option::<T>::deserialize(d)? {
            None => Self::Null,
            Some(value) => Self::Value(value),
        })
    }
}
pub(crate) fn required_nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemunerationError {
    Profile,
    Own,
    CareTvl,
    CareTval,
}
impl std::fmt::Display for RemunerationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self{Self::Profile=>"Das Vergütungsprofil ist ungültig oder wird noch nicht unterstützt.",Self::Own=>"Die Bausteine der eigenen Vergütung sind ungültig oder werden noch nicht unterstützt.",Self::CareTvl=>"Bitte die TV-L-Zulagenangaben prüfen.",Self::CareTval=>"Bitte die TVA-L-Tätigkeitszulagen prüfen."})
    }
}
impl std::error::Error for RemunerationError {}
impl RemunerationError {
    pub fn class_name(self) -> &'static str {
        match self {
            Self::Profile => "RemunerationProfileError",
            Self::Own => "OwnRemunerationError",
            Self::CareTvl | Self::CareTval => "UserFacingError",
        }
    }
}
