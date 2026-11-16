//! Test fixture decoder retaining original JSON number tokens for the byte hash.
//! Numeric assertions still compare complete decoded values without tolerance.
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

fn index(reference: &str) -> usize {
    usize::from_str_radix(reference, 36).expect("base36 fixture ref")
}
fn hash_node(nodes: &[Value], at: usize, hash: &mut Sha256) {
    let node = nodes[at].as_str().unwrap();
    let payload = &node[1..];
    match node.as_bytes()[0] {
        b'z' => hash.update(b"null"),
        b't' => hash.update(b"true"),
        b'f' => hash.update(b"false"),
        b's' => hash.update(serde_json::to_vec(payload).unwrap()),
        b'n' => hash.update(payload.as_bytes()),
        b'a' => {
            hash.update(b"[");
            for (i, reference) in payload.split(',').filter(|s| !s.is_empty()).enumerate() {
                if i > 0 {
                    hash.update(b",");
                }
                hash_node(nodes, index(reference), hash);
            }
            hash.update(b"]");
        }
        b'o' => {
            hash.update(b"{");
            for (i, pair) in payload.split(',').filter(|s| !s.is_empty()).enumerate() {
                if i > 0 {
                    hash.update(b",");
                }
                let (k, v) = pair.split_once('.').unwrap();
                hash_node(nodes, index(k), hash);
                hash.update(b":");
                hash_node(nodes, index(v), hash);
            }
            hash.update(b"}");
        }
        _ => panic!("fixture tag"),
    }
}
pub fn decode(raw: &str) -> Value {
    let source: Value = serde_json::from_str(raw).unwrap();
    assert_eq!(source["encoding"], "LUNA_JSON_VALUE_POOL_V1");
    assert_eq!(source["schemaVersion"], 2);
    let nodes = source["values"].as_array().unwrap();
    let mut values: Vec<Value> = Vec::with_capacity(nodes.len());
    for node in nodes {
        let node = node.as_str().unwrap();
        let payload = &node[1..];
        let get = |reference: &str| {
            values
                .get(index(reference))
                .expect("earlier reference")
                .clone()
        };
        values.push(match node.as_bytes()[0] {
            b'z' => Value::Null,
            b't' => Value::Bool(true),
            b'f' => Value::Bool(false),
            b's' => Value::String(payload.to_owned()),
            b'n' => {
                let value: Value = serde_json::from_str(payload).unwrap();
                assert!(value.is_number());
                value
            }
            b'a' => Value::Array(
                payload
                    .split(',')
                    .filter(|s| !s.is_empty())
                    .map(get)
                    .collect(),
            ),
            b'o' => {
                let mut map = Map::new();
                for pair in payload.split(',').filter(|s| !s.is_empty()) {
                    let (k, v) = pair.split_once('.').unwrap();
                    assert!(
                        map.insert(get(k).as_str().unwrap().to_owned(), get(v))
                            .is_none()
                    );
                }
                Value::Object(map)
            }
            _ => panic!("fixture tag"),
        });
    }
    assert_eq!(source["root"].as_u64().unwrap() as usize, values.len() - 1);
    let mut hash = Sha256::new();
    hash_node(nodes, values.len() - 1, &mut hash);
    assert_eq!(
        format!("{:x}", hash.finalize()),
        source["canonicalExpandedSha256"].as_str().unwrap(),
        "unaltered original JS JSON tokens"
    );
    let decoded = values.pop().unwrap();
    assert_eq!(
        decoded["cases"].as_array().unwrap().len() as u64,
        source["caseCount"].as_u64().unwrap()
    );
    decoded
}
