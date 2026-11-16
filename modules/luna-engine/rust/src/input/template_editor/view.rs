use super::{InputError, TYPES, TemplateEditorDraft, absence, invalid};
use crate::{employment::profile_view::EmploymentProfileRef, input::profile_form::FormClock};
use serde_json::{Value, json};
fn notification(rule: &Value) -> Result<String, InputError> {
    if rule.is_null() {
        return Ok("Keine".into());
    }
    let reference = if rule["reference"] == "START" {
        "Beginn"
    } else {
        "Ende"
    };
    if rule["amount"].as_f64() == Some(0.0) {
        return Ok(format!("Zum {reference}"));
    }
    let unit = match rule["unit"].as_str() {
        Some("MINUTE") => "Min.",
        Some("HOUR") => "Std.",
        Some("DAY") => "Tage",
        Some("WEEK") => "Wochen",
        _ => return Err(invalid()),
    };
    let amount = super::javascript_json::number_text(rule["amount"].as_f64().ok_or_else(invalid)?);
    Ok(format!(
        "{amount} {unit} {} {reference}",
        if rule["direction"] == "BEFORE" {
            "vor"
        } else {
            "nach"
        }
    ))
}
fn tariff_policy(
    profile: &Value,
    requested_date: Option<&str>,
    today: impl FnOnce(&str) -> Result<String, InputError>,
) -> Result<Value, InputError> {
    if profile.is_null() || crate::net::js_truthy(&profile["salaryBasisConflict"]) {
        return Ok(Value::Null);
    }
    let date = requested_date
        .map(str::to_owned)
        .map(Ok)
        .unwrap_or_else(|| today(profile["timeZone"].as_str().unwrap_or("Europe/Berlin")))?;
    let effective = EmploymentProfileRef::at(profile, &date)
        .map_err(crate::input::employment::employment_error)?;
    let mut selection = serde_json::Map::new();
    for key in [
        "tvUkNursingTariff",
        "tvhKrTariff",
        "tvalPflegeTariff",
        "tvlKrTariff",
        "nursingTrainingTariff",
        "vkaETariff",
        "tariff",
    ] {
        if let Some(value) = effective.get(key) {
            selection.insert(key.into(), value.clone());
        }
    }
    serde_json::to_value(crate::pay::duty_policy::duty_tariff_family(&Value::Object(
        selection,
    )))
    .map_err(|_| invalid())
}
/// Read-only UI query over the genuine retained Provided-role profile. The
/// render instant chooses today only; it never reprojects the captured profile.
pub fn tariff_query(
    profile: &Value,
    requested_date: Option<&str>,
    render_epoch: f64,
) -> Result<Value, InputError> {
    tariff_policy(profile, requested_date, |zone| {
        let instant = crate::input::javascript_date::iso_from_epoch_milliseconds(render_epoch)?;
        FormClock::from_instant(&instant)?.date_in(zone)
    })
}
impl TemplateEditorDraft {
    pub(super) fn form_flags(&self, quick_date: Option<&str>) -> Value {
        json!({"absence":absence(&self.fields["type"]),"entryType":self.entry_type(),"typeLocked":!self.existing.is_null()&&absence(&self.existing["type"]),"createsCalendarEntry":self.existing.is_null()&&quick_date.is_some()})
    }

    /// The original Provider role is borrowed. No full profile/50k target is
    /// materialized for a render; dates derive from one raw immutable instant.
    pub fn render(
        &self,
        profile: &Value,
        clock: &FormClock,
        quick_date: Option<&str>,
        ios: bool,
    ) -> Result<Value, InputError> {
        let f = &self.fields;
        let tariff = tariff_policy(profile, quick_date, |zone| clock.date_in(zone))?;
        let mut flags = self.form_flags(quick_date);
        let absent = flags["absence"] == true;
        let entry_type = self.entry_type();
        let locked = flags["typeLocked"] == true;
        let creates = flags["createsCalendarEntry"] == true;
        let saving = f["saving"] == true;
        let mut controls = vec![
            json!({"component":"Stack.Screen","options":{"title":if self.existing.is_null(){"Neue Dienstvorlage"}else{"Dienstvorlage"}}}),
        ];
        if !creates {
            controls
                .push(json!({"component":"HeaderSaveAction","label":"Speichern","busy":saving}));
        }
        controls.push(json!({"component":"CompactInputRow","testID":"template-title-row","label":"Titel","value":f["name"],"error":f["nameError"]}));
        if f["appearanceExpanded"] == true {
            controls.push(json!({"component":"ShiftSymbolPicker","value":f["symbol"],"error":f["symbolError"]}));
            controls.push(json!({"component":"ColorPicker","value":f["color"]}));
        } else {
            controls.push(json!({"component":"CompactActionRow","testID":"template-appearance-toggle","label":"Symbol und Farbe","expanded":false}));
        }
        let mut type_row = json!({"component":"CompactActionRow","testID":"template-type-row","label":"Eintragsart","value":self.appearance["labels"][entry_type],"disabled":locked});
        if !ios {
            type_row["expanded"] = f["typePickerExpanded"].clone();
        }
        controls.push(type_row);
        if f["typePickerExpanded"] == true {
            for kind in TYPES {
                controls.push(json!({"component":"SelectionChip","label":self.appearance["labels"][kind],"selected":kind==entry_type}));
            }
        }
        if absent {
            controls.push(json!({"component":"Text","text":if f["type"]=="FREE"{"Frei wird mit 0 Stunden geführt."}else{"Die Abwesenheit ergänzt Arbeitszeit bis zum Tages-Soll."}}));
        } else {
            controls.push(json!({"component":"CompactSwitchRow","testID":"template-all-day-row","label":"Ganztägig","value":f["allDay"]}));
        }
        if !absent && f["allDay"] != true && f["type"] != "TRAINING" {
            controls.push(json!({"component":"SpecialDutyFields","value":f["specialDuty"],"template":true,"tariffFamily":tariff,"timeZone":"Europe/Berlin","startTime":f["startTime"],"endTime":f["endTime"],"breakMinutes":f["breakMinutes"]}));
        }
        if !absent && f["allDay"] != true && (f["specialDuty"].is_null() || f["type"] == "TRAINING")
        {
            controls.push(
                json!({"component":"TimePickerField","label":"Start","value":f["startTime"]}),
            );
            controls
                .push(json!({"component":"TimePickerField","label":"Ende","value":f["endTime"]}));
            controls.push(json!({"component":"CompactPausePicker","value":f["breakMinutes"]}));
        }
        controls.push(json!({"component":"CompactActionRow","testID":"template-notification-row","label":"Erinnerung","value":notification(&f["notification"])?}));
        controls.push(json!({"component":"CompactActionRow","testID":"template-location-row","label":"Ort","value":f["location"].get("name").filter(|v|!v.is_null()).cloned().unwrap_or_else(||json!("Kein Ort"))}));
        if !f["location"].is_null() {
            controls.push(json!({"component":"LocationPreview","location":f["location"]}));
        }
        controls.push(json!({"component":"FormStatus","error":f["error"]}));
        if creates {
            controls.push(json!({"component":"PrimaryButton","disabled":saving,"text":if saving{"Wird gespeichert …"}else{"Vorlage erstellen und eintragen"}}));
        }
        if !self.existing.is_null() {
            controls.push(json!({"component":"PrimaryButton","disabled":saving,"danger":true,"shape":"pill","text":"Vorlage löschen"}));
        }
        if f["notificationOpen"] == true {
            controls.push(json!({"component":if ios{"ShiftNotificationOverlay"}else{"NotificationSheet"},"value":f["notification"]}));
        }
        flags["tariffFamily"] = tariff;
        Ok(json!({"fields":f,"flags":flags,"controls":controls}))
    }
}
