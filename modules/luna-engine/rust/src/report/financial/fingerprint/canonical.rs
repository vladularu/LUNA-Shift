//! Financial V1 semantic encoding, independent of the existing wire JSON digest.
//! Types and lengths are framed; objects sort UTF-8 keys, arrays keep source order.
use super::FinancialError;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
pub(crate) struct CanonicalHash {
    hash: Sha256,
    pub visits: usize,
}
impl CanonicalHash {
    pub fn new(domain: &str) -> Self {
        let mut hash = Self {
            hash: Sha256::new(),
            visits: 0,
        };
        hash.string(domain);
        hash
    }
    fn tag(&mut self, tag: u8) {
        self.hash.update([tag]);
    }
    fn length(&mut self, n: usize) {
        self.hash.update((n as u64).to_be_bytes());
    }
    pub fn string(&mut self, s: &str) {
        self.tag(b's');
        self.length(s.len());
        self.hash.update(s.as_bytes());
    }
    pub fn bytes(&mut self, b: &[u8]) {
        self.tag(b'b');
        self.length(b.len());
        self.hash.update(b);
    }
    pub fn array(&mut self, len: usize) {
        self.tag(b'a');
        self.length(len);
    }
    pub fn object(&mut self, len: usize) {
        self.tag(b'o');
        self.length(len);
    }
    pub fn boolean(&mut self, b: bool) {
        self.tag(if b { b't' } else { b'f' });
    }
    pub fn null(&mut self) {
        self.tag(b'z');
    }
    pub fn number(&mut self, n: f64) -> Result<(), FinancialError> {
        if !n.is_finite() {
            return Err(FinancialError::invalid(
                "Ungültiger numerischer Finanzschlüssel.",
            ));
        }
        self.tag(b'n');
        self.hash
            .update((if n == 0.0 { 0.0 } else { n }).to_bits().to_be_bytes());
        Ok(())
    }
    pub fn value(&mut self, v: &Value, omit_targets: bool) -> Result<(), FinancialError> {
        self.visits += 1;
        match v {
            Value::Null => self.null(),
            Value::Bool(b) => self.boolean(*b),
            Value::Number(n) => self.number(
                n.as_f64()
                    .ok_or_else(|| FinancialError::invalid("Ungültiger Finanzwert."))?,
            )?,
            Value::String(s) => self.string(s),
            Value::Array(a) => {
                self.array(a.len());
                for v in a {
                    self.value(v, omit_targets)?;
                }
            }
            Value::Object(o) => self.map(o, omit_targets)?,
        }
        Ok(())
    }
    pub fn map(
        &mut self,
        o: &Map<String, Value>,
        omit_targets: bool,
    ) -> Result<(), FinancialError> {
        let mut keys: Vec<_> = o
            .keys()
            .filter(|key| !omit_targets || key.as_str() != "workingTimeTarget")
            .collect();
        keys.sort_unstable();
        self.object(keys.len());
        for key in keys {
            self.string(key);
            self.value(&o[key], omit_targets)?;
        }
        Ok(())
    }
    pub fn finish(self) -> [u8; 32] {
        self.hash.finalize().into()
    }
}
pub(crate) fn value_digest(
    value: &Value,
    omit_targets: bool,
) -> Result<([u8; 32], usize), FinancialError> {
    let mut h = CanonicalHash::new("luna:financial:value:v1");
    h.value(value, omit_targets)?;
    let visits = h.visits;
    Ok((h.finish(), visits))
}
pub(crate) fn values_digest(
    values: &[Value],
    omit_targets: bool,
) -> Result<([u8; 32], usize), FinancialError> {
    let mut hash = CanonicalHash::new("luna:financial:value:v1");
    hash.visits += 1;
    hash.array(values.len());
    for value in values {
        hash.value(value, omit_targets)?;
    }
    let visits = hash.visits;
    Ok((hash.finish(), visits))
}
pub(crate) fn resolver_digest(
    resolver: &crate::rules::RuleResolver,
) -> Result<[u8; 32], FinancialError> {
    let source = resolver.financial_cache_source();
    let mut h = CanonicalHash::new("luna:financial:resolver:v1");
    h.array(7);
    for packages in [source.tariff, source.holiday] {
        h.array(packages.len());
        for p in packages {
            h.array(8);
            h.string(match p.kind {
                crate::rules::RuleKind::Tariff => "TARIFF",
                crate::rules::RuleKind::Holiday => "HOLIDAY",
                crate::rules::RuleKind::Legal => "LEGAL",
            });
            h.string(&p.package_id);
            h.string(&p.version_id);
            h.string(&p.valid_from);
            if let Some(to) = &p.valid_to {
                h.string(to);
            } else {
                h.null();
            }
            h.number(p.engine_contract_version as f64)?;
            h.value(p.rules(), false)?;
            h.map(p.financial_cache_metadata(), false)?;
        }
    }
    h.array(3);
    h.string(&source.package_ids.tariff);
    h.string(&source.package_ids.legal);
    h.string(&source.package_ids.holiday);
    h.array(source.historical.len());
    for item in source.historical {
        if let Some((before, id)) = item {
            h.array(2);
            h.string(before);
            h.string(id);
        } else {
            h.null();
        }
    }
    h.object(source.collation_ranks.len());
    for (key, rank) in source.collation_ranks {
        h.string(key);
        h.number(*rank as f64)?;
    }
    h.boolean(source.compiled_bundled_origin);
    h.string("tariff+holiday+effective-history");
    Ok(h.finish())
}
