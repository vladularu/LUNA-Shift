//! Small money inputs and lossless, Arc-backed source metadata. Time/credit
//! engines continue to consume the separate original target-capable profile.
use super::{EmploymentError, employment_overlay_at};
use serde::{Serialize, ser::SerializeMap};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    sync::{
        Arc, OnceLock,
        atomic::{AtomicUsize, Ordering},
    },
};

/// Source-exact effective fields without copying target-capable profiles.
/// An explicit null in the dated overlay shadows the original field.
#[derive(Clone, Copy)]
pub struct EmploymentProfileRef<'a> {
    original: &'a Value,
    overlay: Option<&'a Value>,
}
impl<'a> EmploymentProfileRef<'a> {
    pub fn at(original: &'a Value, date: &str) -> Result<Self, EmploymentError> {
        Ok(Self {
            original,
            overlay: employment_overlay_at(original, date)?,
        })
    }
    pub fn get(&self, key: &str) -> Option<&'a Value> {
        self.overlay
            .and_then(|overlay| overlay.get(key))
            .or_else(|| self.original.get(key))
    }
    pub fn original(&self) -> &'a Value {
        self.original
    }
    pub fn overlay(&self) -> Option<&'a Value> {
        self.overlay
    }
}

#[derive(Debug)]
pub struct FullEmploymentProfileView {
    original: Arc<Value>,
    overlay_index: Option<usize>,
    materialized: OnceLock<Value>,
    serializations: AtomicUsize,
}
impl FullEmploymentProfileView {
    fn overlay(&self) -> Option<&serde_json::Map<String, Value>> {
        self.overlay_index
            .and_then(|index| self.original["employmentTimeline"][index]["employment"].as_object())
    }
    /// Explicit compatibility access only. Streaming serialization does not
    /// materialize a merged Value, even for an overlaid target-rich profile.
    pub fn full_value(&self) -> &Value {
        let Some(overlay) = self.overlay() else {
            return &self.original;
        };
        self.materialized.get_or_init(|| {
            let mut value = self.original.as_ref().clone();
            value
                .as_object_mut()
                .expect("validated original profile")
                .extend(
                    overlay
                        .iter()
                        .map(|(key, value)| (key.clone(), value.clone())),
                );
            value
        })
    }
    pub fn is_materialized(&self) -> bool {
        self.materialized.get().is_some()
    }
    pub fn original(&self) -> &Arc<Value> {
        &self.original
    }
}
impl Serialize for FullEmploymentProfileView {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.serializations.fetch_add(1, Ordering::Relaxed);
        let original = self
            .original
            .as_object()
            .expect("validated original profile");
        let overlay = self.overlay();
        let additional = overlay.map_or(0, |overlay| {
            overlay
                .keys()
                .filter(|key| !original.contains_key(*key))
                .count()
        });
        let mut map = serializer.serialize_map(Some(original.len() + additional))?;
        for (key, value) in original {
            map.serialize_entry(
                key,
                overlay
                    .and_then(|overlay| overlay.get(key))
                    .unwrap_or(value),
            )?;
        }
        if let Some(overlay) = overlay {
            for (key, value) in overlay {
                if !original.contains_key(key) {
                    map.serialize_entry(key, value)?;
                }
            }
        }
        map.end()
    }
}

#[derive(Debug, Clone)]
pub struct EmploymentProfileView {
    pub calculation: Arc<Value>,
    pub serialization: Arc<FullEmploymentProfileView>,
}
pub struct CalculationProfileStore {
    original: Arc<Value>,
    base: Arc<Value>,
    views: BTreeMap<Option<usize>, EmploymentProfileView>,
}
impl CalculationProfileStore {
    pub fn new(original: Arc<Value>) -> Result<Self, EmploymentError> {
        let object = original.as_object().ok_or(EmploymentError::InvalidInput)?;
        let base = if object.contains_key("workingTimeTarget") {
            Arc::new(Value::Object(
                object
                    .iter()
                    .filter(|(key, _)| key.as_str() != "workingTimeTarget")
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect(),
            ))
        } else {
            Arc::clone(&original)
        };
        Ok(Self {
            original,
            base,
            views: BTreeMap::new(),
        })
    }
    pub fn base(&self) -> &Arc<Value> {
        &self.base
    }
    pub fn at(&mut self, date: &str) -> Result<EmploymentProfileView, EmploymentError> {
        let overlay = employment_overlay_at(&self.original, date)?;
        let index = match overlay {
            None => None,
            Some(overlay) => Some(
                self.original["employmentTimeline"]
                    .as_array()
                    .ok_or(EmploymentError::InvalidInput)?
                    .iter()
                    .position(|row| {
                        row.get("employment")
                            .is_some_and(|value| std::ptr::eq(value, overlay))
                    })
                    .ok_or(EmploymentError::InvalidInput)?,
            ),
        };
        if let Some(view) = self.views.get(&index) {
            return Ok(view.clone());
        }
        let calculation = if let Some(overlay) = overlay {
            let mut value = self.base.as_ref().clone();
            value
                .as_object_mut()
                .ok_or(EmploymentError::InvalidInput)?
                .extend(
                    overlay
                        .as_object()
                        .ok_or(EmploymentError::InvalidInput)?
                        .iter()
                        .filter(|(key, _)| key.as_str() != "workingTimeTarget")
                        .map(|(key, value)| (key.clone(), value.clone())),
                );
            Arc::new(value)
        } else {
            Arc::clone(&self.base)
        };
        let view = EmploymentProfileView {
            calculation,
            serialization: Arc::new(FullEmploymentProfileView {
                original: Arc::clone(&self.original),
                overlay_index: index,
                materialized: OnceLock::new(),
                serializations: AtomicUsize::new(0),
            }),
        };
        self.views.insert(index, view.clone());
        Ok(view)
    }
    pub fn diagnostics(&self) -> Value {
        serde_json::json!({"compactProfileViews":self.views.len(),"fullProfileMaterializations":self.views.values().filter(|view|view.serialization.is_materialized()).count(),"fullProfileSerializations":self.views.values().map(|view|view.serialization.serializations.load(Ordering::Relaxed)).sum::<usize>(),"targetContextRetainedByArc":true})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn borrowed_effective_fields_keep_null_missing_and_original_target_owner() {
        let original = json!({"timeZone":"Europe/Berlin","weeklyMinutes":2340,
            "workingTimeTarget":{"days":vec![json!({"minutes":480});50_000]},
            "employmentTimeline":[{"effectiveFrom":"2026-01-01","revision":1,
                "data":{"version":1,"weeklyMinutes":2340,"selection":{"kind":"unconfigured"}},
                "employment":{"weeklyMinutes":null}}]});
        let view = EmploymentProfileRef::at(&original, "2026-02-01").unwrap();
        assert_eq!(view.get("weeklyMinutes"), Some(&Value::Null));
        assert_eq!(view.get("timeZone"), Some(&json!("Europe/Berlin")));
        assert!(view.get("absent").is_none());
        assert!(std::ptr::eq(
            view.get("workingTimeTarget").unwrap(),
            &original["workingTimeTarget"]
        ));
        assert!(std::ptr::eq(view.original(), &original));
        assert!(std::ptr::eq(
            view.overlay().unwrap(),
            &original["employmentTimeline"][0]["employment"]
        ));
    }
    #[test]
    fn large_target_context_is_shared_and_full_metadata_is_streamed_only_on_request() {
        let facts: Vec<Value> = (0..50_000)
            .map(|index| json!({"date":"2026-01-01","id":index,"minutes":480}))
            .collect();
        let profile = Arc::new(
            json!({"tariff":null,"weeklyMinutes":2310,"workingTimeTarget":{"facts":facts},"employmentTimeline":[{"effectiveFrom":"2026-07-01","employment":{"weeklyMinutes":1200,"tariff":null}}]}),
        );
        let mut store = CalculationProfileStore::new(Arc::clone(&profile)).unwrap();
        let first = store.at("2026-07-01").unwrap();
        let next = store.at("2026-12-31").unwrap();
        assert!(Arc::ptr_eq(&first.calculation, &next.calculation));
        assert!(Arc::ptr_eq(first.serialization.original(), &profile));
        assert!(first.calculation.get("workingTimeTarget").is_none());
        assert!(!first.serialization.is_materialized());
        let full = serde_json::to_value(first.serialization.as_ref()).unwrap();
        assert_eq!(
            full,
            super::super::employment_profile_at(&profile, "2026-07-01").unwrap()
        );
        assert!(
            !first.serialization.is_materialized(),
            "streaming must not clone the target-rich profile into a merged Value"
        );
        assert_eq!(
            full["workingTimeTarget"]["facts"].as_array().unwrap().len(),
            50_000
        );
        assert_eq!(
            first.calculation["tariff"],
            Value::Null,
            "explicit null is an override"
        );
        assert_eq!(store.diagnostics()["compactProfileViews"], 1);
    }
}
