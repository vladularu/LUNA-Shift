use crate::input::InputError;
use serde::Serialize;
use serde_json::Value;
#[derive(Debug, Clone, Serialize)]
pub struct EmploymentPatch {
    pub(crate) key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) child: Option<String>,
    pub(crate) value: Value,
}
pub(super) fn same(a: Option<&Value>, b: Option<&Value>) -> Result<bool, InputError> {
    let stringify = |value: Option<&Value>| {
        value
            .map(crate::input::javascript_json::stringify)
            .transpose()
            .map_err(|_| super::invalid())
    };
    Ok(stringify(a)? == stringify(b)?)
}
pub fn changes(before: &Value, after: &Value) -> Result<Vec<EmploymentPatch>, InputError> {
    let family = |value: &Value| {
        super::SALARY_KEYS
            .iter()
            .find(|key| value.get(**key).is_some_and(|value| !value.is_null()))
            .copied()
    };
    let changed_family = family(before) != family(after);
    let after = after.as_object().ok_or_else(super::invalid)?;
    let mut patches = vec![];
    for (key, value) in after {
        let old = before.get(key);
        if changed_family && super::SALARY_KEYS.contains(&key.as_str()) {
            patches.push(EmploymentPatch {
                key: key.clone(),
                child: None,
                value: value.clone(),
            });
            continue;
        }
        if same(old, Some(value))? {
            continue;
        }
        if let (Some(old), Some(next)) = (old.and_then(Value::as_object), value.as_object()) {
            for (child, value) in next {
                if !same(old.get(child), Some(value))? {
                    patches.push(EmploymentPatch {
                        key: key.clone(),
                        child: Some(child.clone()),
                        value: value.clone(),
                    });
                }
            }
        } else {
            patches.push(EmploymentPatch {
                key: key.clone(),
                child: None,
                value: value.clone(),
            });
        }
    }
    Ok(patches)
}
pub fn field<'a>(data: &'a Value, patch: &EmploymentPatch) -> Option<&'a Value> {
    let value = data.get(&patch.key)?;
    match &patch.child {
        Some(child) => value.get(child),
        None => Some(value),
    }
}
pub fn apply(data: &Value, patch: &[EmploymentPatch]) -> Result<Value, InputError> {
    let mut next = data.as_object().ok_or_else(super::invalid)?.clone();
    for patch in patch {
        let value = if let Some(child) = &patch.child {
            let mut object = next
                .get(&patch.key)
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            object.insert(child.clone(), patch.value.clone());
            Value::Object(object)
        } else {
            patch.value.clone()
        };
        next.insert(patch.key.clone(), value);
    }
    super::compatibility::employment_data(&Value::Object(next))
}
