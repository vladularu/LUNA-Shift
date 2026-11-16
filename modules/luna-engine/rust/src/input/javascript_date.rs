//! Date TimeClip and UTC ISO output. No ambient clock or system timezone read.
use super::InputError;

fn invalid() -> InputError {
    InputError::source("Invalid time value", "RangeError")
}
pub fn iso_from_epoch_milliseconds(raw: f64) -> Result<String, InputError> {
    const MAX: f64 = 8_640_000_000_000_000.0;
    const CYCLE_MS: i64 = 146097 * 86400 * 1000;
    if !raw.is_finite() || raw.abs() > MAX {
        return Err(invalid());
    }
    // TimeClip truncates toward zero. The accepted range is within the exact
    // integer range of Number; -0 and +0 represent the same Date instant.
    let milliseconds = raw.trunc() as i64;
    let cycles = milliseconds.div_euclid(CYCLE_MS);
    let remainder = milliseconds.rem_euclid(CYCLE_MS);
    // Every400 Gregorian years has146097 days. Map to1970..2369 so the pinned
    // civil parser can format the complete Date range without narrowing it.
    let instant = jiff::Timestamp::from_millisecond(remainder).map_err(|_| invalid())?;
    let utc = instant.to_zoned(jiff::tz::TimeZone::UTC);
    let date = utc.date();
    let time = utc.time();
    let year = i64::from(date.year()) + cycles * 400;
    let year = if year < 0 {
        format!("-{:06}", year.unsigned_abs())
    } else if year > 9999 {
        format!("+{year:06}")
    } else {
        format!("{year:04}")
    };
    Ok(format!(
        "{year}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        date.month(),
        date.day(),
        time.hour(),
        time.minute(),
        time.second(),
        remainder % 1000,
    ))
}
