//! Temporal PlainDate normalization; wider civil range and calendar annotations.
use jiff::{civil::Date, fmt::temporal::DateTimeParser};
pub(super) fn normalize(raw: &str) -> Option<String> {
    if raw.starts_with("-000000") || raw.contains('−') {
        return None;
    }
    let signed = matches!(raw.as_bytes().first(), Some(b'+' | b'-'));
    let width = if signed { 7 } else { 4 };
    let year = raw.get(..width)?.parse::<i32>().ok()?;
    let surrogate = if !(-9999..=9999).contains(&year) {
        2000 + year.rem_euclid(400)
    } else {
        year
    };
    let mut text = if surrogate != year {
        format!("{surrogate:04}{}", raw.get(width..)?)
    } else {
        raw.to_owned()
    };
    let adjusted_width = if surrogate != year { 4 } else { width };
    let date_end = adjusted_width
        + if text.as_bytes().get(adjusted_width) == Some(&b'-') {
            6
        } else {
            4
        };
    if let Some(rest) = text.get(date_end..) {
        let next = rest.trim_start_matches(crate::remuneration::own_config::javascript_space);
        let spaces = rest.len() - next.len();
        if spaces > 0 {
            text.replace_range(date_end..date_end + spaces, "T");
        }
    }
    let mut at = text.find('[').unwrap_or(text.len());
    let mut calendar = None;
    let mut critical_seen = false;
    let (mut generic_seen, mut zone_seen) = (false, false);
    while at < text.len() {
        let end = at + text.get(at..)?.find(']')? + 1;
        let annotation = text.get(at + 1..end - 1)?;
        let critical = annotation.starts_with('!');
        let annotation = annotation.strip_prefix('!').unwrap_or(annotation);
        if annotation.contains('=') {
            generic_seen = true;
        } else {
            if generic_seen || zone_seen {
                return None;
            }
            zone_seen = true;
        }
        if let Some(value) = annotation.strip_prefix("u-ca=") {
            if calendar.is_some() && (critical || critical_seen) {
                return None;
            }
            if calendar.is_none() {
                let value = value.to_ascii_lowercase();
                let canonical = match value.as_str() {
                    "islamicc" => "islamic-civil",
                    "ethiopic-amete-alem" => "ethioaa",
                    "buddhist" | "chinese" | "coptic" | "dangi" | "ethioaa" | "ethiopic"
                    | "gregory" | "hebrew" | "indian" | "islamic" | "islamic-civil"
                    | "islamic-rgsa" | "islamic-tbla" | "islamic-umalqura" | "iso8601"
                    | "japanese" | "persian" | "roc" => value.as_str(),
                    _ => return None,
                };
                calendar = Some(canonical.to_owned());
                critical_seen = critical;
            }
            text.replace_range(at..end, "");
        } else {
            at = end;
        }
        if at < text.len() && text.as_bytes()[at] != b'[' {
            return None;
        }
    }
    let date = DateTimeParser::new().parse_date(text).ok()?;
    if (year, date.month(), date.day()) < (-271821, 4, 19)
        || (year, date.month(), date.day()) > (275760, 9, 13)
    {
        return None;
    }
    let printed_year = if year < 0 {
        format!("-{abs:06}", abs = year.unsigned_abs())
    } else if year > 9999 {
        format!("+{year:06}")
    } else {
        format!("{year:04}")
    };
    let calendar = calendar
        .filter(|c| c != "iso8601")
        .map_or(String::new(), |c| format!("[u-ca={c}]"));
    Some(format!(
        "{printed_year}-{:02}-{:02}{calendar}",
        date.month(),
        date.day()
    ))
}
/// Equal Gregorian leap rules; old offsets are fixed and future POSIX rules
/// repeat every400 years. A surrogate avoids narrowing Temporal's civil range.
pub(super) fn surrogate(raw: &str) -> Option<(Date, i64)> {
    let normalized = normalize(raw)?;
    let width = if matches!(normalized.as_bytes().first(), Some(b'+' | b'-')) {
        7
    } else {
        4
    };
    let year = normalized.get(..width)?.parse::<i32>().ok()?;
    let replacement = if year > 9999 {
        9200 + year.rem_euclid(400)
    } else if year < -9999 {
        -9600 + year.rem_euclid(400)
    } else {
        year
    };
    let rest = normalized.get(width..)?.split('[').next()?;
    let date = format!(
        "{}{rest}",
        if replacement < 0 {
            format!("-{:06}", replacement.unsigned_abs())
        } else {
            format!("{replacement:04}")
        }
    )
    .parse()
    .ok()?;
    Some((date, i64::from((year - replacement) / 400)))
}
