use serde_json::{Value, json};
pub fn edited(mut value: Value, edits: &[Value]) -> Value {
    for edit in edits {
        let pointer = edit["path"].as_str().unwrap();
        if pointer.is_empty() {
            value = edit["value"].clone();
            continue;
        }
        let (parent, key) = pointer.rsplit_once('/').unwrap();
        let key = key.replace("~1", "/").replace("~0", "~");
        if edit["op"] == "delete" {
            value
                .pointer_mut(parent)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .remove(&key);
        } else if let Some(slot) = value.pointer_mut(pointer) {
            *slot = edit["value"].clone();
        } else {
            value
                .pointer_mut(parent)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .insert(key, edit["value"].clone());
        }
    }
    value
}
pub fn expected(data: &Value, case: &Value) -> Value {
    let issues: Vec<_> = data["results"][case["expectedResult"].as_u64().unwrap() as usize]
        .as_array()
        .unwrap()
        .iter()
        .map(|id| data["issues"][id.as_u64().unwrap() as usize].clone())
        .collect();
    json!({"ok":issues.is_empty(),"issues":issues})
}
