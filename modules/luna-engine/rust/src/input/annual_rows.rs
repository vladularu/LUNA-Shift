//! Native original SQL annual-payment facts; no caller amounts are calculated
//! or accepted as engine results at this boundary.
use super::{InputError, raw_json, require_instant};
use crate::remuneration::{
    annual::actual::validate_actual_own_annual_payments,
    tariff_annual::saved::{self, SavedAnnualError, ValidatedSavedClaims},
};
use serde_json::{Value, json};
use std::sync::Arc;
const OWN_FIELDS: &[&str] = &[
    "payment_id",
    "entitlement_year",
    "payment_json",
    "revoked",
    "updated_at",
];
const TARIFF_FIELDS: &[&str] = &[
    "claim_id",
    "entitlement_year",
    "claim_json",
    "actual_payment_json",
    "revoked",
    "revision",
    "updated_at",
];
fn error(message: impl Into<String>) -> InputError {
    InputError::user_facing_source(message, "UserFacingError")
}
fn exact(value: &Value, fields: &[&str]) -> bool {
    raw_json::exact_sql_columns(
        value,
        fields,
        &["payment_json", "claim_json", "actual_payment_json"],
    )
}
fn flag(value: &Value) -> bool {
    value.as_f64().is_some_and(|v| v == 0.0 || v == 1.0)
}
fn saved_error(value: SavedAnnualError) -> InputError {
    let class = if value.class_name() == "ValidationError" {
        "ValidationError"
    } else {
        "UserFacingError"
    };
    InputError::user_facing_source(value.to_string(), class)
}
/// Original saved collection validation after physical rows were mapped.
/// Preserve caller order; SQL ordering belongs to the repository list wrapper.
pub fn validate_actual_annual_payment_collection(records: &[Value]) -> Result<(), InputError> {
    if records.len() > 4096 {
        return Err(error("Ungültige Sonderzahlungsbestätigungen."));
    }
    let checked = records
        .iter()
        .map(validate_saved_actual_annual_payment)
        .collect::<Result<Vec<_>, _>>()?;
    let payments = Value::Array(checked.iter().map(|v| v["payment"].clone()).collect());
    validate_actual_own_annual_payments(&payments)
        .map(|_| ())
        .map_err(|e| error(e.to_string()))
}
pub fn validate_tariff_annual_claim_collection(records: &[Value]) -> Result<(), InputError> {
    saved::validate_saved_tariff_annual_claims(&Value::Array(records.to_vec()))
        .map(|_| ())
        .map_err(saved_error)
}
pub fn validate_saved_actual_annual_payment(value: &Value) -> Result<Value, InputError> {
    if !exact(value, &["payment", "revoked", "updatedAt"]) {
        return Err(error(
            "Die gespeicherte Sonderzahlungsbestätigung ist ungültig.",
        ));
    }
    let revoked = value["revoked"]
        .as_bool()
        .ok_or_else(|| error("Ungültiger Bestätigungsstatus."))?;
    let raw = json!([value["payment"]]);
    let checked = validate_actual_own_annual_payments(&raw).map_err(|e| error(e.to_string()))?;
    let updated = require_instant(&value["updatedAt"], "Sonderzahlungsbestätigung")?;
    Ok(json!({"payment":checked[0],"revoked":revoked,"updatedAt":updated}))
}
pub fn map_actual_annual_payment_row(row: &Value) -> Result<Value, InputError> {
    if !exact(row, OWN_FIELDS)
        || !raw_json::sql_json_is_text(row, "payment_json")
        || !flag(&row["revoked"])
    {
        return Err(error("Ungültiger Sonderzahlungsdatensatz."));
    }
    let payment = raw_json::parse_sql_json(row, "payment_json").map_err(|_| {
        if raw_json::sql_json_number_overflow(row, "payment_json") {
            return error(
                "Die bestätigten Jahressonderzahlungen sind ungültig oder mehrfach vorhanden.",
            );
        }
        InputError::source(
            "Die gespeicherte Sonderzahlung enthält ungültiges JSON.",
            "SyntaxError",
        )
    })?;
    let saved = validate_saved_actual_annual_payment(
        &json!({"payment":payment,"revoked":row["revoked"].as_f64()==Some(1.0),"updatedAt":row["updated_at"]}),
    )?;
    if saved["payment"]["paymentId"].as_str() != row["payment_id"].as_str()
        || saved["payment"]["entitlementYear"].as_f64() != row["entitlement_year"].as_f64()
    {
        return Err(error("Die Sonderzahlungszuordnung ist ungültig."));
    }
    Ok(saved)
}
pub fn map_tariff_annual_claim_row(row: &Value) -> Result<Value, InputError> {
    if !exact(row, TARIFF_FIELDS)
        || !raw_json::sql_json_is_text(row, "claim_json")
        || (row.get("actual_payment_json") != Some(&Value::Null)
            && !raw_json::sql_json_is_text(row, "actual_payment_json"))
        || !flag(&row["revoked"])
    {
        return Err(error("Ungültiger Tarif-Jahresdatensatz."));
    }
    let damaged = || error("Der Tarif-Jahresdatensatz ist beschädigt.");
    let claim = raw_json::parse_sql_json(row, "claim_json").map_err(|_| damaged())?;
    let actual = match row.get("actual_payment_json") {
        Some(Value::Null) => Value::Null,
        _ => raw_json::parse_sql_json(row, "actual_payment_json").map_err(|_| damaged())?,
    };
    let checked=saved::validate_saved_tariff_annual_claim(&json!({"claim":claim,"actualPayment":actual,"revoked":row["revoked"].as_f64()==Some(1.0),"revision":row["revision"],"updatedAt":row["updated_at"]})).map_err(saved_error)?;
    if Some(checked.claim.data().id.as_str()) != row["claim_id"].as_str()
        || Some(f64::from(checked.claim.data().year)) != row["entitlement_year"].as_f64()
    {
        return Err(error("Die Tarif-Jahreszuordnung ist ungültig."));
    }
    serde_json::to_value(checked).map_err(|_| damaged())
}
pub struct RawActualAnnualPayments {
    raw: Arc<Vec<Value>>,
    saved: Arc<Vec<Value>>,
    active: Arc<Vec<Value>>,
}
impl RawActualAnnualPayments {
    pub fn try_from_rows(raw: Arc<Vec<Value>>) -> Result<Self, InputError> {
        if raw.len() > 4096 {
            return Err(error("Ungültige Sonderzahlungsbestätigungen."));
        }
        let mut records = raw
            .iter()
            .map(map_actual_annual_payment_row)
            .collect::<Result<Vec<_>, _>>()?;
        let payments = Value::Array(records.iter().map(|row| row["payment"].clone()).collect());
        validate_actual_own_annual_payments(&payments).map_err(|e| error(e.to_string()))?;
        records.sort_by(|a, b| {
            a["payment"]["entitlementYear"]
                .as_i64()
                .cmp(&b["payment"]["entitlementYear"].as_i64())
                .then_with(|| {
                    a["payment"]["paymentId"]
                        .as_str()
                        .cmp(&b["payment"]["paymentId"].as_str())
                })
        });
        let active = Arc::new(
            records
                .iter()
                .filter(|row| row["revoked"] == false)
                .map(|row| row["payment"].clone())
                .collect(),
        );
        Ok(Self {
            raw,
            saved: Arc::new(records),
            active,
        })
    }
    pub fn raw_rows(&self) -> &Arc<Vec<Value>> {
        &self.raw
    }
    pub fn saved(&self) -> &Arc<Vec<Value>> {
        &self.saved
    }
    pub fn active_payments(&self) -> &Arc<Vec<Value>> {
        &self.active
    }
}
pub struct RawTariffAnnualClaims {
    raw: Arc<Vec<Value>>,
    saved: Arc<Vec<Value>>,
    validated: ValidatedSavedClaims,
}
impl RawTariffAnnualClaims {
    pub fn try_from_rows(raw: Arc<Vec<Value>>) -> Result<Self, InputError> {
        if raw.len() > 4096 {
            return Err(error("Ungültige Tarif-Jahresansprüche."));
        }
        let mut records = raw
            .iter()
            .map(map_tariff_annual_claim_row)
            .collect::<Result<Vec<_>, _>>()?;
        records.sort_by(|a, b| {
            a["claim"]["year"]
                .as_i64()
                .cmp(&b["claim"]["year"].as_i64())
                .then_with(|| a["claim"]["id"].as_str().cmp(&b["claim"]["id"].as_str()))
        });
        let validated = saved::validate_saved_tariff_annual_claims(&Value::Array(records.clone()))
            .map_err(saved_error)?;
        Ok(Self {
            raw,
            saved: Arc::new(records),
            validated,
        })
    }
    pub fn raw_rows(&self) -> &Arc<Vec<Value>> {
        &self.raw
    }
    pub fn saved(&self) -> &Arc<Vec<Value>> {
        &self.saved
    }
    pub fn validated(&self) -> &ValidatedSavedClaims {
        &self.validated
    }
}
