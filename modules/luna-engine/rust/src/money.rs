use crate::EngineError;
use bigdecimal::BigDecimal;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

pub const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// Exact positive HALF_UP division matching the existing remuneration contract.
pub fn round_ratio(numerator: i64, denominator: i64) -> Result<i64, EngineError> {
    if !(0..=MAX_SAFE_INTEGER).contains(&numerator)
        || !(1..=MAX_SAFE_INTEGER).contains(&denominator)
    {
        return Err(EngineError::InvalidMoney);
    }
    let n = i128::from(numerator);
    let d = i128::from(denominator);
    i64::try_from((2 * n + d) / (2 * d)).map_err(|_| EngineError::Overflow)
}

/// Wire decimals are strings; floating point does not define money or credits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct DecimalValue(String);

impl DecimalValue {
    pub fn parse(text: &str) -> Result<Self, EngineError> {
        if text.len() > 160 || text.is_empty() {
            return Err(EngineError::InvalidMoney);
        }
        let body = text.strip_prefix('-').unwrap_or(text);
        if body.is_empty()
            || body.bytes().any(|b| !b.is_ascii_digit() && b != b'.')
            || body.bytes().filter(|b| *b == b'.').count() > 1
            || !body.bytes().any(|b| b.is_ascii_digit())
            || body.starts_with('.')
            || body.ends_with('.')
        {
            return Err(EngineError::InvalidMoney);
        }
        let value = BigDecimal::from_str(text).map_err(|_| EngineError::InvalidMoney)?;
        Ok(Self(value.normalized().to_plain_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for DecimalValue {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

/// Recorded minutes and weighted time credits deliberately use distinct types.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct WeightedMinutes(pub DecimalValue);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn half_cent_and_safe_integer_boundaries_remain_exact() {
        assert_eq!(round_ratio(1, 2), Ok(1));
        assert_eq!(round_ratio(1, 3), Ok(0));
        assert_eq!(round_ratio(5, 2), Ok(3));
        assert_eq!(round_ratio(MAX_SAFE_INTEGER, 1), Ok(MAX_SAFE_INTEGER));
        assert_eq!(round_ratio(MAX_SAFE_INTEGER, 2), Ok(4_503_599_627_370_496));
        assert!(round_ratio(-1, 2).is_err());
        assert!(round_ratio(1, 0).is_err());
        assert!(round_ratio(MAX_SAFE_INTEGER + 1, 1).is_err());
    }

    #[test]
    fn fractional_time_credit_is_not_rounded_to_whole_minutes() {
        let credit: WeightedMinutes = serde_json::from_str("\"519.75\"").expect("fixture");
        assert_eq!(credit.0.as_str(), "519.75");
        assert_eq!(
            DecimalValue::parse("016.800").expect("fixture").as_str(),
            "16.8"
        );
        for input in ["NaN", "1e99999", ".5", "1.", "--1", ""] {
            assert!(DecimalValue::parse(input).is_err());
        }
    }
}
