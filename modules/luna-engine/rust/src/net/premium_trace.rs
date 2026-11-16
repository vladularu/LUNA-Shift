//! Optional raw time-attribution side channel of the Rust remuneration engine.
use crate::money::MAX_SAFE_INTEGER;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub fn premium_kind(key: &str) -> &'static str {
    if ["night", "NIGHT"].contains(&key) {
        "NIGHT"
    } else if [
        "sunday",
        "holiday",
        "preholiday",
        "SUNDAY",
        "HOLIDAY_WITH_TIME_OFF",
        "HOLIDAY_WITHOUT_TIME_OFF",
        "PRE_HOLIDAY",
    ]
    .contains(&key)
    {
        "DAY"
    } else {
        "OTHER"
    }
}

pub fn premium_category(key: &str) -> &'static str {
    match key.to_uppercase().as_str() {
        "NIGHT" => "NIGHT",
        "SUNDAY" => "SUNDAY",
        "SATURDAY" => "SATURDAY",
        "HOLIDAY"
        | "PREHOLIDAY"
        | "HOLIDAY_WITH_TIME_OFF"
        | "HOLIDAY_WITHOUT_TIME_OFF"
        | "PRE_HOLIDAY" => "HOLIDAY",
        _ => "OTHER",
    }
}

#[derive(Debug, Clone, Copy)]
pub struct PremiumTraceError;
impl std::fmt::Display for PremiumTraceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Die Zuschlagszeitspur ist unvollständig.")
    }
}
impl std::error::Error for PremiumTraceError {}

struct Bucket {
    total: usize,
    worked: Vec<i64>,
}
pub struct NetPayPremiumTrace {
    id: String,
    start_milliseconds: i64,
    gross_minutes: i64,
    pause_minutes: i64,
    pause_from: i64,
    paid_pause: BTreeSet<i64>,
    buckets: BTreeMap<String, Bucket>,
    payments: Vec<Value>,
}

impl NetPayPremiumTrace {
    pub fn new(
        id: String,
        start_epoch_minute: i64,
        gross_minutes: i64,
        pause_minutes: i64,
        paid_breaks: bool,
    ) -> Result<Self, PremiumTraceError> {
        Self::new_milliseconds(
            id,
            start_epoch_minute
                .checked_mul(60_000)
                .ok_or(PremiumTraceError)?,
            gross_minutes,
            pause_minutes,
            paid_breaks,
        )
    }

    /// Milliseconds preserve historical IANA subminute offsets. Classifier
    /// callbacks must use this API instead of truncating an epoch minute.
    pub fn new_milliseconds(
        id: String,
        start_epoch_milliseconds: i64,
        gross_minutes: i64,
        pause_minutes: i64,
        paid_breaks: bool,
    ) -> Result<Self, PremiumTraceError> {
        // Retain zero/full/overlong pauses for gross-only source paths. The net
        // preparation stage separately rejects pauses at least as long as work.
        if !(0..=14 * 1440).contains(&gross_minutes)
            || !(0..=14 * 1440).contains(&pause_minutes)
            || start_epoch_milliseconds
                .checked_add(gross_minutes * 60_000)
                .is_none()
        {
            return Err(PremiumTraceError);
        }
        let pause_from = (gross_minutes - pause_minutes).div_euclid(2);
        if start_epoch_milliseconds
            .checked_add(pause_from * 60_000)
            .is_none()
            || start_epoch_milliseconds
                .checked_add((pause_from + pause_minutes) * 60_000)
                .is_none()
        {
            return Err(PremiumTraceError);
        }
        let paid_pause = if paid_breaks {
            (pause_from..pause_from + pause_minutes)
                .map(|minute| minute * 60_000)
                .collect()
        } else {
            BTreeSet::new()
        };
        Ok(Self {
            id,
            start_milliseconds: start_epoch_milliseconds,
            gross_minutes,
            pause_minutes,
            pause_from,
            paid_pause,
            buckets: BTreeMap::new(),
            payments: vec![],
        })
    }

    pub fn add(&mut self, key: &str, epoch_minute: i64) -> Result<(), PremiumTraceError> {
        self.add_milliseconds(
            key,
            epoch_minute.checked_mul(60_000).ok_or(PremiumTraceError)?,
        )
    }

    pub fn add_milliseconds(
        &mut self,
        key: &str,
        epoch_milliseconds: i64,
    ) -> Result<(), PremiumTraceError> {
        let offset = epoch_milliseconds
            .checked_sub(self.start_milliseconds)
            .ok_or(PremiumTraceError)?;
        let bucket = self.buckets.entry(key.into()).or_insert_with(|| Bucket {
            total: 0,
            worked: vec![],
        });
        bucket.total = bucket.total.checked_add(1).ok_or(PremiumTraceError)?;
        if offset >= self.pause_from * 60_000
            && offset < (self.pause_from + self.pause_minutes) * 60_000
        {
            self.paid_pause.insert(offset);
        } else {
            bucket.worked.push(epoch_milliseconds);
        }
        Ok(())
    }

    fn timestamp(milliseconds: i64) -> Result<String, PremiumTraceError> {
        let instant =
            jiff::Timestamp::from_millisecond(milliseconds).map_err(|_| PremiumTraceError)?;
        let zone = crate::time_zone::zone("Europe/Berlin").map_err(|_| PremiumTraceError)?;
        let time = instant.to_zoned(zone);
        let offset = time.offset().seconds();
        let sign = if offset < 0 { '-' } else { '+' };
        let absolute = offset.abs();
        let mut offset = format!("{sign}{:02}:{:02}", absolute / 3600, (absolute % 3600) / 60);
        if absolute % 60 != 0 {
            offset.push_str(&format!(":{:02}", absolute % 60));
        }
        Ok(format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}{}",
            time.year(),
            time.month(),
            time.day(),
            time.hour(),
            time.minute(),
            offset
        ))
    }

    fn range(from: i64, until: i64) -> Result<Value, PremiumTraceError> {
        Ok(json!({"start":Self::timestamp(from)?,"end":Self::timestamp(until)?}))
    }
    fn ranges(minutes: &[i64]) -> Result<Vec<Value>, PremiumTraceError> {
        let mut result = vec![];
        let mut from = None;
        let mut until = 0;
        for &minute in minutes {
            if let Some(start) = from
                && minute != until
            {
                result.push(Self::range(start, until)?);
                from = None;
            }
            if from.is_none() {
                from = Some(minute);
            }
            until = minute.checked_add(60_000).ok_or(PremiumTraceError)?;
        }
        if let Some(start) = from {
            result.push(Self::range(start, until)?);
        }
        Ok(result)
    }

    fn worked_minutes(&self) -> Vec<i64> {
        (0..self.gross_minutes)
            .filter(|&i| i < self.pause_from || i >= self.pause_from + self.pause_minutes)
            .map(|i| self.start_milliseconds + i * 60_000)
            .collect()
    }

    pub fn pay(
        &mut self,
        key: &str,
        kind: &str,
        amount_cents: i64,
        category: Option<&str>,
    ) -> Result<(), PremiumTraceError> {
        let bucket = self.buckets.get(key).ok_or(PremiumTraceError)?;
        if !(0..=MAX_SAFE_INTEGER).contains(&amount_cents) {
            return Err(PremiumTraceError);
        }
        let n = i128::from(amount_cents) * bucket.worked.len() as i128;
        let d = bucket.total as i128;
        let worked_cents = i64::try_from((2 * n + d) / (2 * d)).map_err(|_| PremiumTraceError)?;
        if !bucket.worked.is_empty() && worked_cents != 0 {
            let mut payment = json!({"id":format!("{}:{key}",self.id),"kind":kind,"amountCents":worked_cents,"additionalToBasicPay":true,"periods":Self::ranges(&bucket.worked)?});
            if let Some(category) = category {
                payment["category"] = json!(category);
            }
            self.payments.push(payment);
        }
        let paid_break_cents = amount_cents - worked_cents;
        if paid_break_cents != 0 {
            let mut payment = json!({"id":format!("{}:{key}:pause",self.id),"kind":"OTHER","amountCents":paid_break_cents,"additionalToBasicPay":true,"periods":Self::ranges(&self.worked_minutes())?});
            if let Some(category) = category {
                payment["category"] = json!(category);
            }
            self.payments.push(payment);
        }
        Ok(())
    }

    pub fn finish(&self) -> Result<Value, PremiumTraceError> {
        let (mut unpaid, mut paid) = (vec![], vec![]);
        for i in self.pause_from..self.pause_from + self.pause_minutes {
            if self.paid_pause.contains(&(i * 60_000)) {
                paid.push(self.start_milliseconds + i * 60_000);
            } else {
                unpaid.push(self.start_milliseconds + i * 60_000);
            }
        }
        let mut result = Self::range(
            self.start_milliseconds,
            self.start_milliseconds + self.gross_minutes * 60_000,
        )?;
        result["id"] = json!(self.id);
        result["unpaidBreaks"] = json!(Self::ranges(&unpaid)?);
        if !paid.is_empty() {
            result["paidBreaks"] = json!(Self::ranges(&paid)?);
        }
        result["payments"] = json!(self.payments);
        Ok(result)
    }
}
