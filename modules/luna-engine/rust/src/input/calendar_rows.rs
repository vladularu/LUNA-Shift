//! Original SQL calendar rows become native checked entries. No client-created
//! occurrences or trusted derived status is accepted by these opaque types.
use super::{InputError, calendar, raw_json, require_instant, trim_javascript};
use crate::calendar::recurrence::{self, CollationRanks};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, OnceLock},
};
pub const SHIFT_ROW_FIELDS: &[&str] = &[
    "special_duty_json",
    "id",
    "date",
    "template_id",
    "title",
    "type",
    "all_day",
    "start_time",
    "end_time",
    "break_minutes",
    "color",
    "symbol",
    "note",
    "notification_json",
    "alarm_enabled",
    "location_json",
    "overtime_minutes",
    "tariff_overtime_confirmed",
    "holiday_premium_mode",
    "revision",
    "created_at",
    "updated_at",
    "deleted_at",
];
pub const APPOINTMENT_ROW_FIELDS: &[&str] = &[
    "id",
    "date",
    "title",
    "all_day",
    "start_time",
    "end_time",
    "color",
    "note",
    "recurrence_frequency",
    "recurrence_interval",
    "notification_json",
    "location_json",
    "revision",
    "created_at",
    "updated_at",
    "deleted_at",
];
pub const TEMPLATE_ROW_FIELDS: &[&str] = &[
    "special_duty_json",
    "id",
    "name",
    "type",
    "all_day",
    "start_time",
    "end_time",
    "break_minutes",
    "color",
    "symbol",
    "notification_json",
    "location_json",
    "sort_order",
    "revision",
    "created_at",
    "updated_at",
    "deleted_at",
];
pub const DECISION_ROW_FIELDS: &[&str] = &[
    "month",
    "allowance_status",
    "revision",
    "confirmed_at",
    "updated_at",
];
fn invalid(message: &str) -> InputError {
    InputError::validation(message)
}
fn integer(value: &Value) -> bool {
    value.as_f64().is_some_and(|n| n.fract() == 0.0)
}
fn flag(value: &Value) -> bool {
    value.as_f64() == Some(1.0)
}
fn parse(value: &Value, label: &str) -> Result<Value, InputError> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    value
        .as_str()
        .and_then(|s| raw_json::parse(s).ok())
        .ok_or_else(|| InputError::validation(format!("{label} konnte nicht gelesen werden.")))
}
pub fn map_shift(row: &Value) -> Result<Value, InputError> {
    map_shift_display(row, None)
}
fn parse_column(row: &Value, column: &str, label: &str) -> Result<Value, InputError> {
    if row.get(format!("{column}_chunks")).is_some() {
        raw_json::parse_sql_json(row, column)
            .map_err(|_| InputError::validation(format!("{label} konnte nicht gelesen werden.")))
    } else {
        parse(&row[column], label)
    }
}
pub(crate) fn map_shift_display(
    row: &Value,
    template: Option<&Value>,
) -> Result<Value, InputError> {
    if !integer(&row["revision"]) {
        return Err(invalid("Gespeicherte Dienstdaten sind ungültig."));
    }
    let special = parse_column(row, "special_duty_json", "Sonderdienst")?;
    let notification = parse_column(row, "notification_json", "Benachrichtigung")?;
    let location = parse_column(row, "location_json", "Ort")?;
    // The display repository LEFT JOINs templates without excluding their
    // tombstones. Payroll repositories read the original shift row instead.
    let display = |key: &str| {
        template
            .and_then(|v| v.get(key))
            .filter(|v| !v.is_null())
            .unwrap_or(&row[key])
    };
    let title = template
        .and_then(|v| v.get("name"))
        .filter(|v| !v.is_null())
        .unwrap_or(&row["title"]);
    let input = json!({"specialDuty":special,"id":row["id"],"date":row["date"],"templateId":row["template_id"],"title":title,"type":row["type"],"allDay":flag(&row["all_day"])||row["start_time"].is_null(),"startTime":row["start_time"],"endTime":row["end_time"],"breakMinutes":row["break_minutes"],"color":display("color"),"symbol":display("symbol"),"note":row["note"],"notification":notification,"alarmEnabled":flag(&row["alarm_enabled"]),"location":location,"overtimeMinutes":row["overtime_minutes"],"tariffOvertimeConfirmed":flag(&row["tariff_overtime_confirmed"]),"holidayPremiumMode":row["holiday_premium_mode"]});
    let v = calendar::validate_shift(&input)?;
    let mut result = json!({"kind":"SHIFT","specialDuty":v["specialDuty"],"id":row["id"],"date":v["date"],"templateId":v["templateId"],"title":v["title"],"type":v["type"],"allDay":v["allDay"],"startTime":v["startTime"],"endTime":v["endTime"],"breakMinutes":v["breakMinutes"],"color":v["color"],"symbol":v["symbol"],"note":v["note"],"notification":v["notification"],"alarmEnabled":v["alarmEnabled"],"location":v["location"],"overtimeMinutes":v["overtimeMinutes"],"tariffOvertimeConfirmed":v["tariffOvertimeConfirmed"],"holidayPremiumMode":v["holidayPremiumMode"],"revision":row["revision"],"createdAt":row["created_at"],"updatedAt":row["updated_at"],"deletedAt":row["deleted_at"]});
    if !row["absence_pay_json"].is_null() {
        let facts = parse_column(row, "absence_pay_json", "Abwesenheitsaufschlag")?;
        crate::net::absence_pay::validate(&facts, &v)
            .map_err(|_| invalid("Ungültige Angaben zum Abwesenheitsaufschlag."))?;
        result["absencePay"] = facts;
    }
    Ok(result)
}
pub fn map_appointment(row: &Value) -> Result<Value, InputError> {
    if !row["all_day"]
        .as_f64()
        .is_some_and(|n| n == 0.0 || n == 1.0)
        || !integer(&row["revision"])
    {
        return Err(invalid("Gespeicherte Termindaten sind ungültig."));
    }
    let notification = parse(&row["notification_json"], "Benachrichtigung")?;
    let location = parse(&row["location_json"], "Ort")?;
    let recurrence =
        if !row["recurrence_frequency"].is_null() && !row["recurrence_interval"].is_null() {
            json!({"frequency":row["recurrence_frequency"],"interval":row["recurrence_interval"]})
        } else {
            Value::Null
        };
    let v = calendar::validate_appointment(
        &json!({"id":row["id"],"date":row["date"],"title":row["title"],"allDay":flag(&row["all_day"]),"startTime":row["start_time"],"endTime":row["end_time"],"color":row["color"],"note":row["note"],"recurrence":recurrence,"notification":notification,"location":location}),
    )?;
    Ok(
        json!({"kind":"APPOINTMENT","id":row["id"],"date":v["date"],"title":v["title"],"allDay":v["allDay"],"startTime":v["startTime"],"endTime":v["endTime"],"color":v["color"],"note":v["note"],"recurrence":v["recurrence"],"notification":v["notification"],"location":v["location"],"revision":row["revision"],"createdAt":row["created_at"],"updatedAt":row["updated_at"],"deletedAt":row["deleted_at"]}),
    )
}
pub fn map_template(row: &Value) -> Result<Value, InputError> {
    if !integer(&row["sort_order"]) || !integer(&row["revision"]) {
        return Err(invalid("Gespeicherte Vorlagendaten sind ungültig."));
    }
    let special = parse(&row["special_duty_json"], "Sonderdienst")?;
    let notification = parse(&row["notification_json"], "Benachrichtigung")?;
    let location = parse(&row["location_json"], "Ort")?;
    let v = calendar::validate_template(
        &json!({"specialDuty":special,"id":row["id"],"name":row["name"],"type":row["type"],"allDay":flag(&row["all_day"])||row["start_time"].is_null(),"startTime":row["start_time"],"endTime":row["end_time"],"breakMinutes":row["break_minutes"],"color":row["color"],"symbol":row["symbol"],"notification":notification,"location":location,"sortOrder":row["sort_order"]}),
    )?;
    Ok(
        json!({"id":row["id"],"name":v["name"],"specialDuty":v["specialDuty"],"type":v["type"],"allDay":v["allDay"],"startTime":v["startTime"],"endTime":v["endTime"],"breakMinutes":v["breakMinutes"],"color":v["color"],"symbol":v["symbol"],"notification":v["notification"],"location":v["location"],"sortOrder":v["sortOrder"],"revision":row["revision"],"createdAt":row["created_at"],"updatedAt":row["updated_at"],"deletedAt":row["deleted_at"]}),
    )
}
pub fn map_tariff_decision(row: &Value) -> Result<Value, InputError> {
    calendar::validate_monthly_tariff_decision(
        &json!({"month":row["month"],"allowanceStatus":row["allowance_status"],"revision":row["revision"],"confirmedAt":row["confirmed_at"],"updatedAt":row["updated_at"]}),
    )
}
fn exact(row: &Value, keys: &[&str]) -> bool {
    row.as_object().is_some_and(|row| {
        row.len()
            == keys.len()
                + usize::from(keys == SHIFT_ROW_FIELDS && row.contains_key("absence_pay_json"))
            && keys.iter().all(|key| row.contains_key(*key))
    })
}
fn metadata(row: &Value) -> Result<(), InputError> {
    if !row["id"]
        .as_str()
        .is_some_and(|s| !trim_javascript(s).is_empty())
        || !row["revision"]
            .as_f64()
            .is_some_and(|n| n.fract() == 0.0 && (1.0..=9007199254740991.0).contains(&n))
    {
        return Err(invalid(
            "Die gespeicherten Kalender-Metadaten sind ungültig.",
        ));
    }
    require_instant(&row["created_at"], "Erstellung")?;
    require_instant(&row["updated_at"], "Aktualisierung")?;
    if !row["deleted_at"].is_null() {
        require_instant(&row["deleted_at"], "Löschung")?;
    }
    for key in ["all_day", "alarm_enabled", "tariff_overtime_confirmed"] {
        if row
            .get(key)
            .is_some_and(|v| !v.as_f64().is_some_and(|n| n == 0.0 || n == 1.0))
        {
            return Err(invalid(
                "Die gespeicherten Kalender-Wahrheitswerte sind ungültig.",
            ));
        }
    }
    for key in ["break_minutes", "overtime_minutes"] {
        if row.get(key).is_some_and(|v| {
            !v.as_f64()
                .is_some_and(|n| n.fract() == 0.0 && (0.0..=1440.0).contains(&n))
        }) {
            return Err(invalid(
                "Die gespeicherten Kalender-Minutenangaben sind ungültig.",
            ));
        }
    }
    for key in [
        "start_time",
        "end_time",
        "note",
        "notification_json",
        "location_json",
        "special_duty_json",
        "template_id",
    ] {
        if row.get(key).is_some_and(|v| !v.is_null() && !v.is_string()) {
            return Err(invalid(
                "Die gespeicherten Kalender-Textangaben sind ungültig.",
            ));
        }
    }
    Ok(())
}
/// The native normalization stage. Only strings requiring platform collation
/// need cross the thin adapter; no raw/source object must be reparsed there.
pub struct PreparedCalendarRows {
    shifts: Arc<Vec<Value>>,
    appointments: Arc<Vec<Value>>,
    entries: Vec<Value>,
    candidates: BTreeSet<String>,
}
impl PreparedCalendarRows {
    pub fn from_rows(
        shifts: Arc<Vec<Value>>,
        appointments: Arc<Vec<Value>>,
    ) -> Result<Self, InputError> {
        Self::prepare(shifts, appointments, &[], false)
    }
    /// Bind original template lookup rows once. The source shift owner and SQL
    /// ordering stay unchanged for remuneration and saved-evidence bindings.
    pub fn from_rows_with_templates(
        shifts: Arc<Vec<Value>>,
        appointments: Arc<Vec<Value>>,
        templates: &[Value],
    ) -> Result<Self, InputError> {
        Self::prepare(shifts, appointments, templates, true)
    }
    fn prepare(
        shifts: Arc<Vec<Value>>,
        appointments: Arc<Vec<Value>>,
        templates: &[Value],
        repository_window: bool,
    ) -> Result<Self, InputError> {
        let entries = Self::normalize_rows(
            &shifts,
            &appointments,
            repository_window.then_some(templates),
        )?;
        let candidates = recurrence::collation_candidates(&entries)
            .map_err(|_| invalid("Die Kalender-Sortierangaben sind ungültig."))?;
        Ok(Self {
            shifts,
            appointments,
            entries,
            candidates,
        })
    }
    /// Borrow original SQL rows for one-time native preflight. No second raw
    /// plan owner or deep clone is needed before platform ranks are available.
    pub fn normalize_rows(
        shifts: &[Value],
        appointments: &[Value],
        templates: Option<&[Value]>,
    ) -> Result<Vec<Value>, InputError> {
        let repository_window = templates.is_some();
        let templates = templates.unwrap_or(&[]);
        if templates.len() > crate::contract::MAX_SOURCE_ITEMS as usize {
            return Err(invalid("Die gespeicherten Vorlagen sind zu groß."));
        }
        let mut lookup = BTreeMap::new();
        for template in templates {
            if !exact(template, &["id", "name", "color", "symbol"]) {
                return Err(invalid("Die gespeicherten Vorlagenzeilen sind ungültig."));
            }
            let id = template["id"]
                .as_str()
                .filter(|id| !id.is_empty())
                .ok_or_else(|| invalid("Die gespeicherte Vorlagenzuordnung ist ungültig."))?;
            if lookup.insert(id, template).is_some() {
                return Err(invalid("Eine gespeicherte Vorlage ist mehrfach vorhanden."));
            }
        }
        if shifts.len().saturating_add(appointments.len()) > 50000 {
            return Err(invalid("Die gespeicherten Kalenderdaten sind zu groß."));
        }
        let mut ids = BTreeSet::new();
        let mut entries = Vec::with_capacity(shifts.len() + appointments.len());
        for (rows, keys, kind, mapper) in [
            (
                shifts,
                SHIFT_ROW_FIELDS,
                "SHIFT",
                map_shift as fn(&Value) -> Result<Value, InputError>,
            ),
            (
                appointments,
                APPOINTMENT_ROW_FIELDS,
                "APPOINTMENT",
                map_appointment,
            ),
        ] {
            for row in rows.iter() {
                if !exact(row, keys) {
                    return Err(invalid("Die gespeicherten Kalenderzeilen sind ungültig."));
                }
                // Reproduce the original display SQL default window, while
                // retaining complete original rows for payroll history.
                if repository_window
                    && !row["date"].as_str().is_some_and(|date| {
                        date <= "4099-12-31"
                            && (date >= "1900-01-01"
                                || (kind == "APPOINTMENT"
                                    && !row["recurrence_frequency"].is_null()))
                    })
                {
                    continue;
                }
                metadata(row)?;
                if !ids.insert((kind, row["id"].as_str().expect("checked id"))) {
                    return Err(invalid(
                        "Ein gespeicherter Kalendereintrag ist mehrfach vorhanden.",
                    ));
                }
                let template = (kind == "SHIFT")
                    .then(|| {
                        row["template_id"]
                            .as_str()
                            .and_then(|id| lookup.get(id).copied())
                    })
                    .flatten();
                entries.push(if template.is_some() {
                    map_shift_display(row, template)?
                } else {
                    mapper(row)?
                });
            }
        }
        Ok(entries)
    }
    pub fn collation_candidates(&self) -> &BTreeSet<String> {
        &self.candidates
    }
    /// Borrow for further native preflight, including projected-duty IDs.
    pub fn normalized_entries(&self) -> &[Value] {
        &self.entries
    }
    pub fn into_ranked(self, ranks: &CollationRanks) -> Result<RawCalendarEntries, InputError> {
        self.into_ranked_owned(ranks.clone())
    }
    /// The runtime transfers its already admitted comparison ranks without a
    /// second large string-map allocation. Other reports share this same owner.
    pub fn into_ranked_owned(
        self,
        ranks: CollationRanks,
    ) -> Result<RawCalendarEntries, InputError> {
        let entries = recurrence::sort_calendar_entries(self.entries, &ranks).map_err(|_| {
            invalid("Die Plattform-Sortierangaben für den Kalender sind unvollständig.")
        })?;
        Ok(RawCalendarEntries {
            shifts: self.shifts,
            appointments: self.appointments,
            entries: Arc::new(entries),
            collation: Arc::new(ranks),
            plan_rows: OnceLock::new(),
            active_shifts: OnceLock::new(),
            payroll_shifts: OnceLock::new(),
        })
    }
}
pub struct RawCalendarEntries {
    shifts: Arc<Vec<Value>>,
    appointments: Arc<Vec<Value>>,
    entries: Arc<Vec<Value>>,
    collation: Arc<CollationRanks>,
    plan_rows: OnceLock<Arc<Vec<Value>>>,
    active_shifts: OnceLock<Arc<Vec<Value>>>,
    payroll_shifts: OnceLock<Result<Arc<Vec<Value>>, InputError>>,
}
impl RawCalendarEntries {
    pub fn try_from_rows(
        shifts: Arc<Vec<Value>>,
        appointments: Arc<Vec<Value>>,
        ranks: &CollationRanks,
    ) -> Result<Self, InputError> {
        PreparedCalendarRows::from_rows(shifts, appointments)?.into_ranked(ranks)
    }
    pub fn raw_shift_rows(&self) -> &Arc<Vec<Value>> {
        &self.shifts
    }
    /// Original Caritas payroll loader: active unjoined SQL rows in SQLite
    /// BINARY date,id order, then the ordinary original mapShift normalization.
    /// This is independent of display coalescing, display collation and windows.
    pub fn payroll_shifts(&self) -> Result<&Arc<Vec<Value>>, InputError> {
        self.payroll_shifts
            .get_or_init(|| {
                let mut rows: Vec<&Value> = self
                    .shifts
                    .iter()
                    .filter(|row| row.get("deleted_at") == Some(&Value::Null))
                    .collect();
                rows.sort_by(|a, b| {
                    a["date"]
                        .as_str()
                        .cmp(&b["date"].as_str())
                        .then_with(|| a["id"].as_str().cmp(&b["id"].as_str()))
                });
                let mut mapped = Vec::with_capacity(rows.len());
                for row in rows {
                    metadata(row)?;
                    mapped.push(map_shift(row)?);
                }
                Ok(Arc::new(mapped))
            })
            .as_ref()
            .map_err(Clone::clone)
    }
    pub fn raw_appointment_rows(&self) -> &Arc<Vec<Value>> {
        &self.appointments
    }
    pub fn entries(&self) -> &Arc<Vec<Value>> {
        &self.entries
    }
    pub fn collation(&self) -> &Arc<CollationRanks> {
        &self.collation
    }
    /// Same source selection as monthly remuneration, prepared once for every
    /// session/month. An all-shift collection shares its existing allocation.
    pub fn active_shifts(&self) -> &Arc<Vec<Value>> {
        self.active_shifts.get_or_init(|| {
            let active = |entry: &&Value| {
                entry["kind"] == "SHIFT" && entry.get("deletedAt") == Some(&Value::Null)
            };
            if self.entries.iter().all(|entry| active(&entry)) {
                Arc::clone(&self.entries)
            } else {
                Arc::new(self.entries.iter().filter(active).cloned().collect())
            }
        })
    }
    /// Full raw SQL plan facts, independently ordered from display entries.
    pub fn target_plan_rows(&self) -> &Arc<Vec<Value>> {
        self.plan_rows.get_or_init(|| {
            let mut rows: Vec<Value> = self
                .shifts
                .iter()
                .filter(|row| row.get("deleted_at") == Some(&Value::Null))
                .map(|row| {
                    Value::Object(
                        [
                            "id",
                            "date",
                            "revision",
                            "updated_at",
                            "start_time",
                            "end_time",
                            "type",
                            "all_day",
                            "break_minutes",
                        ]
                        .iter()
                        .map(|key| ((*key).into(), row[*key].clone()))
                        .collect(),
                    )
                })
                .collect();
            // SQLite's BINARY UTF-8 order is independent of platform collation
            // and of normalized dates/times used by the display projection.
            rows.sort_by(|a, b| {
                a["date"]
                    .as_str()
                    .cmp(&b["date"].as_str())
                    .then_with(|| a["id"].as_str().cmp(&b["id"].as_str()))
            });
            Arc::new(rows)
        })
    }
}
pub struct RawMonthlyTariffDecisions {
    raw: Arc<Vec<Value>>,
    decisions: Arc<Vec<Value>>,
}
impl RawMonthlyTariffDecisions {
    pub fn try_from_rows(raw: Arc<Vec<Value>>) -> Result<Self, InputError> {
        if raw.len() > 50000 {
            return Err(invalid(
                "Die gespeicherten Tarifentscheidungen sind zu groß.",
            ));
        }
        let mut months = BTreeSet::new();
        let mut decisions = Vec::with_capacity(raw.len());
        for row in raw.iter() {
            if !exact(row, DECISION_ROW_FIELDS) {
                return Err(invalid(
                    "Die gespeicherten Tarifentscheidungszeilen sind ungültig.",
                ));
            }
            let value = map_tariff_decision(row)?;
            if row["revision"]
                .as_f64()
                .is_none_or(|n| n > 9007199254740991.0)
            {
                return Err(invalid("Ungültige Datensatzrevision."));
            }
            if !months.insert(value["month"].as_str().expect("validated month").to_owned()) {
                return Err(invalid(
                    "Für einen Monat liegen mehrere Tarifentscheidungen vor.",
                ));
            }
            decisions.push(value);
        }
        decisions.sort_by(|a, b| a["month"].as_str().cmp(&b["month"].as_str()));
        Ok(Self {
            raw,
            decisions: Arc::new(decisions),
        })
    }
    pub fn raw_rows(&self) -> &Arc<Vec<Value>> {
        &self.raw
    }
    pub fn decisions(&self) -> &Arc<Vec<Value>> {
        &self.decisions
    }
}
