//! Source-compatible report fields over native calculation values.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, sync::OnceLock};
#[derive(Debug, Serialize)]
pub struct DocumentRow {
    pub section: String,
    pub period: String,
    pub record: String,
    pub field: String,
    pub label: String,
    pub value: String,
    pub unit: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentError {
    InvalidData,
    TooLarge,
}
impl std::fmt::Display for DocumentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidData => "Die Berichtsdaten sind ungültig.",
            Self::TooLarge => "Der Export überschreitet die unterstützte Größe.",
        })
    }
}
impl std::error::Error for DocumentError {}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextTables {
    labels: BTreeMap<String, String>,
    values: BTreeMap<String, String>,
    enum_fields: Vec<String>,
    shift_labels: BTreeMap<String, String>,
}
fn tables() -> Result<&'static TextTables, DocumentError> {
    static TABLES: OnceLock<Result<TextTables, DocumentError>> = OnceLock::new();
    TABLES
        .get_or_init(|| {
            serde_json::from_str(include_str!("text.json")).map_err(|_| DocumentError::InvalidData)
        })
        .as_ref()
        .map_err(|e| *e)
}
/// Local append/output budget. No raw snapshot, source proof or persistent state.
pub struct DocumentRows {
    rows: Vec<DocumentRow>,
    reserved_bytes: usize,
    max_rows: usize,
    max_bytes: usize,
    artifact: bool,
}
impl Default for DocumentRows {
    fn default() -> Self {
        Self::with_limits(500_000, 16 * 1024 * 1024)
    }
}
impl DocumentRows {
    pub fn with_limits(max_rows: usize, max_bytes: usize) -> Self {
        Self {
            rows: vec![],
            reserved_bytes: 0,
            max_rows: max_rows.min(500_000),
            max_bytes: max_bytes.min(16 * 1024 * 1024),
            artifact: false,
        }
    }
    pub fn as_slice(&self) -> &[DocumentRow] {
        &self.rows
    }
    pub(super) fn artifact() -> Self {
        Self {
            artifact: true,
            ..Self::default()
        }
    }
    fn accepts_section(&self, section: &str) -> bool {
        !self.artifact
            || matches!(
                section,
                "Bericht"
                    | "Profil"
                    | "Arbeitszeit"
                    | "Jahresauswertung"
                    | "Gehaltsprognose"
                    | "Netto-Prognose"
                    | "Auswertung"
            )
    }
    pub fn into_rows(self) -> Vec<DocumentRow> {
        self.rows
    }
    fn push(&mut self, row: DocumentRow) -> Result<(), DocumentError> {
        if self.artifact && !artifact_field(&row.section, &row.field) {
            return Ok(());
        }
        let bytes = [
            &row.section,
            &row.period,
            &row.record,
            &row.field,
            &row.label,
            &row.value,
            &row.unit,
        ]
        .iter()
        .try_fold(128usize, |n, s| n.checked_add(s.len().checked_mul(6)?))
        .ok_or(DocumentError::TooLarge)?;
        if self.rows.len() >= self.max_rows
            || self
                .reserved_bytes
                .checked_add(bytes)
                .is_none_or(|n| n > self.max_bytes)
        {
            return Err(DocumentError::TooLarge);
        }
        self.reserved_bytes += bytes;
        self.rows.push(row);
        Ok(())
    }
}
pub fn append_report_data(
    rows: &mut DocumentRows,
    section: &str,
    period: &str,
    record: &str,
    data: &Value,
) -> Result<(), DocumentError> {
    if !rows.accepts_section(section) {
        return Ok(());
    }
    append(
        rows,
        &RowContext {
            section,
            period,
            record,
            t: tables()?,
        },
        data,
        "",
        0,
    )
}
// Exact field readers of export_view::selection. Filtering happens before
// output reservation; private raw notes and unused evidence never reach JS.
fn artifact_field(section: &str, field: &str) -> bool {
    match section {
        "Bericht" => field == "referenceDate" || field.starts_with("testMonths."),
        "Profil" => matches!(field, "displayName" | "employerName"),
        "Arbeitszeit" => matches!(
            field,
            "targetMinutes"
                | "actualMinutes"
                | "balanceMinutes"
                | "timeAccountMinutes"
                | "work.minutes"
                | "work.entryCount"
                | "training.minutes"
                | "training.entryCount"
                | "vacation.minutes"
                | "vacation.entryCount"
                | "sick.minutes"
                | "sick.entryCount"
        ),
        "Jahresauswertung" => matches!(
            field,
            "targetMinutes"
                | "actualMinutes"
                | "balanceMinutes"
                | "timeAccountMinutes"
                | "worktimeCoverageComplete"
                | "estimatedGrossAmount"
                | "knownGrossAmount"
                | "premiumAmount"
                | "overtimeAmount"
                | "availablePayMonthCount"
                | "netCents"
                | "availableNetMonthCount"
                | "criticalCount"
                | "warningCount"
                | "infoCount"
                | "prerequisiteCount"
                | "scopeCount"
        ),
        "Gehaltsprognose" => {
            matches!(
                field,
                "estimatedGrossAmount"
                    | "knownGrossAmount"
                    | "personalBaseAmount"
                    | "allowanceAmount"
                    | "tvoedAllowanceAmount"
                    | "careAllowanceAmount"
                    | "timePremiumAmount"
                    | "overtimeAmount"
                    | "specialDutyAmount"
                    | "annualPaymentAmount"
            ) || field.starts_with("specialDutyNotes")
        }
        "Netto-Prognose" => matches!(
            field,
            "netCents"
                | "result.pay.netCents"
                | "result.pay.calculationBasis.status"
                | "result.pay.calculationBasis.payrollYear"
                | "result.pay.calculationBasis.rulesYear"
                | "result.pay.tax.wageTaxCents"
                | "result.pay.tax.solidarityCents"
                | "result.pay.tax.churchTaxCents"
                | "result.pay.socialInsurance.totalCents"
                | "result.pay.pension.employeeCents"
                | "result.pay.pensionOmitted"
                | "pensionOmitted"
                | "annualPayment.note"
                | "annualPayment.netIncluded"
                | "annualPayment.pensionOmitted"
        ),
        "Auswertung" => {
            matches!(
                field,
                "criticalCount" | "warningCount" | "infoCount" | "prerequisiteCount" | "scopeCount"
            ) || (field.starts_with("issues.")
                && [".title", ".kind", ".date"]
                    .iter()
                    .any(|end| field.ends_with(end)))
        }
        _ => false,
    }
}
struct RowContext<'a> {
    section: &'a str,
    period: &'a str,
    record: &'a str,
    t: &'a TextTables,
}
fn append(
    rows: &mut DocumentRows,
    scope: &RowContext<'_>,
    data: &Value,
    path: &str,
    depth: usize,
) -> Result<(), DocumentError> {
    let RowContext {
        section,
        period,
        record,
        t,
    } = *scope;
    if depth > 64 {
        return Err(DocumentError::TooLarge);
    }
    match data {
        Value::Object(object) if !object.is_empty() => {
            let mut keys = object.keys().collect::<Vec<_>>();
            // Object.entries puts canonical uint32 indices before other keys.
            // Equal non-index keys retain their insertion order.
            keys.sort_by_key(|key| index_key(key).map_or((1, 0), |n| (0, n)));
            for key in keys {
                let path = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{path}.{key}")
                };
                append(rows, scope, &object[key], &path, depth + 1)?;
            }
            return Ok(());
        }
        Value::Array(array) if !array.is_empty() => {
            for (index, value) in array.iter().enumerate() {
                let path = if path.is_empty() {
                    index.to_string()
                } else {
                    format!("{path}.{index}")
                };
                append(rows, scope, value, &path, depth + 1)?;
            }
            return Ok(());
        }
        _ => {}
    }
    let part = path.rsplit('.').next().unwrap_or("");
    let mut unit = "";
    let value = match data {
        Value::Null => {
            if [
                "Gehaltsprognose",
                "Netto-Prognose",
                "Jahresauswertung",
                "Arbeitszeit",
            ]
            .contains(&section)
            {
                "Nicht verfügbar".into()
            } else {
                "Nicht hinterlegt".into()
            }
        }
        Value::Bool(v) => {
            if *v {
                "Ja".into()
            } else {
                "Nein".into()
            }
        }
        Value::Number(n) => {
            let cents = part.ends_with("Cents");
            unit = if cents
                || part.ends_with("Amount")
                || (part == "amount" && !path.starts_with("notification."))
                || part == "hourlyRate"
            {
                "EUR"
            } else if part.to_lowercase().ends_with("minutes") {
                "Minuten"
            } else if part == "percentage" {
                "%"
            } else {
                ""
            };
            let number = n.as_f64().ok_or(DocumentError::InvalidData)?;
            crate::report::ecma_number::string(if cents { number / 100.0 } else { number })
                .ok_or(DocumentError::InvalidData)?
                .replacen('.', ",", 1)
        }
        Value::String(value) => {
            if part == "type" {
                t.shift_labels.get(value).unwrap_or(value).clone()
            } else if t.enum_fields.iter().any(|f| f == part) {
                t.values.get(value).unwrap_or(value).clone()
            } else {
                value.clone()
            }
        }
        Value::Array(_) | Value::Object(_) => "Keine".into(),
    };
    let label = path
        .split('.')
        .map(|key| label_part(key, path, t))
        .collect::<Result<Vec<_>, _>>()?
        .join(" · ");
    rows.push(DocumentRow {
        section: section.into(),
        period: period.into(),
        record: record.into(),
        field: path.into(),
        label,
        value,
        unit: unit.into(),
    })
}
fn index_key(key: &str) -> Option<u32> {
    let number = key.parse::<u32>().ok()?;
    (number < u32::MAX && number.to_string() == key).then_some(number)
}
fn digits(key: &str) -> bool {
    !key.is_empty() && key.bytes().all(|b| b.is_ascii_digit())
}
fn label_part(key: &str, path: &str, t: &TextTables) -> Result<String, DocumentError> {
    if digits(key) {
        let n = key.parse::<f64>().map_err(|_| DocumentError::InvalidData)? + 1.0;
        return if n.is_infinite() {
            Ok("Infinity".into())
        } else {
            crate::report::ecma_number::string(n).ok_or(DocumentError::InvalidData)
        };
    }
    let parts = path.split('.').collect::<Vec<_>>();
    let issue = parts
        .first()
        .is_some_and(|p| ["issues", "prerequisites", "scopeNotes"].contains(p));
    if key == "tariff" && issue && parts.len() > 1 {
        return Ok("Tarifprüfung".into());
    }
    if key == "assessment"
        && issue
        && parts.len() > 4
        && digits(parts[1])
        && parts[2] == "facts"
        && parts[3] == "assessment"
    {
        return Ok("Wochenendprüfung".into());
    }
    if key == "totalCount"
        && (path.starts_with("weekendAssessment.") || path.contains(".facts.assessment."))
    {
        return Ok("Wochenenden gesamt".into());
    }
    Ok(t.labels
        .get(key)
        .or_else(|| t.shift_labels.get(key))
        .map_or(key, String::as_str)
        .into())
}
