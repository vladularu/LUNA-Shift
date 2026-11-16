use super::cache::CacheRecord;
use serde::{Serialize, Serializer, ser::SerializeSeq};
use serde_json::Value;
use std::sync::Arc;

#[derive(Clone)]
pub(super) enum Source {
    Raw(Arc<Vec<Value>>),
    Records(Arc<Vec<Arc<CacheRecord>>>),
}
pub(super) enum Cached<'a> {
    Raw(&'a Value),
    Record(&'a CacheRecord),
}
impl<'a> Cached<'a> {
    pub(super) fn get(&self, key: &str) -> Option<&'a Value> {
        match self {
            Self::Raw(value) => (*value).get(key),
            Self::Record(value) => value.get(key),
        }
    }
}
impl Source {
    pub(super) fn len(&self) -> usize {
        match self {
            Self::Raw(values) => values.len(),
            Self::Records(values) => values.len(),
        }
    }
    pub(super) fn get(&self, index: usize) -> Option<Cached<'_>> {
        match self {
            Self::Raw(values) => values.get(index).map(Cached::Raw),
            Self::Records(values) => values
                .get(index)
                .map(|value| Cached::Record(value.as_ref())),
        }
    }
}
impl Serialize for Source {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Raw(values) => values.as_ref().serialize(serializer),
            Self::Records(values) => {
                let mut sequence = serializer.serialize_seq(Some(values.len()))?;
                for value in values.iter() {
                    sequence.serialize_element(value.as_ref())?;
                }
                sequence.end()
            }
        }
    }
}
