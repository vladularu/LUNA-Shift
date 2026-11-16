//! Current-fenced platform ranks, decoded directly into their final native map.
//! Namespaces are compiled policy and are never supplied by a host request.
use crate::calendar::recurrence::CollationRanks;
use serde::de::{DeserializeSeed, Error, MapAccess, Visitor};
use serde::{Deserialize, Deserializer};
use sha2::{Digest, Sha256};
use std::{borrow::Cow, collections::BTreeMap, fmt, marker::PhantomData, sync::Arc};

pub(crate) enum Namespace {
    Financial,
    CalendarWindow,
    CalendarLoadedQuery,
    CalendarLoadedCompletion,
    ReportExport,
}
pub(crate) enum ParseError<E> {
    InputTooLarge,
    InvalidRanks,
    Fence(E),
}
pub(crate) struct ParsedRanks {
    pub ranks: Arc<CollationRanks>,
    pub digest: String,
    pub bytes: u64,
}
struct Key;
impl<'de> DeserializeSeed<'de> for Key {
    type Value = Cow<'de, str>;
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<Self::Value, D::Error> {
        struct Text;
        impl<'de> Visitor<'de> for Text {
            type Value = Cow<'de, str>;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("bounded comparison string")
            }
            fn visit_borrowed_str<E: Error>(self, s: &'de str) -> Result<Self::Value, E> {
                if s.len() > 300_000 {
                    Err(E::custom("rank key limit"))
                } else {
                    Ok(Cow::Borrowed(s))
                }
            }
            fn visit_str<E: Error>(self, s: &str) -> Result<Self::Value, E> {
                if s.len() > 300_000 {
                    Err(E::custom("rank key limit"))
                } else {
                    Ok(Cow::Owned(s.to_owned()))
                }
            }
            fn visit_string<E: Error>(self, s: String) -> Result<Self::Value, E> {
                if s.len() > 300_000 {
                    Err(E::custom("rank key limit"))
                } else {
                    Ok(Cow::Owned(s))
                }
            }
        }
        d.deserialize_str(Text)
    }
}
struct Ranks<'a, F, E> {
    strings: &'a [String],
    check: &'a F,
    error: PhantomData<E>,
}
impl<'de, F: Fn() -> Result<(), E>, E> DeserializeSeed<'de> for Ranks<'_, F, E> {
    type Value = BTreeMap<String, u32>;
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<Self::Value, D::Error> {
        d.deserialize_map(self)
    }
}
impl<'de, F: Fn() -> Result<(), E>, E> Visitor<'de> for Ranks<'_, F, E> {
    type Value = BTreeMap<String, u32>;
    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("complete native rank map")
    }
    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
        let mut ranks = BTreeMap::new();
        while let Some(key) = map.next_key_seed(Key)? {
            (self.check)().map_err(|_| M::Error::custom("stale rank map"))?;
            if self
                .strings
                .binary_search_by(|s| s.as_str().cmp(key.as_ref()))
                .is_err()
                || ranks.contains_key(key.as_ref())
            {
                return Err(M::Error::custom("rank membership"));
            }
            let raw = map.next_value_seed(NumberSeed)?;
            let rank = raw
                .as_f64()
                .filter(|n| {
                    n.is_finite() && *n >= 0.0 && n.fract() == 0.0 && *n < self.strings.len() as f64
                })
                .ok_or_else(|| M::Error::custom("rank integer"))? as u32;
            ranks.insert(key.into_owned(), rank);
        }
        if ranks.len() != self.strings.len() {
            return Err(M::Error::custom("incomplete ranks"));
        }
        Ok(ranks)
    }
}
struct NumberSeed;
impl<'de> DeserializeSeed<'de> for NumberSeed {
    type Value = serde_json::Number;
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<Self::Value, D::Error> {
        serde_json::Number::deserialize(d)
    }
}
fn field(hash: &mut Sha256, bytes: &[u8]) {
    hash.update((bytes.len() as u64).to_be_bytes());
    hash.update(bytes);
}
pub(crate) fn parse<E>(
    raw: &[u8],
    strings: &[String],
    namespace: Namespace,
    check: impl Fn() -> Result<(), E>,
) -> Result<ParsedRanks, ParseError<E>> {
    if raw.len() > crate::contract::financial_collation::MAX_RANK_BYTES {
        return Err(ParseError::InputTooLarge);
    }
    check().map_err(ParseError::Fence)?;
    let mut parser = serde_json::Deserializer::from_slice(raw);
    let ranks = Ranks {
        strings,
        check: &check,
        error: PhantomData,
    }
    .deserialize(&mut parser);
    check().map_err(ParseError::Fence)?;
    let ranks = ranks.map_err(|_| ParseError::InvalidRanks)?;
    parser.end().map_err(|_| ParseError::InvalidRanks)?;
    check().map_err(ParseError::Fence)?;
    let mut hash = Sha256::new();
    field(
        &mut hash,
        match namespace {
            Namespace::Financial => b"luna-financial-ranks-v1",
            Namespace::CalendarWindow => b"luna-calendar-window-ranks-v1",
            Namespace::CalendarLoadedQuery => b"luna-calendar-loaded-query-ranks-v1",
            Namespace::CalendarLoadedCompletion => b"luna-calendar-loaded-completion-ranks-v1",
            Namespace::ReportExport => b"luna-report-export-ranks-v1",
        },
    );
    for (key, rank) in &ranks {
        field(&mut hash, key.as_bytes());
        hash.update(rank.to_be_bytes());
    }
    let bytes = 4096
        + ranks
            .keys()
            .map(|key| key.capacity() as u64 + 16 + 128)
            .sum::<u64>();
    Ok(ParsedRanks {
        ranks: Arc::new(CollationRanks::from(ranks)),
        digest: format!("{:x}", hash.finalize()),
        bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    fn decode(raw: &[u8], strings: &[String]) -> Result<ParsedRanks, ParseError<()>> {
        parse(raw, strings, Namespace::Financial, || Ok(()))
    }
    #[test]
    fn exact_integral_lexemes_equality_and_existing_financial_digest_are_preserved() {
        let strings = vec!["a".into(), "b".into(), "é".into()];
        let parsed = decode(br#"{"a":-0.0,"b":1e0,"\u00e9":1.0}"#, &strings)
            .ok()
            .unwrap();
        assert_eq!(parsed.ranks.rank("a").unwrap(), 0);
        assert_eq!(
            parsed.ranks.rank("b").unwrap(),
            parsed.ranks.rank("é").unwrap()
        );
        assert_eq!(
            parsed.digest,
            "e8244bdb7d789a2ef3cbfea70c9fc842c6e4e5b47cb7594b6a037b8ab0bc0813"
        );
        assert!(decode(b"{}", &[]).is_ok());
        let export = parse(
            br#"{"a":-0.0,"b":1e0,"\u00e9":1.0}"#,
            &strings,
            Namespace::ReportExport,
            || Ok::<_, ()>(()),
        )
        .ok()
        .unwrap();
        assert_eq!(
            export.digest,
            "cc6d6bcf7de987fb11f84c6d83ab5b15fc3d91b58fb5b41a3dd55d2f41221300"
        );
        assert_ne!(export.digest, parsed.digest);
        let calendar = parse(
            br#"{"a":0,"b":1,"\u00e9":1}"#,
            &strings,
            Namespace::CalendarWindow,
            || Ok::<_, ()>(()),
        )
        .ok()
        .unwrap();
        assert_ne!(export.digest, calendar.digest);
        for raw in [
            br#"{"a":0,"b":1}"#.as_slice(),
            br#"{"a":0,"a":0,"b":1,"\u00e9":1}"#.as_slice(),
            br#"{"a":0,"\u0061":0,"b":1,"\u00e9":1}"#.as_slice(),
            br#"{"a":0,"b":1,"\u00e9":1,"foreign":0}"#.as_slice(),
            br#"{"a":0,"b":0.5,"\u00e9":1}"#.as_slice(),
            br#"{"a":0,"b":3,"\u00e9":1}"#.as_slice(),
            br#"{"a":0,"b":"1","\u00e9":1}"#.as_slice(),
            br#"{"a":0,"b":1,"\u00e9":1}{}"#.as_slice(),
        ] {
            assert!(matches!(
                decode(raw, &strings),
                Err(ParseError::InvalidRanks)
            ));
        }
    }
    #[test]
    fn fence_is_rechecked_during_and_after_raw_decoding() {
        let calls = Cell::new(0);
        let result = parse(
            br#"{"a":0,"b":1}"#,
            &["a".into(), "b".into()],
            Namespace::Financial,
            || {
                calls.set(calls.get() + 1);
                if calls.get() >= 3 {
                    Err("STALE_TEST_FENCE")
                } else {
                    Ok(())
                }
            },
        );
        assert!(matches!(result, Err(ParseError::Fence("STALE_TEST_FENCE"))));
        assert!(calls.get() >= 3);
    }
}
