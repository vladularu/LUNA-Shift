//! ECMAScript JSON.stringify semantics for native draft identities.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JsonStringifyError;
use serde_json::Value;
fn index(key: &str) -> Option<u32> {
    let number = key.parse::<u32>().ok()?;
    (number < u32::MAX && number.to_string() == key).then_some(number)
}
fn write(value: &Value, output: &mut String, depth: usize) -> Result<(), JsonStringifyError> {
    if depth > 128 {
        return Err(JsonStringifyError);
    }
    match value {
        Value::Null => output.push_str("null"),
        Value::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
        Value::Number(number) => {
            let value = number.as_f64().ok_or(JsonStringifyError)?;
            if !value.is_finite() {
                return Err(JsonStringifyError);
            }
            output.push_str(&number_text(value));
        }
        Value::String(value) => {
            output.push_str(&serde_json::to_string(value).map_err(|_| JsonStringifyError)?)
        }
        Value::Array(values) => {
            output.push('[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                write(value, output, depth + 1)?;
            }
            output.push(']');
        }
        Value::Object(values) => {
            output.push('{');
            let mut keys = values.keys().collect::<Vec<_>>();
            // JSON.stringify enumerates canonical array-index keys numerically first,
            // retaining insertion order for every other own string key.
            keys.sort_by_key(|key| index(key).map_or((1, 0), |index| (0, index)));
            for (position, key) in keys.into_iter().enumerate() {
                if position > 0 {
                    output.push(',');
                }
                output.push_str(&serde_json::to_string(key).map_err(|_| JsonStringifyError)?);
                output.push(':');
                write(&values[key], output, depth + 1)?;
            }
            output.push('}');
        }
    }
    Ok(())
}
pub fn stringify(value: &Value) -> Result<String, JsonStringifyError> {
    let mut output = String::new();
    write(value, &mut output, 0)?;
    Ok(output)
}

pub(crate) fn number_text(value: f64) -> String {
    if value.is_nan() {
        "NaN".into()
    } else if value == f64::INFINITY {
        "Infinity".into()
    } else if value == f64::NEG_INFINITY {
        "-Infinity".into()
    } else if value == 0.0 {
        "0".into()
    } else {
        ryu_js::Buffer::new().format(value).to_owned()
    }
}
