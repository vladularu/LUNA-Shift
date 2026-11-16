//! Offline Draft2020-12 validity and source-compatible AJV issue projection.
//! The exact authoritative schemas are embedded, not a hand-selected field list.
use super::{ValidationError, ValidationIssue};
use jsonschema::{Draft, Validator};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::OnceLock};

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SchemaKind {
    Manifest,
    Package,
    Publication,
    Production,
}
struct CompiledSchema {
    source: Value,
    validator: Validator,
    patterns: BTreeMap<String, Validator>,
}
static SCHEMAS: OnceLock<Result<[CompiledSchema; 4], ValidationError>> = OnceLock::new();
fn compile(value: &Value) -> Result<Validator, ValidationError> {
    jsonschema::options()
        .with_draft(Draft::Draft202012)
        .should_validate_formats(false)
        .offline()
        .build(value)
        .map_err(|_| ValidationError::InvalidSchema)
}
fn collect_patterns(
    value: &Value,
    patterns: &mut BTreeMap<String, Validator>,
) -> Result<(), ValidationError> {
    match value {
        Value::Object(map) => {
            if let Some(pattern) = map.get("pattern").and_then(Value::as_str)
                && !patterns.contains_key(pattern)
            {
                patterns.insert(
                    pattern.to_owned(),
                    compile(&json!({"type":"string","pattern":pattern}))?,
                );
            }
            for child in map.values() {
                collect_patterns(child, patterns)?;
            }
        }
        Value::Array(values) => {
            for child in values {
                collect_patterns(child, patterns)?;
            }
        }
        _ => {}
    }
    Ok(())
}
fn schemas() -> Result<&'static [CompiledSchema; 4], ValidationError> {
    SCHEMAS
        .get_or_init(|| {
            let sources = [
                include_str!("../../../../../../rules/schema/manifest.schema.json"),
                include_str!("../../../../../../rules/schema/rule-package.schema.json"),
                include_str!("../../../../../../rules/schema/publication-request.schema.json"),
                include_str!(
                    "../../../../../../rules/schema/production-channel-config.schema.json"
                ),
            ];
            let mut result = Vec::new();
            for raw in sources {
                let source: Value =
                    serde_json::from_str(raw).map_err(|_| ValidationError::InvalidSchema)?;
                let validator = compile(&source)?;
                let mut patterns = BTreeMap::new();
                collect_patterns(&source, &mut patterns)?;
                result.push(CompiledSchema {
                    source,
                    validator,
                    patterns,
                });
            }
            result
                .try_into()
                .map_err(|_| ValidationError::InvalidSchema)
        })
        .as_ref()
        .map_err(|error| *error)
}
fn index(kind: SchemaKind) -> usize {
    match kind {
        SchemaKind::Manifest => 0,
        SchemaKind::Package => 1,
        SchemaKind::Publication => 2,
        SchemaKind::Production => 3,
    }
}
fn push(issues: &mut Vec<ValidationIssue>, keyword: &str, path: &str, message: String) {
    issues.push(ValidationIssue {
        code: format!("SCHEMA_{}", keyword.to_uppercase()),
        path: if path.is_empty() {
            "/".to_owned()
        } else {
            path.to_owned()
        },
        message,
    });
}
fn field_path(path: &str, key: &str) -> String {
    format!("{path}/{}", key.replace('~', "~0").replace('/', "~1"))
}
fn matches_type(value: &Value, kind: &str) -> bool {
    match kind {
        "null" => value.is_null(),
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "boolean" => value.is_boolean(),
        "number" => value.is_number(),
        "integer" => value
            .as_f64()
            .is_some_and(|n| n.is_finite() && n.fract() == 0.0),
        _ => false,
    }
}
fn equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| equal(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(key, a)| b.get(key).is_some_and(|b| equal(a, b)))
        }
        _ => a == b,
    }
}
fn check_type(
    object: &serde_json::Map<String, Value>,
    value: &Value,
    path: &str,
    issues: &mut Vec<ValidationIssue>,
) -> Result<(), ValidationError> {
    if let Some(kind) = object.get("type") {
        let (valid, label) = if let Some(k) = kind.as_str() {
            (matches_type(value, k), k.to_owned())
        } else {
            let kinds = kind.as_array().ok_or(ValidationError::InvalidSchema)?;
            (
                kinds
                    .iter()
                    .any(|k| k.as_str().is_some_and(|k| matches_type(value, k))),
                kinds
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(","),
            )
        };
        if !valid {
            push(issues, "type", path, format!("must be {label}"));
        }
    }
    Ok(())
}
fn walk(
    compiled: &CompiledSchema,
    schema: &Value,
    value: &Value,
    path: &str,
    issues: &mut Vec<ValidationIssue>,
) -> Result<(), ValidationError> {
    if schema == &Value::Bool(true) {
        return Ok(());
    }
    if schema == &Value::Bool(false) {
        push(
            issues,
            "false schema",
            path,
            "boolean schema is false".into(),
        );
        return Ok(());
    }
    let object = schema.as_object().ok_or(ValidationError::InvalidSchema)?;
    let delayed_type =
        object.contains_key("oneOf") || object.contains_key("allOf") || object.contains_key("if");
    if !delayed_type {
        check_type(object, value, path, issues)?;
    }
    if let Some(reference) = object.get("$ref").and_then(Value::as_str) {
        let target = compiled
            .source
            .pointer(
                reference
                    .strip_prefix('#')
                    .ok_or(ValidationError::InvalidSchema)?,
            )
            .ok_or(ValidationError::InvalidSchema)?;
        walk(compiled, target, value, path, issues)?;
    }
    if let Some(expected) = object.get("const")
        && !equal(value, expected)
    {
        push(issues, "const", path, "must be equal to constant".into());
    }
    if let Some(choices) = object.get("enum").and_then(Value::as_array)
        && !choices.iter().any(|v| equal(v, value))
    {
        push(
            issues,
            "enum",
            path,
            "must be equal to one of the allowed values".into(),
        );
    }
    if let Some(children) = object.get("allOf").and_then(Value::as_array) {
        for child in children {
            walk(compiled, child, value, path, issues)?;
        }
    }
    if let Some(children) = object.get("oneOf").and_then(Value::as_array) {
        let mut errors = Vec::new();
        let mut valid = 0;
        for child in children {
            let mut branch = Vec::new();
            walk(compiled, child, value, path, &mut branch)?;
            if branch.is_empty() {
                valid += 1;
            } else {
                errors.extend(branch);
            }
            if valid > 1 {
                break;
            }
        }
        if valid != 1 {
            if valid == 0 {
                issues.extend(errors);
            }
            push(
                issues,
                "oneOf",
                path,
                "must match exactly one schema in oneOf".into(),
            );
        }
    }
    if let Some(condition) = object.get("if") {
        let mut condition_issues = Vec::new();
        walk(compiled, condition, value, path, &mut condition_issues)?;
        let key = if condition_issues.is_empty() {
            "then"
        } else {
            "else"
        };
        if let Some(branch) = object.get(key) {
            let before = issues.len();
            walk(compiled, branch, value, path, issues)?;
            if issues.len() != before {
                push(issues, "if", path, format!("must match \"{key}\" schema"));
            }
        }
    }
    if delayed_type {
        check_type(object, value, path, issues)?;
    }
    if let Some(number) = value.as_f64() {
        for (keyword, phrase, compare) in [("maximum", "<=", true), ("minimum", ">=", false)] {
            if let Some(limit) = object.get(keyword) {
                let bound = limit.as_f64().ok_or(ValidationError::InvalidSchema)?;
                if (compare && number > bound) || (!compare && number < bound) {
                    push(issues, keyword, path, format!("must be {phrase} {limit}"));
                }
            }
        }
    }
    if let Some(text) = value.as_str() {
        let length = text.chars().count() as u64;
        for (keyword, phrase, greater) in
            [("maxLength", "more", true), ("minLength", "fewer", false)]
        {
            if let Some(limit) = object.get(keyword).and_then(Value::as_u64)
                && ((greater && length > limit) || (!greater && length < limit))
            {
                push(
                    issues,
                    keyword,
                    path,
                    format!("must NOT have {phrase} than {limit} characters"),
                );
            }
        }
        if let Some(pattern) = object.get("pattern").and_then(Value::as_str)
            && !compiled
                .patterns
                .get(pattern)
                .ok_or(ValidationError::InvalidSchema)?
                .is_valid(value)
        {
            push(
                issues,
                "pattern",
                path,
                format!("must match pattern \"{pattern}\""),
            );
        }
    }
    if let Some(values) = value.as_array() {
        for (keyword, phrase, greater) in [("maxItems", "more", true), ("minItems", "fewer", false)]
        {
            if let Some(limit) = object.get(keyword).and_then(Value::as_u64)
                && ((greater && values.len() as u64 > limit)
                    || (!greater && (values.len() as u64) < limit))
            {
                push(
                    issues,
                    keyword,
                    path,
                    format!("must NOT have {phrase} than {limit} items"),
                );
            }
        }
        if let Some(items) = object.get("items") {
            for (i, item) in values.iter().enumerate() {
                walk(compiled, items, item, &format!("{path}/{i}"), issues)?;
            }
        }
        if object.get("uniqueItems") == Some(&Value::Bool(true)) {
            let mut duplicate = None;
            // AJV uses its reverse hash walk only for a directly typed scalar
            // items schema; referenced/enumerated/object schemas use deep equality.
            let scalar_type = object
                .get("items")
                .and_then(|v| v.get("type"))
                .and_then(Value::as_str)
                .filter(|kind| !matches!(*kind, "object" | "array"));
            if let Some(kind) = scalar_type {
                'outer: for i in (0..values.len()).rev() {
                    if !matches_type(&values[i], kind) {
                        continue;
                    }
                    for j in (i + 1..values.len()).rev() {
                        if equal(&values[i], &values[j]) {
                            duplicate = Some((i, j));
                            break 'outer;
                        }
                    }
                }
            } else {
                'outer: for i in (1..values.len()).rev() {
                    for j in (0..i).rev() {
                        if equal(&values[i], &values[j]) {
                            duplicate = Some((i, j));
                            break 'outer;
                        }
                    }
                }
            }
            if let Some((i, j)) = duplicate {
                push(
                    issues,
                    "uniqueItems",
                    path,
                    format!("must NOT have duplicate items (items ## {j} and {i} are identical)"),
                );
            }
        }
    }
    if let Some(values) = value.as_object() {
        if let Some(required) = object.get("required").and_then(Value::as_array) {
            for key in required.iter().filter_map(Value::as_str) {
                if !values.contains_key(key) {
                    push(
                        issues,
                        "required",
                        path,
                        format!("must have required property '{key}'"),
                    );
                }
            }
        }
        let properties = object.get("properties").and_then(Value::as_object);
        if object.get("additionalProperties") == Some(&Value::Bool(false)) {
            for key in values.keys() {
                if !properties.is_some_and(|p| p.contains_key(key)) {
                    push(
                        issues,
                        "additionalProperties",
                        path,
                        "must NOT have additional properties".into(),
                    );
                }
            }
        }
        if let Some(properties) = properties {
            for (key, child) in properties {
                if let Some(value) = values.get(key) {
                    walk(compiled, child, value, &field_path(path, key), issues)?;
                }
            }
        }
    }
    Ok(())
}
pub fn validate_schema(
    kind: SchemaKind,
    value: &Value,
) -> Result<Vec<ValidationIssue>, ValidationError> {
    let schema = &schemas()?[index(kind)];
    if schema.validator.is_valid(value) {
        return Ok(vec![]);
    }
    let mut issues = Vec::new();
    walk(schema, &schema.source, value, "", &mut issues)?;
    if issues.is_empty() {
        return Err(ValidationError::DiagnosticMismatch);
    }
    Ok(issues)
}
