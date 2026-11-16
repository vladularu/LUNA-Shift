//! Rule selection over an immutable, authenticated catalog snapshot.
//! Catalog download/signature verification belongs to the platform adapter;
//! selecting dates, historical defaults and calculation rules belongs here.
pub mod holidays;
pub mod profile_holidays;
pub mod validation;
pub mod validation_tariff;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::collections::BTreeSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RuleKind {
    Tariff,
    Legal,
    Holiday,
}

impl RuleKind {
    fn label(self) -> &'static str {
        match self {
            Self::Tariff => "TARIFF",
            Self::Legal => "LEGAL",
            Self::Holiday => "HOLIDAY",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageIds {
    pub tariff: String,
    pub legal: String,
    pub holiday: String,
}

impl PackageIds {
    fn get(&self, kind: RuleKind) -> &str {
        match kind {
            RuleKind::Tariff => &self.tariff,
            RuleKind::Legal => &self.legal,
            RuleKind::Holiday => &self.holiday,
        }
    }
}

/// The rule body stays lossless until its owning calculation module validates
/// and consumes it. This struct does not grant trust to downloaded JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RulePackage {
    pub kind: RuleKind,
    pub package_id: String,
    pub version_id: String,
    pub valid_from: String,
    pub valid_to: Option<String>,
    #[serde(deserialize_with = "deserialize_contract_version")]
    pub engine_contract_version: u32,
    #[serde(deserialize_with = "deserialize_rule_body")]
    rules: Value,
    #[serde(flatten)]
    metadata: serde_json::Map<String, Value>,
    #[serde(skip)]
    pub(crate) legacy_pay_rules: std::sync::OnceLock<
        Result<crate::pay::tariff::TariffRules, crate::pay::tariff::TariffError>,
    >,
    #[serde(skip)]
    pub(crate) validation: std::sync::OnceLock<validation::CachedPackageValidation>,
}

fn deserialize_contract_version<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<u32, D::Error> {
    let value = Value::deserialize(deserializer)?;
    value
        .as_f64()
        .filter(|n| n.is_finite() && n.fract() == 0.0 && *n >= 0.0 && *n <= u32::MAX as f64)
        .map(|n| n as u32)
        .ok_or_else(|| serde::de::Error::custom("Invalid rule contract version"))
}
fn normalize_integral_numbers(value: &mut Value) {
    match value {
        Value::Number(number) if number.is_f64() => {
            if let Some(n) = number.as_f64().filter(|n| {
                n.is_finite()
                    && n.fract() == 0.0
                    && n.abs() <= crate::money::MAX_SAFE_INTEGER as f64
            }) {
                *value = Value::from(n as i64);
            }
        }
        Value::Array(values) => {
            for value in values {
                normalize_integral_numbers(value);
            }
        }
        Value::Object(map) => {
            for value in map.values_mut() {
                normalize_integral_numbers(value);
            }
        }
        _ => {}
    }
}
fn deserialize_rule_body<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Value, D::Error> {
    let mut value = Value::deserialize(deserializer)?;
    normalize_integral_numbers(&mut value);
    Ok(value)
}

impl PartialEq for RulePackage {
    fn eq(&self, other: &Self) -> bool {
        self.kind == other.kind
            && self.package_id == other.package_id
            && self.version_id == other.version_id
            && self.valid_from == other.valid_from
            && self.valid_to == other.valid_to
            && self.engine_contract_version == other.engine_contract_version
            && self.rules == other.rules
            && self.metadata == other.metadata
    }
}

impl RulePackage {
    /// Immutable source metadata only; native cache hashing must omit runtime memoization.
    pub(crate) fn financial_cache_metadata(&self) -> &serde_json::Map<String, Value> {
        &self.metadata
    }
    pub fn rules(&self) -> &Value {
        &self.rules
    }
    pub fn label(&self) -> Option<&str> {
        self.metadata.get("label").and_then(Value::as_str)
    }
    pub fn status(&self) -> Option<&str> {
        self.metadata.get("status").and_then(Value::as_str)
    }
    pub fn sources(&self) -> Option<&Value> {
        self.metadata.get("sources")
    }
}

#[derive(Debug, Clone, Copy)]
pub struct SimpleTariffDataRef<'a> {
    pub tables: &'a Value,
    pub sources: Option<&'a Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RuleResolverCatalog {
    pub tariff: Vec<RulePackage>,
    pub legal: Vec<RulePackage>,
    pub holiday: Vec<RulePackage>,
}

impl RuleResolverCatalog {
    fn get(&self, kind: RuleKind) -> &[RulePackage] {
        match kind {
            RuleKind::Tariff => &self.tariff,
            RuleKind::Legal => &self.legal,
            RuleKind::Holiday => &self.holiday,
        }
    }
    fn get_mut(&mut self, kind: RuleKind) -> &mut Vec<RulePackage> {
        match kind {
            RuleKind::Tariff => &mut self.tariff,
            RuleKind::Legal => &mut self.legal,
            RuleKind::Holiday => &mut self.holiday,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalCatalog {
    pub catalog: RuleResolverCatalog,
    pub package_ids: PackageIds,
    pub compatible_package_ids: PackageIds,
    pub valid_before: PackageIds,
}

#[derive(Debug, Clone)]
struct HistoricalDefault {
    before_date: String,
    package_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleResolutionFailure {
    pub code: &'static str,
    pub kind: RuleKind,
    pub package_id: String,
    pub effective_date: String,
    pub message: String,
}

impl std::fmt::Display for RuleResolutionFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for RuleResolutionFailure {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatalogError {
    Malformed,
    TooLarge,
    Incompatible,
}

/// No mutable package access is exposed after construction.
#[derive(Debug, Clone)]
pub struct RuleResolver {
    catalog: RuleResolverCatalog,
    package_ids: PackageIds,
    history: [Option<HistoricalDefault>; 3],
    collation_ranks: BTreeMap<String, u32>,
    holiday_cache: std::sync::Arc<std::sync::Mutex<holidays::HolidayCache>>,
    compiled_bundled_origin: bool,
}

/// Borrowed monetary cache inputs. Selection, validation and origin policies stay
/// in RuleResolver; this exposes no mutable catalog or caller-supplied digest.
pub(crate) struct FinancialRuleCacheSource<'a> {
    pub tariff: &'a [RulePackage],
    pub holiday: &'a [RulePackage],
    pub package_ids: &'a PackageIds,
    pub historical: [Option<(&'a str, &'a str)>; 2],
    pub collation_ranks: &'a BTreeMap<String, u32>,
    pub compiled_bundled_origin: bool,
}

fn kind_index(kind: RuleKind) -> usize {
    match kind {
        RuleKind::Tariff => 0,
        RuleKind::Legal => 1,
        RuleKind::Holiday => 2,
    }
}
const KINDS: [RuleKind; 3] = [RuleKind::Tariff, RuleKind::Legal, RuleKind::Holiday];

/// Temporal's canonical ISO date syntax, including extended years. Keeping the
/// validation independent from the timezone library retains resolver behavior
/// even when a date is outside the app's supported report-year range.
pub fn is_valid_date(date: &str) -> bool {
    let b = date.as_bytes();
    let (year, at) = if b.len() == 10 && b[..4].iter().all(u8::is_ascii_digit) {
        (date[..4].parse::<i32>().ok(), 4)
    } else if b.len() == 13 && matches!(b[0], b'+' | b'-') && b[1..7].iter().all(u8::is_ascii_digit)
    {
        let year = date[..7].parse::<i32>().ok();
        if matches!(year, Some(0..=9999)) {
            return false;
        }
        (year, 7)
    } else {
        return false;
    };
    let Some(year) = year else {
        return false;
    };
    if b[at] != b'-'
        || b[at + 3] != b'-'
        || !b[at + 1..at + 3].iter().all(u8::is_ascii_digit)
        || !b[at + 4..].iter().all(u8::is_ascii_digit)
    {
        return false;
    }
    let Some(month) = date[at + 1..at + 3].parse::<u32>().ok() else {
        return false;
    };
    let Some(day) = date[at + 4..].parse::<u32>().ok() else {
        return false;
    };
    let leap = year.rem_euclid(4) == 0 && (year.rem_euclid(100) != 0 || year.rem_euclid(400) == 0);
    let max = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        _ => return false,
    };
    day > 0
        && day <= max
        && (year < 275760 || year == 275760 && (month, day) <= (9, 13))
        && year >= -271821
        && (year != -271821 || (month, day) >= (4, 19))
}

fn validate_catalog(catalog: &RuleResolverCatalog) -> Result<(), CatalogError> {
    for kind in KINDS {
        if catalog.get(kind).len() > 10_000 {
            return Err(CatalogError::TooLarge);
        }
        for p in catalog.get(kind) {
            if p.kind != kind
                || p.package_id.is_empty()
                || p.package_id.len() > 200
                || p.version_id.is_empty()
                || p.version_id.len() > 200
                || !is_valid_date(&p.valid_from)
                || p.valid_to
                    .as_deref()
                    .is_some_and(|v| !is_valid_date(v) || v < p.valid_from.as_str())
                || !p.rules.is_object()
            {
                return Err(CatalogError::Malformed);
            }
        }
    }
    Ok(())
}

fn package_key(p: &RulePackage) -> String {
    format!("{}/{}/{}", p.package_id, p.valid_from, p.version_id)
}

impl RuleResolver {
    pub(crate) fn financial_cache_source(&self) -> FinancialRuleCacheSource<'_> {
        FinancialRuleCacheSource {
            tariff: &self.catalog.tariff,
            holiday: &self.catalog.holiday,
            package_ids: &self.package_ids,
            historical: [0, 2].map(|index| {
                self.history[index]
                    .as_ref()
                    .map(|item| (item.before_date.as_str(), item.package_id.as_str()))
            }),
            collation_ranks: &self.collation_ranks,
            compiled_bundled_origin: self.compiled_bundled_origin,
        }
    }
    pub fn default_package_ids(&self) -> &PackageIds {
        &self.package_ids
    }
    pub fn validate_all_package_semantics(&self) -> Result<bool, validation::ValidationError> {
        for kind in KINDS {
            for package in self.catalog.get(kind) {
                if !validation::package_validation_issues(package)?.is_empty() {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }
    pub fn new(
        mut catalog: RuleResolverCatalog,
        package_ids: PackageIds,
        historical: Option<HistoricalCatalog>,
    ) -> Result<Self, CatalogError> {
        validate_catalog(&catalog)?;
        if let Some(ref h) = historical {
            validate_catalog(&h.catalog)?;
        }
        let mut history: [Option<HistoricalDefault>; 3] = [None, None, None];
        for kind in KINDS {
            let Some(ref h) = historical else {
                continue;
            };
            if package_ids.get(kind) != h.compatible_package_ids.get(kind) {
                continue;
            }
            let first_current = catalog
                .get(kind)
                .iter()
                .filter(|p| p.package_id == package_ids.get(kind))
                .map(|p| p.valid_from.as_str())
                .min();
            let Some(first_current) = first_current else {
                continue;
            };
            if !h
                .catalog
                .get(kind)
                .iter()
                .any(|p| p.package_id == h.package_ids.get(kind))
            {
                continue;
            }
            let selection = HistoricalDefault {
                before_date: first_current.min(h.valid_before.get(kind)).to_owned(),
                package_id: h.package_ids.get(kind).to_owned(),
            };
            let current = catalog.get_mut(kind);
            let keys: BTreeSet<String> = current.iter().map(package_key).collect();
            current.extend(
                h.catalog
                    .get(kind)
                    .iter()
                    .filter(|p| {
                        p.package_id == selection.package_id && !keys.contains(&package_key(p))
                    })
                    .cloned(),
            );
            current.sort_by_key(package_key);
            history[kind_index(kind)] = Some(selection);
        }
        Ok(Self {
            catalog,
            package_ids,
            history,
            collation_ranks: BTreeMap::new(),
            holiday_cache: Default::default(),
            compiled_bundled_origin: false,
        })
    }

    pub fn from_catalog_json(
        catalog: Value,
        package_ids: PackageIds,
        historical: Option<HistoricalCatalog>,
    ) -> Result<Self, CatalogError> {
        let catalog = serde_json::from_value(catalog).map_err(|_| CatalogError::Malformed)?;
        Self::new(catalog, package_ids, historical)
    }

    pub fn with_collation_ranks(mut self, ranks: BTreeMap<String, u32>) -> Self {
        self.collation_ranks = ranks;
        self.holiday_cache = Default::default();
        self
    }
    pub fn collation_rank(&self, text: &str) -> Option<u32> {
        self.collation_ranks.get(text).copied()
    }

    pub fn bundled() -> Result<Self, CatalogError> {
        let value: Value = serde_json::from_str(include_str!("bundled.json"))
            .map_err(|_| CatalogError::Malformed)?;
        let ids: PackageIds = serde_json::from_value(value["packageIds"].clone())
            .map_err(|_| CatalogError::Malformed)?;
        let ranks: BTreeMap<String, u32> = serde_json::from_value(value["collationRanks"].clone())
            .map_err(|_| CatalogError::Malformed)?;
        Self::from_catalog_json(value["catalog"].clone(), ids, None).map(|r| {
            let mut resolver = r.with_collation_ranks(ranks);
            resolver.compiled_bundled_origin = true;
            resolver
        })
    }
    pub fn is_bundled(&self) -> bool {
        self.compiled_bundled_origin
    }

    pub fn package_ids_from_manifest(manifest: &Value) -> Result<PackageIds, CatalogError> {
        let tracks = manifest
            .get("tracks")
            .and_then(Value::as_array)
            .ok_or(CatalogError::Malformed)?;
        let select = |kind: &str| {
            let mut matches = tracks
                .iter()
                .filter(|t| t.get("kind").and_then(Value::as_str) == Some(kind));
            let id = matches.next()?.get("packageId")?.as_str()?;
            if matches.next().is_some() {
                None
            } else {
                Some(id.to_owned())
            }
        };
        let tariff = if manifest.get("schemaVersion").and_then(Value::as_u64) == Some(2) {
            manifest
                .get("legacyTariffPackageId")
                .and_then(Value::as_str)
                .map(str::to_owned)
        } else {
            select("TARIFF")
        }
        .ok_or(CatalogError::Incompatible)?;
        if tracks
            .iter()
            .filter(|t| {
                t.get("kind").and_then(Value::as_str) == Some("TARIFF")
                    && t.get("packageId").and_then(Value::as_str) == Some(tariff.as_str())
            })
            .count()
            != 1
        {
            return Err(CatalogError::Incompatible);
        }
        Ok(PackageIds {
            tariff,
            legal: select("LEGAL").ok_or(CatalogError::Incompatible)?,
            holiday: select("HOLIDAY").ok_or(CatalogError::Incompatible)?,
        })
    }

    fn resolve(
        &self,
        kind: RuleKind,
        date: &str,
        requested: &str,
    ) -> Result<&RulePackage, RuleResolutionFailure> {
        let default = self.package_ids.get(kind);
        let selected = match &self.history[kind_index(kind)] {
            Some(h) if requested == default || requested == h.package_id => {
                if date < h.before_date.as_str() && is_valid_date(date) {
                    h.package_id.as_str()
                } else {
                    default
                }
            }
            _ => requested,
        };
        let failure = |code, message| RuleResolutionFailure {
            code,
            kind,
            package_id: selected.to_owned(),
            effective_date: date.to_owned(),
            message,
        };
        if !is_valid_date(date) {
            return Err(failure(
                "INVALID_EFFECTIVE_DATE",
                format!("Invalid effective date for {selected}: {date}."),
            ));
        }
        let mut matches = self.catalog.get(kind).iter().filter(|p| {
            p.package_id == selected
                && p.valid_from.as_str() <= date
                && p.valid_to.as_deref().is_none_or(|end| date <= end)
        });
        match (matches.next(), matches.next()) {
            (Some(p), None) => Ok(p),
            (None, _) => Err(failure(
                "RULE_PACKAGE_NOT_FOUND",
                format!("No {} package {selected} covers {date}.", kind.label()),
            )),
            _ => Err(failure(
                "RULE_PACKAGE_AMBIGUOUS",
                format!(
                    "Multiple {} packages {selected} cover {date}.",
                    kind.label()
                ),
            )),
        }
    }
    pub fn resolve_tariff(
        &self,
        date: &str,
        package_id: Option<&str>,
    ) -> Result<&RulePackage, RuleResolutionFailure> {
        self.resolve(
            RuleKind::Tariff,
            date,
            package_id.unwrap_or(&self.package_ids.tariff),
        )
    }
    pub fn resolve_legal(&self, date: &str) -> Result<&RulePackage, RuleResolutionFailure> {
        self.resolve(RuleKind::Legal, date, &self.package_ids.legal)
    }
    pub fn resolve_holiday(&self, date: &str) -> Result<&RulePackage, RuleResolutionFailure> {
        self.resolve(RuleKind::Holiday, date, &self.package_ids.holiday)
    }
    pub fn tariff_package_ids(&self) -> Vec<&str> {
        let mut seen = BTreeSet::new();
        self.catalog
            .tariff
            .iter()
            .filter_map(|p| {
                if seen.insert(p.package_id.as_str()) {
                    Some(p.package_id.as_str())
                } else {
                    None
                }
            })
            .collect()
    }
    pub fn annual_tariff_candidates(&self, package_id: &str, year: i32) -> Vec<&RulePackage> {
        if !(1900..=4099).contains(&year) {
            return vec![];
        }
        let start = format!("{year}-01-01");
        let end = format!("{year}-12-31");
        self.catalog
            .tariff
            .iter()
            .filter(|p| {
                p.package_id == package_id
                    && p.valid_from <= end
                    && p.valid_to.as_ref().is_none_or(|to| to >= &start)
            })
            .collect()
    }
    pub fn simple_tariff_data(&self) -> Option<Value> {
        self.simple_tariff_data_ref()
            .map(|data| json!({"tables":data.tables,"sources":data.sources}))
    }
    pub fn simple_tariff_data_ref(&self) -> Option<SimpleTariffDataRef<'_>> {
        // max_by_key would select the last equal element; the original stable
        // descending sort selects the first, so keep it on equal dates.
        let mut carrier: Option<&RulePackage> = None;
        for p in &self.catalog.tariff {
            if p.engine_contract_version == 19
                && p.rules
                    .get("simpleTariffTables")
                    .is_some_and(|v| !v.is_null() && v != &Value::Bool(false))
                && carrier.is_none_or(|c| p.valid_from > c.valid_from)
            {
                carrier = Some(p);
            }
        }
        carrier.map(|p| SimpleTariffDataRef {
            tables: &p.rules["simpleTariffTables"]["tables"],
            sources: p.metadata.get("sources"),
        })
    }
}
