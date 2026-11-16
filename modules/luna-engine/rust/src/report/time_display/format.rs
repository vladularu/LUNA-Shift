use super::TimeDisplayError;
use crate::input::{form_number::round, javascript_json::number_text};
fn finite(value: f64) -> Result<(), TimeDisplayError> {
    value.is_finite().then_some(()).ok_or(TimeDisplayError)
}
fn pad(number: f64) -> String {
    let text = number_text(number);
    if text.len() < 2 {
        format!("0{text}")
    } else {
        text
    }
}
pub(crate) fn minutes(value: f64) -> Result<String, TimeDisplayError> {
    finite(value)?;
    let absolute = value.abs();
    Ok(format!(
        "{}{}:{}",
        if value < 0.0 { "−" } else { "" },
        number_text((absolute / 60.0).floor()),
        pad(absolute % 60.0)
    ))
}
pub(crate) fn signed(value: f64) -> Result<String, TimeDisplayError> {
    Ok(format!(
        "{}{}",
        if value >= 0.0 { "+" } else { "−" },
        minutes(value.abs())?
    ))
}
pub(crate) fn precise(value: f64) -> Result<String, TimeDisplayError> {
    finite(value)?;
    let seconds = round(value.abs() * 60.0);
    finite(seconds)?;
    let clock = format!(
        "{}:{}",
        number_text((seconds / 3600.0).floor()),
        pad((seconds / 60.0).floor() % 60.0)
    );
    Ok(format!(
        "{}{}{}",
        if value < 0.0 { "−" } else { "" },
        clock,
        if seconds % 60.0 != 0.0 {
            format!(":{}", pad(seconds % 60.0))
        } else {
            String::new()
        }
    ))
}
