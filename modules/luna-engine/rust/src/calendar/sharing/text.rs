use super::{SharedEntry, SharingError};

/// JavaScript string length/prefix use UTF-16 units, including a split surrogate.
/// No sanitizing, trimming, or replacement is performed by these codec helpers.
pub(crate) fn utf16_len(raw: &str) -> usize {
    raw.encode_utf16().count()
}
pub(crate) fn utf16_prefix(raw: &str, units: usize) -> Vec<u16> {
    raw.encode_utf16().take(units).collect()
}

pub(super) fn valid_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(i, b)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                *b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
        && matches!(bytes[14], b'1'..=b'5')
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b' | b'A' | b'B')
}
fn js_whitespace(unit: u16) -> bool {
    matches!(unit,0x0009..=0x000d|0x0020|0x00a0|0x1680|0x2000..=0x200a|0x2028|0x2029|0x202f|0x205f|0x3000|0xfeff)
}
pub(super) fn title(raw: &str, fallback: &str) -> Vec<u16> {
    let units = raw
        .encode_utf16()
        .filter(|u| !matches!(u,0..=31|127..=159))
        .collect::<Vec<_>>();
    let start = units
        .iter()
        .position(|u| !js_whitespace(*u))
        .unwrap_or(units.len());
    let end = units
        .iter()
        .rposition(|u| !js_whitespace(*u))
        .map_or(start, |i| i + 1);
    if start == end {
        fallback.encode_utf16().collect()
    } else {
        units[start..end].iter().take(128).copied().collect()
    }
}
pub(super) fn note(raw: &str) -> Option<Vec<u16>> {
    let units = raw
        .encode_utf16()
        .filter(|u| !matches!(u,0..=8|11|12|14..=31|127..=159))
        .take(4096)
        .collect::<Vec<_>>();
    (!units.is_empty()).then_some(units)
}
// JSON.stringify is well-formed for lone UTF-16 surrogates created by .slice().
fn quote(units: &[u16]) -> String {
    let mut result = String::from("\"");
    for decoded in char::decode_utf16(units.iter().copied()) {
        match decoded {
            Err(error) => result.push_str(&format!("\\u{:04x}", error.unpaired_surrogate())),
            Ok(c) => match c {
                '"' => result.push_str("\\\""),
                '\\' => result.push_str("\\\\"),
                '\u{0008}' => result.push_str("\\b"),
                '\t' => result.push_str("\\t"),
                '\n' => result.push_str("\\n"),
                '\u{000c}' => result.push_str("\\f"),
                '\r' => result.push_str("\\r"),
                c if c < '\u{0020}' => result.push_str(&format!("\\u{:04x}", u32::from(c))),
                c => result.push(c),
            },
        }
    }
    result.push('"');
    result
}
fn string(raw: &str) -> String {
    quote(&raw.encode_utf16().collect::<Vec<_>>())
}
pub(super) fn signature(entries: &[SharedEntry]) -> Result<String, SharingError> {
    let mut rows = Vec::with_capacity(entries.len());
    for entry in entries {
        let pause = match entry.break_minutes {
            None => "null".to_owned(),
            Some(n) if !n.is_finite() => return Err(SharingError::invalid()),
            Some(0.0) => "0".to_owned(),
            Some(n) => ryu_js::Buffer::new().format_finite(n).to_owned(),
        };
        rows.push(format!(
            "[{},{},{},{},{},{},{},{},{},{}]",
            string(&entry.starts_at),
            string(&entry.ends_at),
            string(&entry.time_zone),
            entry.all_day,
            quote(&entry.title_utf16),
            string(&entry.color),
            string(&entry.symbol),
            entry.kind.as_deref().map_or_else(|| "null".into(), string),
            entry
                .note_utf16
                .as_ref()
                .and_then(Option::as_ref)
                .map_or_else(|| "null".into(), |units| quote(units)),
            pause
        ));
    }
    rows.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    Ok(format!(
        "[{}]",
        rows.iter()
            .map(|row| string(row))
            .collect::<Vec<_>>()
            .join(",")
    ))
}
