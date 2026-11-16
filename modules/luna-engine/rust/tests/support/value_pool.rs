//! Frozen-test-fixture storage only. No runtime/ABI code consumes this encoding.
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
pub fn decode(raw: &str) -> Value {
    let source: Value = serde_json::from_str(raw).expect("pooled source fixture");
    assert_eq!(source["encoding"], "LUNA_JSON_VALUE_POOL_V1");
    assert_eq!(source["schemaVersion"], 2);
    let nodes = source["values"].as_array().expect("value nodes");
    let mut values: Vec<Value> = Vec::with_capacity(nodes.len());
    for node in nodes {
        let node = node.as_str().expect("tagged fixture node");
        let tag = node.as_bytes()[0];
        let payload = &node[1..];
        let get = |reference: &str| {
            let index = usize::from_str_radix(reference, 36).expect("base36 fixture ref");
            values
                .get(index)
                .expect("references must be earlier nodes")
                .clone()
        };
        let value = match tag {
            b'z' => Value::Null,
            b't' => Value::Bool(true),
            b'f' => Value::Bool(false),
            b's' => Value::String(payload.to_owned()),
            b'n' => {
                let n: Value = serde_json::from_str(payload).expect("JSON numeric literal");
                assert!(n.is_number());
                n
            }
            b'a' => Value::Array(if payload.is_empty() {
                vec![]
            } else {
                payload.split(',').map(get).collect()
            }),
            b'o' => {
                let mut object = Map::new();
                if !payload.is_empty() {
                    for pair in payload.split(',') {
                        let (k, v) = pair.split_once('.').expect("object key/ref pair");
                        let key = get(k).as_str().expect("string object key").to_owned();
                        assert!(
                            object.insert(key, get(v)).is_none(),
                            "duplicate encoded key"
                        );
                    }
                }
                Value::Object(object)
            }
            _ => panic!("unknown fixture tag"),
        };
        values.push(value);
    }
    assert_eq!(source["root"].as_u64().unwrap() as usize, values.len() - 1);
    let decoded = values.pop().unwrap();
    let hash = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&decoded).unwrap())
    );
    assert_eq!(
        hash,
        source["canonicalExpandedSha256"].as_str().unwrap(),
        "lossless expanded original source hash"
    );
    assert_eq!(
        decoded["cases"].as_array().unwrap().len() as u64,
        source["caseCount"].as_u64().unwrap()
    );
    decoded
}
