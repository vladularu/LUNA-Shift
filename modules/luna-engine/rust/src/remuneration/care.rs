//! Personal evidence only. No amounts or professional qualifications are inferred here.
use super::{Presence, RemunerationError, required_nullable};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TvlClinical {
    None,
    DirectLower,
    DirectHigher,
    LeaderLower,
    LeaderHigher,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TvalClinical {
    None,
    Lower,
    Higher,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FunctionDuty {
    None,
    Function,
    Leadership,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeadershipAnnexF {
    None,
    Number(u8),
}
impl Serialize for LeadershipAnnexF {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::None => s.serialize_str("NONE"),
            Self::Number(n) => s.serialize_u8(*n),
        }
    }
}
impl<'de> Deserialize<'de> for LeadershipAnnexF {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Input {
            Text(String),
            Number(u8),
        }
        match Input::deserialize(d)? {
            Input::Text(s) if s == "NONE" => Ok(Self::None),
            Input::Number(n) if (2..=7).contains(&n) => Ok(Self::Number(n)),
            _ => Err(serde::de::Error::custom(RemunerationError::CareTvl)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TvlCareAllowances {
    #[serde(deserialize_with = "required_nullable")]
    pub paid_entitlement: Option<bool>,
    #[serde(deserialize_with = "required_nullable")]
    pub nursing: Option<bool>,
    #[serde(deserialize_with = "required_nullable")]
    pub instructor: Option<bool>,
    #[serde(deserialize_with = "required_nullable")]
    pub clinical: Option<TvlClinical>,
    #[serde(deserialize_with = "required_nullable")]
    pub leadership_annex_f_number: Option<LeadershipAnnexF>,
    #[serde(deserialize_with = "required_nullable")]
    pub burn_care: Option<bool>,
    /// Earlier unpublished v5 drafts omit this key. Missing is distinct from explicit null.
    #[serde(default, skip_serializing_if = "Presence::is_missing")]
    pub function_duty: Presence<FunctionDuty>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TvalCareAllowances {
    #[serde(deserialize_with = "required_nullable")]
    pub paid_entitlement: Option<bool>,
    #[serde(deserialize_with = "required_nullable")]
    pub clinical: Option<TvalClinical>,
    #[serde(deserialize_with = "required_nullable")]
    pub burn_care: Option<bool>,
}
pub fn validate_tvl_care(value: &Value) -> Result<Option<TvlCareAllowances>, RemunerationError> {
    Option::<TvlCareAllowances>::deserialize(value).map_err(|_| RemunerationError::CareTvl)
}
pub fn validate_tval_care(value: &Value) -> Result<Option<TvalCareAllowances>, RemunerationError> {
    Option::<TvalCareAllowances>::deserialize(value).map_err(|_| RemunerationError::CareTval)
}
