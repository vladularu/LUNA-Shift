//! The v1 wire canonical form, serialized from borrowed values into SHA-256.
//! Number spellings deliberately retain the existing wire-hash contract.
use serde::{
    Serialize, Serializer,
    ser::{SerializeMap, SerializeSeq},
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::{self, Write};

pub(crate) struct Borrowed<'a>(pub &'a Value);
impl Serialize for Borrowed<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.0 {
            Value::Object(object) => {
                let mut fields = object.iter().collect::<Vec<_>>();
                fields.sort_unstable_by(|a, b| a.0.cmp(b.0));
                let mut output = serializer.serialize_map(Some(fields.len()))?;
                for (key, value) in fields {
                    output.serialize_entry(key, &Borrowed(value))?;
                }
                output.end()
            }
            Value::Array(values) => {
                let mut output = serializer.serialize_seq(Some(values.len()))?;
                for value in values {
                    output.serialize_element(&Borrowed(value))?;
                }
                output.end()
            }
            value => value.serialize(serializer),
        }
    }
}
pub(crate) struct HashWriter<'a>(pub &'a mut Sha256);
impl Write for HashWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.update(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::{CONTRACT_VERSION, SCHEMA_VERSION, canonical_value, content_digest};
    use serde_json::json;
    fn old_digest(domain: &[u8], value: &Value) -> String {
        let canonical = canonical_value(value);
        let bytes = serde_json::to_vec(&canonical).unwrap();
        let mut hasher = Sha256::new();
        hasher.update(domain);
        hasher.update(SCHEMA_VERSION.to_be_bytes());
        hasher.update(CONTRACT_VERSION.as_bytes());
        hasher.update([0]);
        hasher.update(bytes);
        format!("{:x}", hasher.finalize())
    }
    #[test]
    fn streaming_keeps_all_accepted_v1_hash_bytes_and_unicode_array_order() {
        let mut values = vec![
            json!(null),
            json!([]),
            json!({}),
            json!(false),
            json!({"z":[null,0,false,""],"a":{"李":"é","ä":"e\u{301}","quote":"\"\\\n\t"}}),
        ];
        for raw in [
            "0",
            "-0",
            "0.0",
            "-0.0",
            "1.0",
            "1e0",
            "1.25e25",
            "9007199254740991",
            "-9007199254740991",
        ] {
            values.push(serde_json::from_str(raw).unwrap());
        }
        values.push(json!((0..50_000).map(|i|json!({"date":format!("day-{i}"),"rosterStatus":"FINAL","disposition":"ROSTER_FREE"})).collect::<Vec<_>>()));
        for value in values {
            let serialized = serde_json::to_vec(&Borrowed(&value)).unwrap();
            assert_eq!(
                serialized,
                serde_json::to_vec(&canonical_value(&value)).unwrap()
            );
            for domain in [
                b"LUNA-CATALOG-V1\0".as_slice(),
                b"LUNA-SNAPSHOT-V1\0".as_slice(),
            ] {
                assert_eq!(
                    content_digest(domain, &value).unwrap(),
                    old_digest(domain, &value)
                );
            }
        }
        let left = json!({"a":1,"b":2});
        let right: Value = serde_json::from_str("{\"b\":2,\"a\":1}").unwrap();
        assert_eq!(
            content_digest(b"x", &left).unwrap(),
            content_digest(b"x", &right).unwrap()
        );
        assert_ne!(
            content_digest(b"x", &json!([1, 2])).unwrap(),
            content_digest(b"x", &json!([2, 1])).unwrap()
        );
    }
}
