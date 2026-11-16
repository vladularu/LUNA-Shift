//! Original persisted tariff confirmations with their own native validators.
use super::{InputError, raw_json};
use crate::remuneration::{
    draft_facts::{self, model::ConfirmationKind},
    service_facts,
};
use serde_json::Value;
use std::sync::Arc;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DraftRowsKind {
    AnnexAMonth,
    AnnexAPremium,
    SueMonth,
    SueAllowance,
    TvlShiftWork,
    DrkEmployee,
    DrkTraining,
    CaritasMonth,
    CaritasWorkDay,
    CaritasOvertime,
}
impl DraftRowsKind {
    fn json_column(self) -> &'static str {
        if matches!(self, Self::AnnexAPremium | Self::CaritasMonth) {
            "facts_json"
        } else {
            "confirmation_json"
        }
    }
    fn columns(self) -> &'static [&'static str] {
        match self {
            Self::TvlShiftWork => &["shift_id", "profile_effective_from", "confirmation_json"],
            Self::CaritasWorkDay => &["shift_id", "date", "confirmation_json"],
            Self::CaritasOvertime => &["shift_id", "confirmation_json"],
            Self::AnnexAPremium | Self::CaritasMonth => &["month", "facts_json"],
            _ => &["month", "confirmation_json"],
        }
    }
    fn invalid(self) -> &'static str {
        match self {
            Self::AnnexAMonth => "Ungültige TVöD-Monatsbestätigung.",
            Self::AnnexAPremium => "Ungültige TVöD-Zuschlagsdaten.",
            Self::SueMonth => "Ungültige SuE-Monatsbestätigung.",
            Self::SueAllowance => "Ungültige SuE-Zulagenbestätigung.",
            Self::TvlShiftWork => "Ungültige TV-L-Bestätigung.",
            Self::DrkEmployee => "Ungültige DRK-Monatsbestätigung.",
            Self::DrkTraining => "Ungültige DRK-Ausbildungsbestätigung.",
            Self::CaritasMonth => "Ungültige Caritas-Monatsbestätigung.",
            Self::CaritasWorkDay => "Ungültige Caritas-Dienstbestätigung.",
            Self::CaritasOvertime => "Ungültige Caritas-Überstundenbestätigung.",
        }
    }
    fn binding_error(self) -> &'static str {
        match self {
            Self::AnnexAMonth => "Widersprüchlicher TVöD-Abrechnungsmonat.",
            Self::AnnexAPremium => "Widersprüchlicher TVöD-Zuschlagsmonat.",
            Self::SueMonth | Self::SueAllowance => "Widersprüchlicher SuE-Abrechnungsmonat.",
            Self::TvlShiftWork => "Widersprüchliche Dienst-/Profilzuordnung.",
            Self::DrkEmployee => "Widersprüchlicher DRK-Abrechnungsmonat.",
            Self::DrkTraining => "Widersprüchlicher DRK-Ausbildungsmonat.",
            Self::CaritasMonth => "Widersprüchlicher Caritas-Abrechnungsmonat.",
            Self::CaritasWorkDay | Self::CaritasOvertime => {
                "Widersprüchliche Caritas-Dienstzuordnung."
            }
        }
    }
}
fn error(message: &str) -> InputError {
    InputError::source(message, "Error")
}
fn class(name: &str) -> &'static str {
    match name {
        "ValidationError" => "ValidationError",
        "RemunerationProfileError" => "RemunerationProfileError",
        "RangeError" => "RangeError",
        "UserFacingError" => "UserFacingError",
        _ => "Error",
    }
}
fn classified(message: impl Into<String>, name: &str) -> InputError {
    let name = class(name);
    if matches!(
        name,
        "ValidationError" | "RemunerationProfileError" | "UserFacingError"
    ) {
        InputError::user_facing_source(message, name)
    } else {
        InputError::source(message, name)
    }
}
pub fn map_draft_evidence_row(kind: DraftRowsKind, row: &Value) -> Result<Value, InputError> {
    let column = kind.json_column();
    if !raw_json::exact_sql_columns(row, kind.columns(), &[column])
        || !raw_json::sql_json_is_text(row, column)
    {
        return Err(error(kind.invalid()));
    }
    let raw = raw_json::parse_sql_json(row, column).map_err(|_| {
        InputError::source(
            "Die gespeicherten Tarifbestätigungen enthalten ungültiges JSON.",
            "SyntaxError",
        )
    })?;
    let invalid = || error(kind.invalid());
    let checked = match kind {
        DraftRowsKind::DrkEmployee => crate::remuneration::drk::saved::validate_employee(&raw)?,
        DraftRowsKind::DrkTraining => crate::remuneration::drk::saved::validate_training(&raw)?,
        DraftRowsKind::CaritasMonth => crate::remuneration::caritas::saved::validate_month(&raw)?,
        DraftRowsKind::CaritasWorkDay => {
            crate::remuneration::caritas::saved::validate_work_day(&raw)?
        }
        DraftRowsKind::CaritasOvertime => {
            crate::remuneration::caritas::saved::validate_overtime(&raw)?
        }
        DraftRowsKind::TvlShiftWork => {
            let value = service_facts::validate_tvl_shift_work(&raw)
                .map_err(|e| classified(e.to_string(), e.class_name()))?;
            serde_json::to_value(value).map_err(|_| invalid())?
        }
        DraftRowsKind::AnnexAPremium => {
            let value = draft_facts::premium::validate_saved_annex_a_premium_facts(&raw)
                .map_err(|e| classified(e.to_string(), e.class_name()))?;
            serde_json::to_value(value).map_err(|_| invalid())?
        }
        _ => {
            let k = match kind {
                DraftRowsKind::AnnexAMonth => ConfirmationKind::AnnexA,
                DraftRowsKind::SueMonth => ConfirmationKind::SueMonth,
                _ => ConfirmationKind::SueAllowance,
            };
            let value = draft_facts::month::validate_saved_draft_confirmation(&raw, k)
                .map_err(|e| classified(e.to_string(), e.class_name()))?;
            serde_json::to_value(value).map_err(|_| invalid())?
        }
    };
    let matches = match kind {
        DraftRowsKind::TvlShiftWork => {
            row["shift_id"] == checked["shiftId"]
                && row["profile_effective_from"] == checked["profileEffectiveFrom"]
        }
        DraftRowsKind::CaritasWorkDay => {
            row["shift_id"] == checked["shiftId"] && row["date"] == checked["date"]
        }
        DraftRowsKind::CaritasOvertime => row["shift_id"] == checked["shiftId"],
        _ => row["month"] == checked["month"],
    };
    if !matches {
        return Err(error(kind.binding_error()));
    }
    Ok(checked)
}
pub struct RawDraftRows {
    raw: Arc<Vec<Value>>,
    saved: Arc<Vec<Value>>,
    kind: DraftRowsKind,
}
impl RawDraftRows {
    pub fn try_from_rows(kind: DraftRowsKind, raw: Arc<Vec<Value>>) -> Result<Self, InputError> {
        if raw.len() > crate::contract::MAX_SOURCE_ITEMS as usize {
            return Err(error("Zu viele Tarifbestätigungen."));
        }
        let all_columns = kind.columns();
        let columns = &all_columns[..all_columns.len() - 1];
        let mut order = (0..raw.len()).collect::<Vec<_>>();
        order.sort_by(|a, b| {
            for column in columns {
                let ordering = raw[*a][*column].as_str().cmp(&raw[*b][*column].as_str());
                if !ordering.is_eq() {
                    return ordering;
                }
            }
            std::cmp::Ordering::Equal
        });
        let saved = order
            .into_iter()
            .map(|i| map_draft_evidence_row(kind, &raw[i]))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            raw,
            saved: Arc::new(saved),
            kind,
        })
    }
    pub fn raw_rows(&self) -> &Arc<Vec<Value>> {
        &self.raw
    }
    pub fn saved(&self) -> &Arc<Vec<Value>> {
        &self.saved
    }
    pub fn kind(&self) -> DraftRowsKind {
        self.kind
    }
}
