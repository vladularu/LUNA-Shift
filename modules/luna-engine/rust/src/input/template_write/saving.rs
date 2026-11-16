use super::*;
impl NativeTemplateWriteSource {
    pub(super) fn save(
        &self,
        raw: &Value,
        clock: &mut Clock<'_>,
        allocated_id: Option<&str>,
    ) -> Result<NativeTemplateWritePlan, InputError> {
        let input = crate::input::calendar::validate_template(raw)?;
        let id = if input["id"].is_null() {
            allocated_id.ok_or_else(invalid)?
        } else {
            input["id"].as_str().ok_or_else(invalid)?
        };
        let now = clock.iso()?;
        let insert = input.get("id").is_none();
        let expected = raw_revision(&input["expectedRevision"]);
        let mut row = if insert {
            json!({"id":id,"name":null,"type":null,"all_day":0,"start_time":null,"end_time":null,"break_minutes":0,"color":null,"symbol":null,"notification_json":null,"location_json":null,"sort_order":null,"special_duty_json":null,"revision":1,"created_at":now,"updated_at":now,"deleted_at":null})
        } else {
            let old = self.active_row(id, expected)?;
            let mut row = old.clone();
            row["revision"] = json!(revision(old)? + 1);
            row["updated_at"] = json!(now);
            row
        };
        for (column, key) in [
            ("name", "name"),
            ("type", "type"),
            ("start_time", "startTime"),
            ("end_time", "endTime"),
            ("break_minutes", "breakMinutes"),
            ("color", "color"),
            ("symbol", "symbol"),
            ("sort_order", "sortOrder"),
        ] {
            row[column] = input[key].clone();
        }
        row["all_day"] = json!(if crate::net::js_truthy(&input["allDay"]) {
            1
        } else {
            0
        });
        for (column, key) in [
            ("notification_json", "notification"),
            ("location_json", "location"),
            ("special_duty_json", "specialDuty"),
        ] {
            row[column] = serialized(&input[key])?;
        }
        let returned = calendar_rows::map_template(&row);
        let expected = if insert {
            Value::Null
        } else {
            json!({"revision":number(expected)})
        };
        Ok(NativeTemplateWritePlan::new(
            vec![json!({"kind":"UPSERT_SHIFT_TEMPLATE","row":row,"expected":expected})],
            returned,
        ))
    }
    pub(super) fn delete(
        &self,
        payload: &Value,
        clock: &mut Clock<'_>,
    ) -> Result<NativeTemplateWritePlan, InputError> {
        let updated = clock.iso()?;
        let deleted = clock.iso()?;
        let id = payload["id"].as_str().ok_or_else(invalid)?;
        let expected = raw_revision(&payload["revision"]);
        let old = self.active_row(id, expected)?;
        let mut row = old.clone();
        row["revision"] = json!(revision(old)? + 1);
        row["updated_at"] = json!(updated);
        row["deleted_at"] = json!(deleted);
        Ok(NativeTemplateWritePlan::new(
            vec![
                json!({"kind":"TOMBSTONE_SHIFT_TEMPLATE","row":row,"expected":{"revision":number(expected)}}),
            ],
            Ok(Value::Null),
        ))
    }
    pub(super) fn restore(
        &self,
        payload: &Value,
        clock: &mut Clock<'_>,
    ) -> Result<NativeTemplateWritePlan, InputError> {
        let now = clock.iso()?;
        let id = payload["id"].as_str().ok_or_else(invalid)?;
        let captured = payload["revision"].as_f64().ok_or_else(invalid)?;
        let expected = captured + 1.0;
        let old = self
            .get(id)
            .filter(|r| !r["deleted_at"].is_null() && r["revision"].as_f64() == Some(expected))
            .ok_or_else(conflict)?;
        let mut row = old.clone();
        row["revision"] = json!(revision(old)? + 1);
        row["updated_at"] = json!(now);
        row["deleted_at"] = Value::Null;
        let mut returned = payload.clone();
        if !returned.is_object() {
            return Err(invalid());
        }
        returned["revision"] = number(captured + 2.0);
        returned["updatedAt"] = json!(now);
        returned["deletedAt"] = Value::Null;
        Ok(NativeTemplateWritePlan::new(
            vec![
                json!({"kind":"RESTORE_SHIFT_TEMPLATE","row":row,"expected":{"revision":number(expected)}}),
            ],
            Ok(returned),
        ))
    }
}
