//! Exact decimal operations matching the PAP's Java BigDecimal DOWN/UP semantics.
use bigdecimal::BigDecimal;
use num_bigint::BigInt;
use num_traits::{One, Signed, ToPrimitive, Zero};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::{cmp::Ordering, fmt, str::FromStr};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PapError {
    InvalidDecimal,
    DivisionByZero,
    NonTerminatingDivision,
    IntegerOverflow,
    ScaleLimit,
    InvalidTableIndex,
}
impl fmt::Display for PapError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let code = match self {
            Self::InvalidDecimal => "INVALID_DECIMAL",
            Self::DivisionByZero => "DIVISION_BY_ZERO",
            Self::NonTerminatingDivision => "NON_TERMINATING_DIVISION",
            Self::IntegerOverflow => "INTEGER_OVERFLOW",
            Self::ScaleLimit => "SCALE_LIMIT",
            Self::InvalidTableIndex => "INVALID_TABLE_INDEX",
        };
        f.write_str(code)
    }
}
impl std::error::Error for PapError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rounding {
    Down,
    Up,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decimal(BigDecimal);

fn ten_pow(exponent: i64) -> Result<BigInt, PapError> {
    let exponent = u32::try_from(exponent).map_err(|_| PapError::ScaleLimit)?;
    if exponent > 4096 {
        return Err(PapError::ScaleLimit);
    }
    Ok(BigInt::from(10).pow(exponent))
}

impl Decimal {
    pub fn zero() -> Self {
        Self(BigDecimal::from(0))
    }
    pub fn one() -> Self {
        Self(BigDecimal::from(1))
    }
    pub fn from_i64(value: i64) -> Self {
        Self(BigDecimal::from(value))
    }
    pub fn from_parts(coefficient: i64, scale: i64) -> Self {
        Self(BigDecimal::new(BigInt::from(coefficient), scale))
    }
    pub fn parse(value: &str) -> Result<Self, PapError> {
        if value.len() > 256 || value.is_empty() {
            return Err(PapError::InvalidDecimal);
        }
        let parsed = BigDecimal::from_str(value).map_err(|_| PapError::InvalidDecimal)?;
        let (_, scale) = parsed.as_bigint_and_exponent();
        if !(-256..=256).contains(&scale) {
            return Err(PapError::ScaleLimit);
        }
        Ok(Self(parsed))
    }
    pub fn add(&self, rhs: Self) -> Self {
        Self(&self.0 + &rhs.0)
    }
    pub fn sub(&self, rhs: Self) -> Self {
        Self(&self.0 - &rhs.0)
    }
    pub fn mul(&self, rhs: Self) -> Self {
        Self(&self.0 * &rhs.0)
    }
    pub fn compare(&self, rhs: Self) -> i64 {
        match self.0.cmp(&rhs.0) {
            Ordering::Less => -1,
            Ordering::Equal => 0,
            Ordering::Greater => 1,
        }
    }
    pub fn div_scaled(&self, rhs: Self, scale: i64, rounding: Rounding) -> Result<Self, PapError> {
        let (a, sa) = self.0.as_bigint_and_exponent();
        let (b, sb) = rhs.0.as_bigint_and_exponent();
        if b.is_zero() {
            return Err(PapError::DivisionByZero);
        }
        let shift = sb
            .checked_add(scale)
            .and_then(|n| n.checked_sub(sa))
            .ok_or(PapError::ScaleLimit)?;
        let (numerator, denominator) = if shift >= 0 {
            (a * ten_pow(shift)?, b)
        } else {
            (
                a,
                b * ten_pow(shift.checked_neg().ok_or(PapError::ScaleLimit)?)?,
            )
        };
        let mut quotient = &numerator / &denominator;
        let remainder = &numerator % &denominator;
        if rounding == Rounding::Up && !remainder.is_zero() {
            quotient += numerator.signum() * denominator.signum();
        }
        Ok(Self(BigDecimal::new(quotient, scale)))
    }
    pub fn set_scale(&self, scale: i64, rounding: Rounding) -> Result<Self, PapError> {
        self.div_scaled(Self::one(), scale, rounding)
    }
    pub fn div_exact(&self, rhs: Self) -> Result<Self, PapError> {
        let (a, sa) = self.0.as_bigint_and_exponent();
        let (b, sb) = rhs.0.as_bigint_and_exponent();
        if b.is_zero() {
            return Err(PapError::DivisionByZero);
        }
        // Reduce coefficient fraction before determining the necessary decimal scale.
        let mut x = a.abs();
        let mut y = b.abs();
        while !y.is_zero() {
            let remainder = &x % &y;
            x = y;
            y = remainder;
        }
        let mut denominator = b.abs() / x;
        let mut twos = 0i64;
        let mut fives = 0i64;
        while (&denominator % 2u8).is_zero() {
            denominator /= 2u8;
            twos += 1;
        }
        while (&denominator % 5u8).is_zero() {
            denominator /= 5u8;
            fives += 1;
        }
        if denominator != BigInt::one() {
            return Err(PapError::NonTerminatingDivision);
        }
        let scale = sa
            .checked_sub(sb)
            .and_then(|n| n.checked_add(twos.max(fives)))
            .ok_or(PapError::ScaleLimit)?;
        self.div_scaled(rhs, scale, Rounding::Down)
    }
    pub fn trunc_i64(&self) -> Result<i64, PapError> {
        let scaled = self.set_scale(0, Rounding::Down)?;
        let (value, _) = scaled.0.as_bigint_and_exponent();
        value.to_i64().ok_or(PapError::IntegerOverflow)
    }
    pub fn canonical(&self) -> String {
        self.0.normalized().to_string()
    }
}
impl Serialize for Decimal {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.canonical())
    }
}
impl<'de> Deserialize<'de> for Decimal {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        let text = match value {
            serde_json::Value::String(text) => text,
            serde_json::Value::Number(number) => number.to_string(),
            _ => return Err(serde::de::Error::custom("INVALID_DECIMAL")),
        };
        Self::parse(&text).map_err(serde::de::Error::custom)
    }
}
pub fn optional_i64<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<i64>, D::Error> {
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    value
        .map(|value| match value {
            serde_json::Value::Number(number) => number
                .as_i64()
                .ok_or_else(|| serde::de::Error::custom("INVALID_INTEGER")),
            serde_json::Value::String(text) => text
                .parse::<i64>()
                .map_err(|_| serde::de::Error::custom("INVALID_INTEGER")),
            _ => Err(serde::de::Error::custom("INVALID_INTEGER")),
        })
        .transpose()
}
pub fn table_value(table: &[&str], index: i64) -> Result<Decimal, PapError> {
    let index = usize::try_from(index).map_err(|_| PapError::InvalidTableIndex)?;
    let value = table.get(index).ok_or(PapError::InvalidTableIndex)?;
    Decimal::parse(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn d(s: &str) -> Decimal {
        Decimal::parse(s).expect("test literal")
    }
    #[test]
    fn rounds_toward_and_away_from_zero() {
        for (value, down, up) in [
            ("1.239", "1.23", "1.24"),
            ("-1.239", "-1.23", "-1.24"),
            ("1.230", "1.23", "1.23"),
        ] {
            assert_eq!(
                d(value).set_scale(2, Rounding::Down).expect("round"),
                d(down)
            );
            assert_eq!(d(value).set_scale(2, Rounding::Up).expect("round"), d(up));
        }
    }
    #[test]
    fn divides_without_precision_context() {
        assert_eq!(d("900").div_exact(d("12")).expect("exact"), d("75"));
        assert_eq!(d("81").div_exact(d("12")).expect("exact"), d("6.75"));
        assert_eq!(d("0").div_exact(d("12")).expect("exact"), d("0"));
        assert_eq!(
            d("1").div_exact(d("3")),
            Err(PapError::NonTerminatingDivision)
        );
        assert_eq!(d("1").div_exact(d("0")), Err(PapError::DivisionByZero));
        assert_eq!(
            d("-1").div_scaled(d("3"), 2, Rounding::Up).expect("round"),
            d("-0.34")
        );
    }
    #[test]
    fn validates_scale_and_table_bounds() {
        assert_eq!(Decimal::parse("1e1000000"), Err(PapError::ScaleLimit));
        assert_eq!(table_value(&["0"], -1), Err(PapError::InvalidTableIndex));
        assert_eq!(table_value(&["0"], 1), Err(PapError::InvalidTableIndex));
    }
}
