use super::*;
impl NativeTemplateWriteSource {
    pub(super) fn swap(
        &self,
        payload: &Value,
        clock: &mut Clock<'_>,
    ) -> Result<NativeTemplateWritePlan, InputError> {
        let now = clock.iso()?;
        let values = payload
            .as_array()
            .filter(|a| a.len() == 2)
            .ok_or_else(invalid)?;
        let first = &values[0];
        let second = &values[1];
        let first_id = first["id"].as_str().ok_or_else(invalid)?;
        let second_id = second["id"].as_str().ok_or_else(invalid)?;
        let first_row = self.active_row(first_id, raw_revision(&first["revision"]))?;
        let second_row = self.active_row(second_id, raw_revision(&second["revision"]))?;
        if first_id == second_id {
            return Err(conflict());
        }
        let mut rows = vec![first_row.clone(), second_row.clone()];
        rows[0]["sort_order"] = second["sortOrder"].clone();
        rows[1]["sort_order"] = first["sortOrder"].clone();
        for row in &mut rows {
            row["revision"] = json!(revision(row)? + 1);
            row["updated_at"] = json!(now);
        }
        let returned = rows
            .iter()
            .map(calendar_rows::map_template)
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array);
        let mutations=rows.into_iter().zip(values).map(|(row,original)|json!({"kind":"UPDATE_SHIFT_TEMPLATE_ORDER","row":row,"expected":{"revision":original["revision"]}})).collect();
        Ok(NativeTemplateWritePlan::new(mutations, returned))
    }
    pub(super) fn reorder(
        &self,
        payload: &Value,
        clock: &mut Clock<'_>,
    ) -> Result<NativeTemplateWritePlan, InputError> {
        let current = self.active_templates()?;
        let requested = payload.as_array().ok_or_else(invalid)?;
        let mut expected = BTreeMap::new();
        for item in requested {
            expected.insert(
                item["id"].as_str().ok_or_else(invalid)?,
                raw_revision(&item["revision"]),
            );
        }
        if expected.len() != requested.len()
            || current.len() != requested.len()
            || current.iter().any(|t| {
                expected.get(t["id"].as_str().expect("mapped id")).copied()
                    != t["revision"].as_f64()
            })
        {
            return Err(conflict());
        }
        if current
            .iter()
            .zip(requested)
            .all(|(a, b)| a["id"] == b["id"])
        {
            return Ok(NativeTemplateWritePlan::new(
                vec![],
                Ok(Value::Array(current)),
            ));
        }
        let now = clock.iso()?;
        let mut rows = vec![];
        let mut mutations = vec![];
        for (index, item) in requested.iter().enumerate() {
            let old = self
                .get(item["id"].as_str().expect("checked permutation id"))
                .expect("checked permutation");
            if old["sort_order"].as_f64() == Some(index as f64) {
                continue;
            }
            let mut row = old.clone();
            row["sort_order"] = json!(index);
            row["revision"] = json!(revision(old)? + 1);
            row["updated_at"] = json!(now);
            mutations.push(json!({"kind":"UPDATE_SHIFT_TEMPLATE_ORDER","row":row,"expected":{"revision":item["revision"]}}));
            rows.push(row);
        }
        let returned = self
            .ordered(&rows)?
            .into_iter()
            .map(calendar_rows::map_template)
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array);
        Ok(NativeTemplateWritePlan::new(mutations, returned))
    }
}
