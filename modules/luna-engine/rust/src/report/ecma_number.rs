//! Exact finite-number text for checked native presentation values.
//! Number.prototype.toFixed: https://tc39.es/ecma262/#sec-number.prototype.tofixed
use num_bigint::BigUint;

pub fn string(value: f64) -> Option<String> {
    if !value.is_finite() {
        return None;
    }
    Some(crate::input::javascript_json::number_text(value))
}

pub fn fixed(value: f64, fraction_digits: u32) -> Option<String> {
    if !value.is_finite() || fraction_digits > 100 {
        return None;
    }
    if value.abs() >= 1e21 {
        return string(value);
    }
    let bits = value.to_bits() & !(1u64 << 63);
    let exponent = ((bits >> 52) & 0x7ff) as i32;
    let mantissa = bits & ((1u64 << 52) - 1);
    let (mantissa, exponent) = if exponent == 0 {
        (mantissa, -1074)
    } else {
        (mantissa | (1u64 << 52), exponent - 1023 - 52)
    };
    let mut numerator = BigUint::from(mantissa) * BigUint::from(10u8).pow(fraction_digits);
    let denominator = if exponent >= 0 {
        numerator <<= exponent as usize;
        BigUint::from(1u8)
    } else {
        BigUint::from(1u8) << (-exponent) as usize
    };
    let mut rounded = &numerator / &denominator;
    let remainder = numerator % &denominator;
    if (remainder << 1usize) >= denominator {
        rounded += 1u8;
    }
    let decimal = rounded.to_str_radix(10);
    let digits = fraction_digits as usize;
    let mut result = if digits == 0 {
        decimal
    } else if decimal.len() <= digits {
        format!("0.{}{}", "0".repeat(digits - decimal.len()), decimal)
    } else {
        format!(
            "{}.{}",
            &decimal[..decimal.len() - digits],
            &decimal[decimal.len() - digits..]
        )
    };
    // ECMA's sign test is x<0, so -0 loses its sign while negative nonzero
    // values which round to zero retain it.
    if value < 0.0 {
        result.insert(0, '-');
    }
    Some(result)
}
