use super::{
    EmploymentPatch,
    sql::{CONFLICT, ProfileWriteError},
    sql_state::State,
};
use crate::input::{InputError, profile_editor::ProfileFields};
use serde_json::{Value, json};
fn truthy(value: Option<&Value>) -> bool {
    value.is_some_and(crate::net::js_truthy)
}
fn merged(base: &Value, overlay: &Value) -> Result<Value, InputError> {
    let mut object = base.as_object().ok_or_else(super::invalid)?.clone();
    object.extend(overlay.as_object().ok_or_else(super::invalid)?.clone());
    Ok(Value::Object(object))
}
fn keys(value: Option<&Value>) -> Result<Option<Vec<String>>, InputError> {
    value
        .filter(|value| crate::net::js_truthy(value))
        .map(|value| {
            value.as_array().ok_or_else(super::invalid).and_then(|a| {
                a.iter()
                    .map(|v| v.as_str().map(str::to_owned).ok_or_else(super::invalid))
                    .collect()
            })
        })
        .transpose()
}
fn revision(value: &Value) -> Result<i64, InputError> {
    value.as_i64().ok_or_else(super::invalid)
}
fn plus_one(value: i64) -> Result<Value, InputError> {
    Ok(json!(value.checked_add(1).ok_or_else(super::invalid)?))
}
fn overrides(item: &Value, fields: &[String], today: &str) -> Result<Option<Value>, InputError> {
    let mut result = item
        .get("employmentOverrides")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for field in fields {
        result.insert(field.clone(), json!(today));
    }
    Ok((!result.is_empty()).then_some(Value::Object(result)))
}
pub(super) fn restore(
    state: &mut State,
    raw: &impl ProfileFields,
    stored: &Value,
    current: &Value,
    history: &[Value],
    validity: &Value,
    epoch: f64,
) -> Result<std::sync::Arc<Value>, ProfileWriteError> {
    let Some(baseline) = validity
        .get("baseline")
        .filter(|value| crate::net::js_truthy(value))
    else {
        return Err(ProfileWriteError::Concurrency(CONFLICT));
    };
    let baseline = crate::input::employment::validate_employment_data(baseline)?;
    if !super::patch::same(
        Some(&baseline),
        Some(&super::compatibility::employment_data(current)?),
    )? {
        return Err(ProfileWriteError::Concurrency(CONFLICT));
    }
    let previous = validity["restoreTimeline"]
        .as_array()
        .ok_or_else(super::invalid)?;
    let mut dates = std::collections::BTreeSet::new();
    for item in previous {
        let date = &item["effectiveFrom"];
        if !date.is_null() {
            crate::employment::require_remuneration_date(date.as_str().ok_or_else(super::invalid)?)
                .map_err(|e| {
                    InputError::user_facing_source(e.to_string(), "RemunerationProfileError")
                })?;
        }
        if !dates.insert(date.to_string()) {
            return Err(
                InputError::validation("Der frühere Verlauf enthält doppelte Zeiträume.").into(),
            );
        }
    }
    for item in previous {
        crate::input::employment::encode_employment_payload(
            &item["data"],
            item.get("employment"),
            item.get("employmentOverrides"),
        )?;
    }
    state.check_test()?;
    state.delete_history();
    let now = crate::input::javascript_date::iso_from_epoch_milliseconds(epoch)?;
    for item in previous {
        let mut entry = item.clone();
        let current = history
            .iter()
            .find(|row| row["effectiveFrom"] == item["effectiveFrom"])
            .map(|row| revision(&row["revision"]))
            .transpose()?
            .unwrap_or(0);
        entry["revision"] = plus_one(revision(&item["revision"])?.max(current))?;
        entry["updatedAt"] = json!(now);
        state.write_history(&entry)?;
    }
    struct Identity<'a, T: ProfileFields> {
        raw: &'a T,
        stored: &'a Value,
    }
    impl<T: ProfileFields> ProfileFields for Identity<'_, T> {
        fn field(&self, key: &str) -> Option<&Value> {
            if ["displayName", "employerName"].contains(&key) {
                self.stored.get(key)
            } else {
                self.raw.field(key)
            }
        }
    }
    let saved = state.write_profile(&Identity { raw, stored }, epoch)?;
    super::sql_state::project(state, saved, epoch).map_err(Into::into)
}
pub(super) struct EmploymentSaveContext<'a> {
    pub stored: &'a Value,
    pub current: &'a Value,
    pub history: &'a [Value],
    pub validity: &'a Value,
    pub legacy: &'a Value,
    pub epoch: f64,
}
pub(super) fn save(
    state: &mut State,
    raw: &impl ProfileFields,
    context: EmploymentSaveContext<'_>,
) -> Result<std::sync::Arc<Value>, ProfileWriteError> {
    let EmploymentSaveContext {
        stored,
        current,
        history,
        validity,
        legacy,
        epoch,
    } = context;
    let effective = validity.get("effectiveFrom").ok_or_else(|| {
        InputError::user_facing_source(
            crate::employment::EmploymentError::InvalidDate.to_string(),
            "RemunerationProfileError",
        )
    })?;
    let date = if effective.is_null() {
        None
    } else {
        let date = effective.as_str().ok_or_else(super::invalid)?;
        crate::employment::require_remuneration_date(date).map_err(|e| {
            InputError::user_facing_source(e.to_string(), "RemunerationProfileError")
        })?;
        Some(date.to_owned())
    };
    // This is the original validateProfile(simpleSalaryProfileInput(...)) seam;
    // names/industry fallback and conflict-repair gate belong only to the lower
    // profile writer, not this dated employment normalization.
    let mut valid = super::normalize_profile_input_without_identity(raw, Some(current))?;
    valid["workPattern"] = raw
        .field("workPattern")
        .filter(|v| !v.is_null())
        .cloned()
        .unwrap_or_else(|| current["workPattern"].clone());
    let after = super::compatibility::employment_data(&valid)?;
    let baseline_input = if let Some(base) = validity
        .get("baseline")
        .filter(|value| crate::net::js_truthy(value))
    {
        crate::input::employment::validate_employment_data(base)?
    } else {
        super::compatibility::employment_data(current)?
    };
    let mut patch = super::changes(&baseline_input, &after)?;
    let fields = keys(validity.get("fields"))?;
    if let Some(fields) = &fields {
        if fields.iter().any(|key| after.get(key).is_none()) {
            return Err(
                InputError::validation("Die Änderung enthält unbekannte Profilfelder.").into(),
            );
        }
        patch.retain(|p| fields.contains(&p.key));
    }
    state.check_test()?;
    let now = crate::input::javascript_date::iso_from_epoch_milliseconds(epoch)?;
    let baseline = super::compatibility::employment_data(current)?;
    let mut entries = Vec::with_capacity(history.len() + 1);
    for item in history {
        let mut entry = item.clone();
        let mut employment = if let Some(value) = item
            .get("employment")
            .filter(|value| crate::net::js_truthy(value))
        {
            value.clone()
        } else {
            super::employment_with_remuneration(&baseline, &item["data"])?
        };
        employment["workPattern"] = item["employment"]
            .get("workPattern")
            .filter(|v| !v.is_null())
            .cloned()
            .unwrap_or_else(|| legacy.clone());
        entry["employment"] = employment;
        if !truthy(item.get("employment")) {
            entry["revision"] = plus_one(revision(&item["revision"])?)?;
            entry["updatedAt"] = json!(now);
        }
        entries.push(entry);
    }
    if !entries.iter().any(|item| item["effectiveFrom"].is_null()) {
        let data = serde_json::to_value(
            crate::remuneration::profile::remuneration_from_legacy(current)
                .map_err(InputError::from)?,
        )
        .map_err(|_| super::invalid())?;
        entries.insert(0,json!({"effectiveFrom":null,"employment":baseline,"data":data,"revision":1,"createdAt":stored["createdAt"],"updatedAt":stored["updatedAt"]}));
    }
    let resolved = crate::employment::resolve_remuneration_profile_ref(
        &entries,
        date.as_deref().unwrap_or("1900-01-01"),
    )
    .map_err(|e| InputError::user_facing_source(e.to_string(), "RemunerationProfileError"))?
    .profile
    .ok_or_else(super::invalid)?;
    let original = resolved["employment"].clone();
    let today = super::sql_state::date_at(current, epoch)?;
    let correction = keys(validity.get("correctionFields"))?;
    let whole = date.is_none() && correction.as_ref().is_some_and(|fields| !fields.is_empty());
    let override_fields = if whole {
        correction.clone().unwrap_or_default()
    } else {
        vec![]
    };
    if let Some(fields) = &correction {
        if fields.iter().any(|key| baseline.get(key).is_none()) {
            return Err(
                InputError::validation("Die Korrektur enthält unbekannte Profilfelder.").into(),
            );
        }
        patch = super::changes(&original, &after)?;
        patch.retain(|p| fields.contains(&p.key));
    }
    if whole {
        let sources = std::iter::once(&original).chain(
            entries
                .iter()
                .filter(|item| {
                    item["effectiveFrom"]
                        .as_str()
                        .is_some_and(|date| date <= today.as_str())
                })
                .map(|item| &item["employment"]),
        );
        let mut all: Vec<EmploymentPatch> = vec![];
        for before in sources {
            for p in super::changes(before, &after)?
                .into_iter()
                .filter(|p| override_fields.contains(&p.key))
            {
                if let Some(index) = all
                    .iter()
                    .position(|old| old.key == p.key && old.child == p.child)
                {
                    all[index] = p
                } else {
                    all.push(p)
                }
            }
        }
        patch = all;
    }
    let declared = date.is_some()
        && validity["declarePeriod"] == true
        && fields.as_ref().is_some_and(|f| !f.is_empty());
    if declared && patch.is_empty() {
        patch = super::changes(&original, &after)?;
        patch.retain(|p| {
            fields
                .as_ref()
                .is_some_and(|fields| fields.contains(&p.key))
        });
    }
    if patch.is_empty() && !whole && !declared {
        return Ok(std::sync::Arc::new(current.clone()));
    }
    let at = entries
        .iter()
        .find(|item| item["effectiveFrom"].as_str() == date.as_deref());
    let updated = super::apply(&original, &patch)?;
    if !whole && !declared && super::patch::same(Some(&updated), Some(&original))? {
        return Ok(std::sync::Arc::new(current.clone()));
    }
    let mut next = json!({"effectiveFrom":date});
    if let Some(overrides) = overrides(resolved, &override_fields, &today)? {
        next["employmentOverrides"] = overrides;
    }
    next["employment"] = updated.clone();
    next["data"] = super::financial_data(Some(resolved), &merged(current, &updated)?)?;
    next["revision"] = plus_one(
        at.map(|item| revision(&item["revision"]))
            .transpose()?
            .unwrap_or(0),
    )?;
    next["createdAt"] = at
        .map(|item| item["createdAt"].clone())
        .unwrap_or_else(|| json!(now));
    next["updatedAt"] = json!(now);
    let mut active = patch;
    let mut previous = original;
    let mut future = entries
        .iter()
        .enumerate()
        .filter(|(_, item)| {
            item["effectiveFrom"]
                .as_str()
                .is_some_and(|from| date.as_ref().is_none_or(|date| from > date.as_str()))
        })
        .map(|(index, item)| (index, item["effectiveFrom"].as_str().unwrap().to_owned()))
        .collect::<Vec<_>>();
    future.sort_by(|a, b| a.1.cmp(&b.1));
    for (index, from) in future {
        let item = entries[index].clone();
        let original_future = item["employment"].clone();
        if !whole || from > today {
            let mut filtered = Vec::with_capacity(active.len());
            for p in active {
                if super::patch::same(
                    super::field(&original_future, &p),
                    super::field(&previous, &p),
                )? {
                    filtered.push(p)
                }
            }
            active = filtered;
        }
        if !active.is_empty() || whole {
            let updated = super::apply(&original_future, &active)?;
            let mut replacement = item.clone();
            if let Some(overrides) = overrides(&item, &override_fields, &today)? {
                replacement["employmentOverrides"] = overrides;
            }
            replacement["employment"] = updated.clone();
            replacement["data"] = super::financial_data(Some(&item), &merged(current, &updated)?)?;
            replacement["revision"] = plus_one(revision(&item["revision"])?)?;
            replacement["updatedAt"] = json!(now);
            entries[index] = replacement;
        }
        previous = original_future;
    }
    if let Some(index) = entries
        .iter()
        .position(|item| item["effectiveFrom"].as_str() == date.as_deref())
    {
        entries[index] = next
    } else {
        entries.push(next)
    }
    for item in &entries {
        state.write_history(item)?;
    }
    if crate::net::js_truthy(&current["salaryBasisConflict"])
        && date.as_ref().is_some_and(|date| date > &today)
    {
        return Err(InputError::validation(
            "Bitte zuerst eine aktuell gültige Gehaltsgrundlage wählen.",
        )
        .into());
    }
    let mut projected = current.clone();
    projected
        .as_object_mut()
        .ok_or_else(super::invalid)?
        .remove("salaryBasisConflict");
    projected["employmentTimeline"] = json!(entries);
    projected = crate::employment::employment_profile_at(&projected, &today)
        .map_err(|e| InputError::user_facing_source(e.to_string(), "RemunerationProfileError"))?;
    let saved = state.write_profile(&projected, epoch)?;
    let mut result = saved.as_ref().clone();
    result["employmentTimeline"] = json!(state.profiles()?.as_ref());
    crate::employment::employment_profile_at(&result, &today)
        .map(std::sync::Arc::new)
        .map_err(|e| {
            InputError::user_facing_source(e.to_string(), "RemunerationProfileError").into()
        })
}
