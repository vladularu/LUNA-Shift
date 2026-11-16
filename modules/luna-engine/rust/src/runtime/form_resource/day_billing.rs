//! Selection owns only original IDs/revisions. Candidate rows remain borrowed
//! from the private admitted review; renderer output can never become a source.
use super::*;
#[cfg(test)]
use crate::test_value_pool as value_pool;
#[derive(Default)]
pub(super) struct BillingSelection {
    selected: Vec<(String, Value)>,
}
impl BillingSelection {
    pub(super) fn clear(&mut self) {
        self.selected.clear();
    }
    pub(super) fn ids(&self) -> Vec<String> {
        self.selected.iter().map(|(id, _)| id.clone()).collect()
    }
    pub(super) fn toggle(
        &mut self,
        candidates: &[&Value],
        id: &str,
        revision: &Value,
    ) -> Result<(), FormResourceError> {
        let entry = candidates
            .iter()
            .find(|row| row["id"].as_str() == Some(id) && &row["revision"] == revision)
            .ok_or(FormResourceError::StaleResource)?;
        if let Some(index) = self
            .selected
            .iter()
            .position(|(selected, _)| selected == id)
        {
            self.selected.remove(index);
        } else {
            self.selected
                .push((id.to_owned(), entry["revision"].clone()));
        }
        Ok(())
    }
    pub(super) fn validate(&self, candidates: &[&Value]) -> Result<(), crate::input::InputError> {
        if self.selected.iter().any(|(id, revision)| {
            !candidates
                .iter()
                .any(|row| row["id"].as_str() == Some(id) && &row["revision"] == revision)
        }) {
            return Err(crate::input::InputError::validation(
                "Ein ausgewählter Dienst wurde geändert. Wähle die Dienste erneut aus.",
            ));
        }
        Ok(())
    }
    pub(super) fn page(
        &self,
        candidates: &[&Value],
        offset: usize,
        open: bool,
    ) -> Result<Value, FormResourceError> {
        if offset > candidates.len() {
            return Err(FormResourceError::InvalidHeader);
        }
        let visible = !candidates.is_empty() || !self.selected.is_empty();
        let label = if !visible {
            Value::Null
        } else if self.selected.is_empty() {
            json!("Auswählen")
        } else {
            json!(format!("{} ausgewählt", self.selected.len()))
        };
        let mut rows = Vec::new();
        let mut bytes = 0usize;
        if visible && open {
            for row in candidates.iter().skip(offset).take(128) {
                let date = row["date"]
                    .as_str()
                    .ok_or(FormResourceError::InvalidSource)?;
                let title = row["title"]
                    .as_str()
                    .ok_or(FormResourceError::InvalidSource)?;
                let date_title = crate::calendar::presentation::navigation::date_title(date)
                    .map_err(|_| FormResourceError::InvalidSource)?;
                let start = row["startTime"].as_str().unwrap_or("");
                let end = row["endTime"].as_str().unwrap_or("");
                let checked = self
                    .selected
                    .iter()
                    .any(|(id, _)| row["id"].as_str() == Some(id));
                let item = json!({"id":row["id"],"revision":row["revision"],"dateLabel":date_title,
                    "detailLabel":format!("{title} · {start}–{end}"),"label":format!("{date_title}, {title}"),"checked":checked});
                let size = serde_json::to_vec(&item)
                    .map_err(|_| FormResourceError::InvalidSource)?
                    .len();
                if bytes + size > 128 * 1024 {
                    if rows.is_empty() {
                        return Err(FormResourceError::OutputTooLarge);
                    }
                    break;
                }
                bytes += size;
                rows.push(item);
            }
        }
        Ok(
            json!({"state":"READY","visible":visible,"label":label,"open":open,"selectedCount":self.selected.len(),
            "resetVisible":visible&&open&&!self.selected.is_empty(),"offset":offset,"nextOffset":offset+rows.len(),"total":candidates.len(),"rows":rows}),
        )
    }
}
impl DayState {
    pub(in crate::runtime::form_resource) fn billing_event(
        &mut self,
        event: &Event,
        raw: &[u8],
    ) -> Result<Option<Value>, FormResourceError> {
        let (offset, open) = match event {
            Event::BillingView { offset, open } => {
                if !raw.is_empty() {
                    return Err(FormResourceError::InvalidHeader);
                }
                (*offset, *open)
            }
            Event::BillingClear { open, offset } => {
                if !raw.is_empty() {
                    return Err(FormResourceError::InvalidHeader);
                }
                (*offset, *open)
            }
            Event::BillingToggleBody { open, offset, .. } => (*offset, *open),
            _ => return Ok(None),
        };
        if self.terminal || self.write.is_some() {
            return Err(FormResourceError::StaleResource);
        }
        let toggle_id = if matches!(event, Event::BillingToggleBody { .. }) {
            if raw.len() > 256 * 1024 {
                return Err(FormResourceError::InputTooLarge);
            }
            let value =
                crate::contract::bounded_json(raw).map_err(|_| FormResourceError::InvalidHeader)?;
            Some(
                value
                    .as_str()
                    .ok_or(FormResourceError::InvalidHeader)?
                    .to_owned(),
            )
        } else {
            None
        };
        let controller = &self.controller;
        let duty = controller.special_duty();
        if controller.source().initial().is_none()
            || controller.source().profile().is_none()
            || (duty["kind"] != "STANDBY" && !(controller.billing_focus() && !duty.is_null()))
        {
            if toggle_id.is_some() {
                return Err(FormResourceError::StaleResource);
            }
            if matches!(event, Event::BillingClear { .. }) {
                self.billing.clear();
            }
            // Retain an existing selection when the draft changes its duty kind,
            // like the original hook; saving still validates every selected row.
            return self.billing.page(&[], offset, open).map(Some);
        }
        let Some(super::review::ReviewSlot::Ready(source)) = self.review.as_ref() else {
            return Ok(Some(json!({"state":"SOURCE_REQUIRED"})));
        };
        let candidates = source
            .candidates(duty)
            .map_err(|_| FormResourceError::InvalidSource)?;
        match event {
            Event::BillingToggleBody { revision, .. } => {
                self.billing.toggle(
                    &candidates,
                    toggle_id.as_deref().expect("native raw toggle"),
                    revision,
                )?;
            }
            Event::BillingClear { .. } => self.billing.clear(),
            _ => {}
        }
        let mut page = self.billing.page(&candidates, offset, open)?;
        page["message"] = if controller.billing_focus() {
            source
                .billing_message(duty)
                .map_err(|_| FormResourceError::InvalidSource)?
        } else {
            Value::Null
        };
        Ok(Some(page))
    }
    pub(super) fn billing_inputs(&self) -> Result<Vec<Value>, crate::input::InputError> {
        let ids = self.billing.ids();
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let duty = self.controller.special_duty();
        if duty.is_null() {
            return Ok(vec![]);
        }
        let Some(super::review::ReviewSlot::Ready(source)) = self.review.as_ref() else {
            return Err(crate::input::InputError::validation(
                "Prüfe die ausgewählten Bereitschaftsdienste erneut.",
            ));
        };
        let candidates = source.candidates(duty).map_err(|_| {
            crate::input::InputError::validation(
                "Prüfe die ausgewählten Bereitschaftsdienste erneut.",
            )
        })?;
        let inputs = source
            .transfer_inputs(duty, &ids)
            .map_err(|error| match error {
                crate::runtime::day_editor_review::DayReviewError::Input(error) => error,
                crate::runtime::day_editor_review::DayReviewError::SourceChanged => {
                    crate::input::InputError::validation(
                        "Ein ausgewählter Dienst wurde geändert. Wähle die Dienste erneut aus.",
                    )
                }
                _ => crate::input::InputError::validation(
                    "Prüfe die ausgewählten Bereitschaftsdienste erneut.",
                ),
            })?;
        self.billing.validate(&candidates)?;
        Ok(inputs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn actual_original_picker_frames_and_callback_selections_match() {
        let fixture = value_pool::decode(include_str!(
            "../../../../reference/day-billing-ui-golden.json"
        ));
        let mut count = 0;
        for case in fixture["cases"].as_array().unwrap() {
            let candidates = case["input"]["candidates"]
                .as_array()
                .unwrap()
                .iter()
                .collect::<Vec<_>>();
            let mut selection = BillingSelection::default();
            let mut open = false;
            let mut changes = vec![];
            for (index, expected) in case["expected"]["states"]
                .as_array()
                .unwrap()
                .iter()
                .enumerate()
            {
                if index > 0 {
                    let action = &case["input"]["actions"][index - 1];
                    match action["kind"].as_str().unwrap() {
                        "OPEN" => open = true,
                        "CLOSE" => open = false,
                        "RESET" => {
                            selection.clear();
                            changes.push(json!(selection.ids()));
                        }
                        "TOGGLE" => {
                            let id = action["id"].as_str().unwrap();
                            let row = candidates.iter().find(|row| row["id"] == id).unwrap();
                            selection.toggle(&candidates, id, &row["revision"]).unwrap();
                            changes.push(json!(selection.ids()));
                        }
                        _ => panic!("unknown original UI action"),
                    }
                }
                let page = selection.page(&candidates, 0, open).unwrap();
                let rows=page["rows"].as_array().unwrap().iter().map(|row|json!({"id":row["id"],"label":row["label"],"checked":row["checked"],"text":format!("{}{}",row["dateLabel"].as_str().unwrap(),row["detailLabel"].as_str().unwrap())})).collect::<Vec<_>>();
                assert_eq!(
                    json!({"visible":page["visible"],"label":page["label"],"open":page["open"],"selectedIds":selection.ids(),"resetVisible":page["resetVisible"],"rows":rows}),
                    *expected,
                    "{} frame {index}",
                    case["id"]
                );
                count += 1;
            }
            assert_eq!(json!(changes), case["expected"]["changes"]);
        }
        assert_eq!(count, 276);
    }
}
