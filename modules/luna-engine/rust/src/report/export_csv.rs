//! Final CSV text over already-native reporting outputs, without JSON/plan copies.
use super::{ecma_number, export_rows::ReportEntry};
use crate::{
    calendar::parse_date,
    target::{AdjustmentKind, AdjustmentStatus, MonthlyTarget, TargetStatus},
};
use std::borrow::Cow;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CsvError {
    InvalidData,
    BudgetExceeded,
}
impl std::fmt::Display for CsvError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidData => "Die Exportdaten sind ungültig.",
            Self::BudgetExceeded => "Der Export überschreitet die unterstützte Größe.",
        })
    }
}
impl std::error::Error for CsvError {}
struct Writer {
    text: String,
    limit: usize,
}
impl Writer {
    fn push(&mut self, text: &str) -> Result<(), CsvError> {
        if self
            .text
            .len()
            .checked_add(text.len())
            .is_none_or(|len| len > self.limit)
        {
            return Err(CsvError::BudgetExceeded);
        }
        self.text.push_str(text);
        Ok(())
    }
    fn row(&mut self, cells: &[Cow<'_, str>]) -> Result<(), CsvError> {
        for (index, value) in cells.iter().enumerate() {
            if index > 0 {
                self.push(";")?;
            }
            self.push("\"")?;
            if formula(value) {
                self.push("'")?;
            }
            for c in value.chars() {
                if c == '"' {
                    self.push("\"\"")?;
                } else {
                    self.push(c.encode_utf8(&mut [0u8; 4]))?;
                }
            }
            self.push("\"")?;
        }
        self.push("\r\n")
    }
}
fn formula(value: &str) -> bool {
    let leading=value.chars().find(|c| !matches!(c,'\u{0}'..='\u{20}'|'\u{a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}'));
    if !matches!(leading, Some('=' | '+' | '@' | '-')) {
        return false;
    }
    let numeric_minus = value.strip_prefix('-').is_some_and(|body| {
        let mut parts = body.split(',');
        let integer = parts.next().unwrap_or_default();
        let decimal = parts.next();
        !integer.is_empty()
            && integer.bytes().all(|b| b.is_ascii_digit())
            && decimal.is_none_or(|v| !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()))
            && parts.next().is_none()
    });
    !numeric_minus
}
fn date_text(value: &str) -> Result<(String, usize), CsvError> {
    let date = parse_date(value).map_err(|_| CsvError::InvalidData)?;
    Ok((
        format!("{:02}.{:02}.{:04}", date.day(), date.month(), date.year()),
        date.weekday().to_monday_zero_offset() as usize,
    ))
}
fn number(value: f64) -> Result<String, CsvError> {
    ecma_number::string(value).ok_or(CsvError::InvalidData)
}
fn hours(value: Option<f64>) -> Result<String, CsvError> {
    value.map_or_else(
        || Ok(String::new()),
        |value| {
            ecma_number::fixed(value / 60.0, 2)
                .map(|s| s.replacen('.', ",", 1))
                .ok_or(CsvError::InvalidData)
        },
    )
}
fn minutes(value: Option<i64>) -> Result<String, CsvError> {
    let Some(value) = value else {
        return Ok("Nicht verfügbar".into());
    };
    if value.unsigned_abs() > 9_007_199_254_740_991 {
        return Err(CsvError::InvalidData);
    }
    let value = (value as f64).abs();
    Ok(format!(
        "{}:{:0>2}",
        number((value / 60.0).trunc())?,
        number(value % 60.0)?
    ))
}
fn row(writer: &mut Writer, cells: [Cow<'_, str>; 10]) -> Result<(), CsvError> {
    writer.row(&cells)
}
fn own(value: String) -> Cow<'static, str> {
    Cow::Owned(value)
}

/// Presentation-only data, borrowed from native producers. max_bytes is an
/// explicit caller/output budget, not a source-data repair or financial gate.
pub fn report_to_csv(
    entries: &[ReportEntry],
    targets: &[MonthlyTarget],
    max_bytes: usize,
) -> Result<String, CsvError> {
    let mut writer = Writer {
        text: String::new(),
        limit: max_bytes,
    };
    writer.push("\u{feff}")?;
    row(
        &mut writer,
        [
            "Datum".into(),
            "Wochentag".into(),
            "Art".into(),
            "Dienst / Termin".into(),
            "Beginn".into(),
            "Ende".into(),
            "Ende am Folgetag".into(),
            "Pause (Min)".into(),
            "Dienst- / Terminzeit (h)".into(),
            "Zeitgutschrift (h)".into(),
        ],
    )?;
    let weekdays = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
    for entry in entries {
        if !matches!(entry.kind.as_str(), "SHIFT" | "APPOINTMENT") {
            return Err(CsvError::InvalidData);
        }
        let (date, weekday) = date_text(&entry.date)?;
        let credit = if entry.kind == "APPOINTMENT" {
            String::new()
        } else {
            match entry.credit_minutes {
                None => "Nicht verfügbar".into(),
                Some(0.0) => String::new(),
                Some(value) => hours(Some(value))?,
            }
        };
        row(
            &mut writer,
            [
                own(date),
                weekdays[weekday].into(),
                entry.type_label.as_str().into(),
                entry.title.as_str().into(),
                entry.start_time.as_deref().unwrap_or("").into(),
                entry.end_time.as_deref().unwrap_or("").into(),
                (if entry.all_day {
                    ""
                } else if entry.next_day {
                    "Ja"
                } else {
                    "Nein"
                })
                .into(),
                own(entry
                    .break_minutes
                    .map_or_else(|| Ok(String::new()), number)?),
                own(hours(entry.duration_minutes)?),
                own(credit),
            ],
        )?;
    }
    for target in targets {
        row(&mut writer, std::array::from_fn(|_| "".into()))?;
        let status = match target.status {
            TargetStatus::Final => "Bestätigt",
            TargetStatus::Provisional => "Vorläufig",
            TargetStatus::Unavailable => "Nicht verfügbar",
        };
        row(
            &mut writer,
            [
                "Sollzeitberechnung".into(),
                target.month.as_str().into(),
                "Status".into(),
                status.into(),
                "".into(),
                "".into(),
                "".into(),
                "".into(),
                "".into(),
                "".into(),
            ],
        )?;
        row(
            &mut writer,
            [
                "Monatsbasis".into(),
                target.month.as_str().into(),
                "".into(),
                "".into(),
                "".into(),
                "".into(),
                "".into(),
                "".into(),
                own(minutes(Some(target.base_minutes))?),
                "".into(),
            ],
        )?;
        for adjustment in &target.adjustments {
            let (date, _) = date_text(&adjustment.date)?;
            let kind = if adjustment.kind == AdjustmentKind::TariffSpecialDay {
                "Tariflicher Sondertag"
            } else {
                "Gesetzlicher Feiertag"
            };
            let status = match adjustment.status {
                AdjustmentStatus::Confirmed => "Bestätigt",
                AdjustmentStatus::PlanEstimate => "Laut Dienstplan (vorläufig)",
                AdjustmentStatus::ProfileEstimate => "Planwert aus Arbeitsprofil",
                _ => "Offen",
            };
            let amount = if adjustment.status == AdjustmentStatus::Pending {
                "Offen".into()
            } else {
                format!("-{}", minutes(Some(adjustment.minutes))?)
            };
            row(
                &mut writer,
                [
                    own(date),
                    "".into(),
                    kind.into(),
                    adjustment.label.as_str().into(),
                    adjustment.source.legal_basis.as_str().into(),
                    adjustment.condition.as_str().into(),
                    status.into(),
                    "".into(),
                    own(amount),
                    "".into(),
                ],
            )?;
        }
        row(
            &mut writer,
            [
                "Gesamt Sollzeit".into(),
                target.month.as_str().into(),
                "".into(),
                "".into(),
                "".into(),
                "".into(),
                "".into(),
                "".into(),
                own(minutes(target.target_minutes)?),
                "".into(),
            ],
        )?;
    }
    Ok(writer.text)
}
