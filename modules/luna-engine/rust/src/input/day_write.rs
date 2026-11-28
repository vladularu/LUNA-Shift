//! Native calendar storage values and unjoined receipts. SQL execution stays mechanical.
//! A pure plan is not a commit capability; the shared resource binds its stamp/permit.
use super::{InputError, calendar, calendar_rows, javascript_date, javascript_json};
use crate::net::js_truthy;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
const MAX_ROWS: usize = 50_000;
const MAX_BYTES: u64 = 16_515_072;
fn invalid() -> InputError {
    InputError::source(
        "Die gespeicherten Einträge konnten nicht gelesen werden.",
        "Error",
    )
}
fn conflict() -> InputError {
    InputError::user_facing_source(
        "Der Eintrag wurde zwischenzeitlich geändert. Bitte neu laden.",
        "ConcurrencyError",
    )
}
fn bulk_error() -> InputError {
    InputError::source("Prüfe die ausgewählten Dienste erneut.", "Error")
}
fn serialized(value: &Value) -> Result<Value, InputError> {
    if value.is_null() {
        Ok(Value::Null)
    } else {
        javascript_json::stringify(value)
            .map(Value::String)
            .map_err(|_| invalid())
    }
}
struct Rows {
    rows: Arc<[Value]>,
    index: BTreeMap<String, usize>,
}
impl Rows {
    fn new(rows: Arc<[Value]>, fields: &[&str], remaining: &mut u64) -> Result<Self, InputError> {
        if rows.len() > MAX_ROWS {
            return Err(invalid());
        }
        let mut index = BTreeMap::new();
        for (i, row) in rows.iter().enumerate() {
            let size =
                crate::report::cache_budget::serialized_bytes(row, remaining.saturating_sub(1))
                    .ok_or_else(invalid)?;
            *remaining = remaining.checked_sub(size + 1).ok_or_else(invalid)?;
            let object = row.as_object().ok_or_else(invalid)?;
            let id = row["id"].as_str().ok_or_else(invalid)?;
            if object.len()
                != fields.len()
                    + 1
                    + usize::from(
                        fields == calendar_rows::SHIFT_ROW_FIELDS
                            && object.contains_key("absence_pay_json"),
                    )
                || fields.iter().any(|key| !object.contains_key(*key))
                || !object.contains_key("test_run_id")
                || id.len() > 256
                || index.insert(id.to_owned(), i).is_some()
            {
                return Err(invalid());
            }
        }
        Ok(Self { rows, index })
    }
    fn get(&self, id: &str) -> Option<&Value> {
        self.index.get(id).map(|i| &self.rows[*i])
    }
}
pub struct NativeDayWriteSource {
    shifts: Rows,
    appointments: Rows,
}
pub struct NativeDayWritePlan {
    body: Value,
    returned: Value,
}
impl NativeDayWritePlan {
    pub fn value(&self) -> &Value {
        &self.body
    }
    pub fn returned(&self) -> &Value {
        &self.returned
    }
    pub(crate) fn into_returned(self) -> Value {
        self.returned
    }
    pub(crate) fn into_parts(mut self) -> (Value, Value) {
        let body = std::mem::take(&mut self.body);
        (body, self.into_returned())
    }
}
impl NativeDayWriteSource {
    /// Actual private raw SQLite rows only. JSON mapping is deferred until a selected receipt.
    pub fn from_raw_rows(
        shifts: Arc<[Value]>,
        appointments: Arc<[Value]>,
    ) -> Result<Self, InputError> {
        let mut remaining = MAX_BYTES - 4;
        Ok(Self {
            shifts: Rows::new(shifts, calendar_rows::SHIFT_ROW_FIELDS, &mut remaining)?,
            appointments: Rows::new(
                appointments,
                calendar_rows::APPOINTMENT_ROW_FIELDS,
                &mut remaining,
            )?,
        })
    }
    pub fn prepare(
        &self,
        operation: &str,
        input: &Value,
        epoch: f64,
        allocated_id: &str,
    ) -> Result<NativeDayWritePlan, InputError> {
        crate::report::cache_budget::serialized_bytes(input, MAX_BYTES).ok_or_else(invalid)?;
        let (mutations, returned) = match operation {
            "SHIFT" | "APPOINTMENT" => {
                let (mutation, returned) = self.save(operation, input, epoch, allocated_id)?;
                (vec![mutation], returned)
            }
            "BULK_SHIFT" => {
                let values = input
                    .as_array()
                    .filter(|v| v.len() <= MAX_ROWS)
                    .ok_or_else(bulk_error)?;
                let mut ids = BTreeSet::new();
                for value in values {
                    let id = value["id"]
                        .as_str()
                        .filter(|id| !id.is_empty())
                        .ok_or_else(bulk_error)?;
                    if !value["expectedRevision"].as_f64().is_some_and(|n| {
                        n.is_finite()
                            && n.fract() == 0.0
                            && (1.0..=9_007_199_254_740_991.0).contains(&n)
                    }) || !ids.insert(id)
                    {
                        return Err(bulk_error());
                    }
                }
                let mut mutations = Vec::with_capacity(values.len());
                let mut returned = Vec::with_capacity(values.len());
                for value in values {
                    let (mutation, receipt) = self.save("SHIFT", value, epoch, allocated_id)?;
                    mutations.push(mutation);
                    returned.push(receipt);
                }
                (mutations, Value::Array(returned))
            }
            "DELETE" => {
                let kind = input["kind"]
                    .as_str()
                    .filter(|k| ["SHIFT", "APPOINTMENT"].contains(k))
                    .ok_or_else(invalid)?;
                let id = input["id"].as_str().ok_or_else(invalid)?;
                let previous = self.current(kind, id, &input["revision"])?;
                let revision = next_revision(previous)?;
                let now = javascript_date::iso_from_epoch_milliseconds(epoch)?;
                (
                    vec![
                        json!({"kind":"TOMBSTONE_CALENDAR_ENTRY","entryKind":kind,"row":{"id":id,"revision":revision,"updated_at":now,"deleted_at":now},"expected":{"revision":previous["revision"]}}),
                    ],
                    Value::Null,
                )
            }
            _ => return Err(invalid()),
        };
        let body = json!({"schemaVersion":1,"guards":[],"mutations":mutations});
        crate::report::cache_budget::serialized_bytes(&body, MAX_BYTES).ok_or_else(invalid)?;
        Ok(NativeDayWritePlan { body, returned })
    }
    fn current(&self, kind: &str, id: &str, revision: &Value) -> Result<&Value, InputError> {
        let row = if kind == "SHIFT" {
            self.shifts.get(id)
        } else {
            self.appointments.get(id)
        }
        .ok_or_else(conflict)?;
        if !row["deleted_at"].is_null() || row["revision"].as_f64() != revision.as_f64() {
            return Err(conflict());
        }
        Ok(row)
    }
    fn save(
        &self,
        kind: &str,
        raw: &Value,
        epoch: f64,
        allocated_id: &str,
    ) -> Result<(Value, Value), InputError> {
        let input = if kind == "SHIFT" {
            calendar::validate_shift(raw)?
        } else {
            calendar::validate_appointment(raw)?
        };
        let id = input
            .get("id")
            .filter(|v| !v.is_null())
            .map(|v| v.as_str().ok_or_else(invalid))
            .transpose()?
            .unwrap_or(allocated_id);
        if id.len() > 256 {
            return Err(invalid());
        }
        let previous = if input.get("id").is_some() {
            Some(self.current(kind, id, &input["expectedRevision"])?)
        } else {
            None
        };
        let now = javascript_date::iso_from_epoch_milliseconds(epoch)?;
        let revision = previous.map(next_revision).transpose()?.unwrap_or(1);
        let created = previous
            .map(|row| row["created_at"].clone())
            .unwrap_or_else(|| json!(now));
        let mut row = json!({"id":id,"date":input["date"],"title":input["title"],"all_day":if js_truthy(&input["allDay"]){1}else{0},"start_time":input["startTime"],"end_time":input["endTime"],"color":input["color"],"note":input["note"],"notification_json":serialized(&input["notification"] )?,"location_json":serialized(&input["location"] )?,"revision":revision,"created_at":created,"updated_at":now,"deleted_at":null,"test_run_id":previous.map(|row|&row["test_run_id"])});
        let (mutation, returned) = if kind == "SHIFT" {
            for (column, key) in [
                ("template_id", "templateId"),
                ("type", "type"),
                ("break_minutes", "breakMinutes"),
                ("symbol", "symbol"),
                ("overtime_minutes", "overtimeMinutes"),
                ("holiday_premium_mode", "holidayPremiumMode"),
            ] {
                row[column] = input[key].clone();
            }
            row["alarm_enabled"] = json!(if js_truthy(&input["alarmEnabled"]) {
                1
            } else {
                0
            });
            row["tariff_overtime_confirmed"] =
                json!(if js_truthy(&input["tariffOvertimeConfirmed"]) {
                    1
                } else {
                    0
                });
            if let Some(facts) = raw.get("absencePay") {
                if !facts.is_null() {
                    crate::net::absence_pay::validate(facts, &input).map_err(|_| invalid())?;
                }
                row["absence_pay_json"] = serialized(facts)?;
            } else if let Some(old) = previous.filter(|old| old.get("absence_pay_json").is_some()) {
                row["absence_pay_json"] =
                    if old["type"] == row["type"] && old["date"] == row["date"] {
                        old["absence_pay_json"].clone()
                    } else {
                        Value::Null
                    };
            }
            row["special_duty_json"] = serialized(&input["specialDuty"])?;
            ("UPSERT_SHIFT_ENTRY", calendar_rows::map_shift(&row)?)
        } else {
            row["recurrence_frequency"] = input["recurrence"]["frequency"].clone();
            row["recurrence_interval"] = input["recurrence"]["interval"].clone();
            ("UPSERT_APPOINTMENT", calendar_rows::map_appointment(&row)?)
        };
        Ok((
            json!({"kind":mutation,"row":row,"expected":previous.map(|row|json!({"revision":row["revision"]}))}),
            returned,
        ))
    }
}
fn next_revision(row: &Value) -> Result<u64, InputError> {
    row["revision"]
        .as_u64()
        .and_then(|r| r.checked_add(1))
        .filter(|r| *r <= 9_007_199_254_740_991)
        .ok_or_else(conflict)
}
