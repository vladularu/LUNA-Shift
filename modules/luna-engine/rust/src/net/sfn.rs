//! Exact § 3b payroll attribution from recorded/planned minute facts.
use super::{
    CalculationMode, NetPayResult, calculate_monthly_net_pay, integer_in_range, js_truthy,
    resolve_calculation_basis,
};
use crate::calendar::parse_date;
use crate::rules::{
    RuleResolver,
    holidays::{HolidayError, holiday_map_for_month},
};
use crate::tax::PapError;
use jiff::{ToSpan, Zoned, civil::Date};
use num_bigint::BigInt;
use num_traits::{One, ToPrimitive, Zero};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug)]
struct Failure {
    status: &'static str,
    reason: &'static str,
    holiday_error: Option<HolidayError>,
}
fn invalid(reason: &'static str) -> Failure {
    Failure {
        status: "invalid-input",
        reason,
        holiday_error: None,
    }
}
fn missing(reason: &'static str) -> Failure {
    Failure {
        status: "missing-data",
        reason,
        holiday_error: None,
    }
}
fn unsupported(reason: &'static str) -> Failure {
    Failure {
        status: "unsupported",
        reason,
        holiday_error: None,
    }
}
type Sfn<T> = Result<T, Failure>;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Fraction {
    n: BigInt,
    d: BigInt,
}
impl Fraction {
    fn new(mut n: BigInt, mut d: BigInt) -> Self {
        let (mut a, mut b) = (n.clone(), d.clone());
        while !b.is_zero() {
            let r = &a % &b;
            a = b;
            b = r;
        }
        if !a.is_zero() {
            n /= &a;
            d /= a;
        }
        Self { n, d }
    }
    fn zero() -> Self {
        Self {
            n: BigInt::zero(),
            d: BigInt::one(),
        }
    }
    fn ratio(n: i64, d: i64) -> Self {
        Self::new(n.into(), d.into())
    }
    fn add(&self, b: &Self) -> Self {
        Self::new(&self.n * &b.d + &b.n * &self.d, &self.d * &b.d)
    }
    fn mul(&self, b: &Self) -> Self {
        Self::new(&self.n * &b.n, &self.d * &b.d)
    }
    fn div(&self, b: &Self) -> Self {
        Self::new(&self.n * &b.d, &self.d * &b.n)
    }
    fn times(&self, count: i64) -> Self {
        Self::new(&self.n * count, self.d.clone())
    }
    fn minimum(&self, b: &Self) -> Self {
        if &self.n * &b.d <= &b.n * &self.d {
            self.clone()
        } else {
            b.clone()
        }
    }
    fn floor(&self) -> Sfn<i64> {
        (&self.n / &self.d)
            .to_i64()
            .ok_or_else(|| invalid("Ungültige Zuschlagszahlung."))
    }
    fn remainder(&self) -> Self {
        Self::new(&self.n % &self.d, self.d.clone())
    }
}

fn timestamp(value: &Value) -> Sfn<Zoned> {
    let Some(text) = value.as_str() else {
        return Err(invalid(
            "Zeitangaben benötigen minutengenaue Berliner Ortszeit mit UTC-Offset.",
        ));
    };
    let b = text.as_bytes();
    let offset_at = match b.len() {
        22 => 16,
        25 => 19,
        _ => {
            return Err(invalid(
                "Zeitangaben benötigen minutengenaue Berliner Ortszeit mit UTC-Offset.",
            ));
        }
    };
    let shape = b.iter().enumerate().all(|(i, c)| match i {
        4 | 7 => *c == b'-',
        10 => *c == b'T',
        13 => *c == b':',
        i if i == offset_at => matches!(*c, b'+' | b'-'),
        i if i == offset_at + 3 => *c == b':',
        16 if offset_at == 19 => *c == b':',
        17 | 18 if offset_at == 19 => *c == b'0',
        _ => c.is_ascii_digit(),
    });
    if !shape {
        return Err(invalid(
            "Zeitangaben benötigen minutengenaue Berliner Ortszeit mit UTC-Offset.",
        ));
    }
    let bad_time = || invalid("Ungültige Ortszeit oder unpassender UTC-Offset.");
    let normalized = format!("{}:00{}", &text[..16], &text[offset_at..]);
    let instant = normalized
        .parse::<jiff::Timestamp>()
        .map_err(|_| bad_time())?;
    let zone = crate::time_zone::zone("Europe/Berlin").map_err(|_| bad_time())?;
    let time = instant.to_zoned(zone);
    let offset_hours = text[offset_at + 1..offset_at + 3]
        .parse::<i32>()
        .map_err(|_| bad_time())?;
    let offset_minutes = text[offset_at + 4..]
        .parse::<i32>()
        .map_err(|_| bad_time())?;
    let signed_offset =
        (offset_hours * 60 + offset_minutes) * 60 * if b[offset_at] == b'-' { -1 } else { 1 };
    if offset_minutes > 59
        || time.offset().seconds() != signed_offset
        || time.date().to_string() != text[..10]
        || time.hour() != text[11..13].parse::<i8>().map_err(|_| bad_time())?
        || time.minute() != text[14..16].parse::<i8>().map_err(|_| bad_time())?
    {
        return Err(bad_time());
    }
    Ok(time)
}

fn range(value: &Value) -> Sfn<(Zoned, Zoned)> {
    if !js_truthy(value) {
        return Err(invalid("Zeitintervall fehlt."));
    }
    let start = timestamp(&value["start"])?;
    let end = timestamp(&value["end"])?;
    if end.timestamp() <= start.timestamp() {
        return Err(invalid("Zeitintervalle müssen positiv sein."));
    }
    Ok((start, end))
}

fn minute_index(point: &Zoned, start: &Zoned) -> i64 {
    (point.timestamp().as_second() - start.timestamp().as_second()) / 60
}

fn indices(value: &Value, start: &Zoned, end: &Zoned) -> Sfn<(usize, usize)> {
    let (from, until) = range(value)?;
    if from.timestamp() < start.timestamp() || until.timestamp() > end.timestamp() {
        return Err(invalid("Intervall liegt außerhalb der Schicht."));
    }
    Ok((
        minute_index(&from, start) as usize,
        minute_index(&until, start) as usize,
    ))
}

#[derive(Clone, Copy)]
struct Clock {
    date: Date,
    prior: Date,
    minute: i16,
}
fn clocks(start: &Zoned, minutes: i64) -> Sfn<Vec<Clock>> {
    let bad_time = || invalid("Ungültige Ortszeit oder unpassender UTC-Offset.");
    let last = start
        .checked_add((minutes - 1).minutes())
        .map_err(|_| bad_time())?;
    let ordinary = start.offset() == last.offset();
    (0..minutes)
        .map(|i| {
            let (date, minute) = if ordinary {
                let minute = i64::from(start.hour()) * 60 + i64::from(start.minute()) + i;
                (
                    start
                        .date()
                        .checked_add((minute / 1440).days())
                        .map_err(|_| bad_time())?,
                    (minute % 1440) as i16,
                )
            } else {
                let time = start.checked_add(i.minutes()).map_err(|_| bad_time())?;
                (
                    time.date(),
                    i16::from(time.hour()) * 60 + i16::from(time.minute()),
                )
            };
            Ok(Clock {
                date,
                prior: date.checked_sub(1.days()).map_err(|_| bad_time())?,
                minute,
            })
        })
        .collect()
}

fn day_rate(date: Date, minute: i16, holidays: &BTreeSet<String>) -> i64 {
    if (date.month() == 12
        && (date.day() == 25 || date.day() == 26 || (date.day() == 24 && minute >= 840)))
        || (date.month() == 5 && date.day() == 1)
    {
        15_000
    } else if holidays.contains(&date.to_string())
        || (date.month() == 12 && date.day() == 31 && minute >= 840)
    {
        12_500
    } else if date.weekday().to_monday_zero_offset() == 6 {
        5_000
    } else {
        0
    }
}

fn valid_workplace(state: &str, region: &str) -> bool {
    [
        "BW", "BY", "BE", "BB", "HB", "HH", "HE", "MV", "NI", "NW", "RP", "SL", "SN", "ST", "SH",
        "TH",
    ]
    .contains(&state)
        && match region {
            "NONE" => true,
            "BY_MARIA_HIMMELFAHRT" | "BY_AUGSBURG" => state == "BY",
            "SN_FRONLEICHNAM" => state == "SN",
            "TH_FRONLEICHNAM" => state == "TH",
            _ => false,
        }
}

struct Category {
    paid: i64,
    free: Fraction,
    night: Vec<Fraction>,
    day: Vec<Fraction>,
}
type PaidRate = (Fraction, i64, Vec<(String, Fraction)>);

fn classify(input: &Value, resolver: &RuleResolver, mode: CalculationMode) -> Sfn<Value> {
    let month = input["month"]
        .as_str()
        .ok_or_else(|| invalid("Ungültiger Abrechnungsmonat."))?;
    let first = if month.len() == 7 {
        parse_date(&format!("{month}-01")).ok()
    } else {
        None
    }
    .ok_or_else(|| invalid("Ungültiger Abrechnungsmonat."))?;
    let basis = resolve_calculation_basis(month, mode)
        .ok_or_else(|| unsupported("Für dieses Jahr fehlen geprüfte SFN-Berechnungsgrundlagen."))?;
    if mode == CalculationMode::Forecast && input["workEvidence"] != "PLANNED" {
        return Err(unsupported(
            "Vorläufige SFN-Prognosen benötigen geplante Dienste.",
        ));
    }
    if input["completeGross"] != true {
        return Err(missing("Das Gesamtbrutto ist nicht vollständig bestätigt."));
    }
    let gross = integer_in_range(&input["grossCents"], 1, 10_000_000)
        .ok_or_else(|| invalid("Ungültige Bruttobeträge."))?;
    let regular = integer_in_range(&input["regularMonthlySocialInsuranceGrossCents"], 0, gross)
        .ok_or_else(|| invalid("Ungültige Bruttobeträge."))?;
    if input["basicHourlyPayCents"].is_null() {
        return Err(missing("Der steuerliche SFN-Grundlohn fehlt."));
    }
    let hourly = integer_in_range(&input["basicHourlyPayCents"], 1, 10_000_000)
        .ok_or_else(|| invalid("Ungültiger SFN-Grundlohn."))?;
    if !js_truthy(&input["workplace"]) || input["workplace"]["holidayRegion"] == "UNKNOWN" {
        return Err(missing("Der genaue Arbeitsort für Feiertage fehlt."));
    }
    let state = input["workplace"]["federalState"].as_str().unwrap_or("");
    let region = input["workplace"]["holidayRegion"].as_str().unwrap_or("");
    if !valid_workplace(state, region) {
        return Err(invalid("Ungültiger Arbeitsort."));
    }
    if input["workEvidence"] != "PLANNED" && input["workEvidence"] != "RECORDED" {
        return Err(missing(
            "Arbeitszeiten müssen als geplant oder aufgezeichnet gekennzeichnet sein.",
        ));
    }
    if input.get("monthAttribution").is_some()
        && input["monthAttribution"] != "WORK_MINUTES"
        && input["monthAttribution"] != "SHIFT_START"
    {
        return Err(invalid("Ungültige Monatszuordnung."));
    }
    let shift_start = input["monthAttribution"] == "SHIFT_START";
    if shift_start && input["workEvidence"] != "PLANNED" {
        return Err(invalid(
            "Die Zuordnung nach Dienstbeginn gilt nur für Dienstplan-Prognosen.",
        ));
    }
    let shifts = input["shifts"]
        .as_array()
        .filter(|items| items.len() <= 100)
        .ok_or_else(|| invalid("Ungültige Schichtliste."))?;
    let mut ids = BTreeSet::new();
    let mut payment_ids = BTreeSet::new();
    let mut occupied = Vec::new();
    let mut results = Vec::new();
    for shift in shifts {
        let id = shift["id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or_else(|| invalid("Schicht-IDs müssen eindeutig sein."))?;
        if !ids.insert(id) {
            return Err(invalid("Schicht-IDs müssen eindeutig sein."));
        }
        if shift.get("sourceShiftId").is_some()
            && !shift["sourceShiftId"]
                .as_str()
                .is_some_and(|id| !id.is_empty())
        {
            return Err(invalid("Der ursprüngliche Diensteintrag fehlt."));
        }
        let (start, end) = range(shift)?;
        let minutes = minute_index(&end, &start);
        if minutes > 1560 {
            return Err(unsupported(
                "Schichten über 26 Stunden sind nicht unterstützt.",
            ));
        }
        if shift_start {
            if start.date().to_string().get(..7) != Some(month) {
                return Err(unsupported(
                    "Der Dienstbeginn gehört zu einem anderen Prognosemonat.",
                ));
            }
        } else if start.date()
            < first
                .checked_sub(1.days())
                .map_err(|_| invalid("Ungültiger Abrechnungsmonat."))?
            || end.date()
                > first
                    .checked_add(1.months())
                    .map_err(|_| invalid("Ungültiger Abrechnungsmonat."))?
        {
            return Err(unsupported(
                "Arbeitszeiten außerhalb dieses Monats sind nicht unterstützt.",
            ));
        }
        if shift["unpaidBreaks"].is_null() {
            return Err(missing("Die Lage unbezahlter Pausen fehlt."));
        }
        let bad_lists = || invalid("Ungültige Pausen- oder Zahlungsliste.");
        let unpaid = shift["unpaidBreaks"]
            .as_array()
            .filter(|items| items.len() <= 100)
            .ok_or_else(bad_lists)?;
        let paid = match shift.get("paidBreaks") {
            Some(value) => value
                .as_array()
                .filter(|items| items.len() <= 100)
                .ok_or_else(bad_lists)?
                .as_slice(),
            None => &[],
        };
        let payments = shift["payments"]
            .as_array()
            .filter(|items| items.len() <= 100)
            .ok_or_else(bad_lists)?;
        let mut working = vec![true; minutes as usize];
        for pause in unpaid.iter().chain(paid) {
            let (from, until) = indices(pause, &start, &end)?;
            for item in &mut working[from..until] {
                if !*item {
                    return Err(invalid("Unbezahlte Pausen überschneiden sich."));
                }
                *item = false;
            }
        }
        let start_second = start.timestamp().as_second();
        let end_second = end.timestamp().as_second();
        if occupied
            .iter()
            .any(|&(from, until)| start_second < until && end_second > from)
        {
            return Err(invalid("Schichten überschneiden sich."));
        }
        occupied.push((start_second, end_second));
        let times = clocks(&start, minutes)?;
        let months: BTreeSet<String> = times
            .iter()
            .map(|time| format!("{:04}-{:02}", time.date.year(), time.date.month()))
            .collect();
        let mut holidays = BTreeSet::new();
        for month in months {
            let map =
                holiday_map_for_month(&month, state, region, resolver).map_err(
                    |error| match error {
                        HolidayError::Resolution(_) => {
                            missing("Feiertagsregeln für die benötigten Arbeitstage fehlen.")
                        }
                        error => Failure {
                            status: "invalid-input",
                            reason: "",
                            holiday_error: Some(error),
                        },
                    },
                )?;
            holidays.extend(map.into_keys());
        }
        let previous_nights: BTreeSet<Date> = times
            .iter()
            .zip(&working)
            .filter(|(time, working)| **working && time.minute >= 1200)
            .map(|(time, _)| time.date)
            .collect();
        let mut night_payments = vec![Fraction::zero(); minutes as usize];
        let mut day_payments = vec![Fraction::zero(); minutes as usize];
        let mut categories: BTreeMap<String, Category> = BTreeMap::new();
        let mut paid_premium = 0;
        for payment in payments {
            let id = payment["id"]
                .as_str()
                .filter(|id| !id.is_empty())
                .ok_or_else(|| invalid("Zahlungs-IDs müssen eindeutig sein."))?;
            if !payment_ids.insert(id) {
                return Err(invalid("Zahlungs-IDs müssen eindeutig sein."));
            }
            let kind = payment["kind"].as_str().unwrap_or("");
            let amount = integer_in_range(&payment["amountCents"], 0, 10_000_000);
            let periods = payment["periods"]
                .as_array()
                .filter(|items| !items.is_empty() && items.len() <= 100);
            if !["NIGHT", "DAY", "OTHER"].contains(&kind)
                || amount.is_none()
                || !payment["additionalToBasicPay"].is_boolean()
                || periods.is_none()
            {
                return Err(invalid("Ungültige Zuschlagszahlung."));
            }
            let amount = amount.ok_or_else(|| invalid("Ungültige Zuschlagszahlung."))?;
            let mut paid_minutes = BTreeSet::new();
            let mut covered = BTreeSet::new();
            for period in periods.ok_or_else(|| invalid("Ungültige Zuschlagszahlung."))? {
                let (from, until) = indices(period, &start, &end)?;
                for i in from..until {
                    if !covered.insert(i) {
                        return Err(invalid(
                            "Intervalle einer Zuschlagszahlung überschneiden sich.",
                        ));
                    }
                    if !working[i] {
                        continue;
                    }
                    if !shift_start && times[i].date.to_string().get(..7) != Some(month) {
                        return Err(unsupported(
                            "Bezahlte Zuschlagszeiten müssen im Abrechnungsmonat liegen.",
                        ));
                    }
                    paid_minutes.insert(i);
                }
            }
            if paid_minutes.is_empty() {
                return Err(invalid(
                    "Eine Zuschlagszahlung benötigt bezahlte Arbeitsminuten.",
                ));
            }
            paid_premium += amount;
            let category = match payment.get("category") {
                None | Some(Value::Null) => {
                    if kind == "NIGHT" {
                        "NIGHT"
                    } else {
                        "OTHER"
                    }
                }
                Some(value) => value.as_str().unwrap_or(""),
            };
            if !["NIGHT", "SUNDAY", "HOLIDAY", "SATURDAY", "OTHER"].contains(&category) {
                return Err(invalid("Ungültige Zuschlagsart."));
            }
            let bucket = categories
                .entry(category.into())
                .or_insert_with(|| Category {
                    paid: 0,
                    free: Fraction::zero(),
                    night: vec![Fraction::zero(); minutes as usize],
                    day: vec![Fraction::zero(); minutes as usize],
                });
            bucket.paid += amount;
            if kind == "OTHER" || payment["additionalToBasicPay"] != true {
                continue;
            }
            let value = Fraction::ratio(amount, paid_minutes.len() as i64);
            let (all, category) = if kind == "NIGHT" {
                (&mut night_payments, &mut bucket.night)
            } else {
                (&mut day_payments, &mut bucket.day)
            };
            for i in paid_minutes {
                all[i] = all[i].add(&value);
                category[i] = category[i].add(&value);
            }
        }
        let mut tax_free = Fraction::zero();
        let mut social_free = Fraction::zero();
        let mut worked_minutes = 0;
        let mut night_minutes = 0;
        let mut day_minutes = 0;
        let mut paid_rates: BTreeMap<PaidRate, i64> = BTreeMap::new();
        let mut day_rates = BTreeMap::new();
        for (i, time) in times.iter().enumerate() {
            if !working[i] {
                continue;
            }
            worked_minutes += 1;
            let rates = day_rates.entry(time.date).or_insert_with(|| {
                [
                    day_rate(time.date, 0, &holidays),
                    day_rate(time.date, 840, &holidays),
                    day_rate(time.prior, 1439, &holidays),
                ]
            });
            let continued = time.minute < 240 && previous_nights.contains(&time.prior);
            let night_bps = if time.minute >= 1200 || time.minute < 360 {
                if continued { 4000 } else { 2500 }
            } else {
                0
            };
            let day_bps =
                rates[usize::from(time.minute >= 840)].max(if continued { rates[2] } else { 0 });
            if night_bps > 0 {
                night_minutes += 1;
            }
            if day_bps > 0 {
                day_minutes += 1;
            }
            for (payment, rate, night) in [
                (&night_payments[i], night_bps, true),
                (&day_payments[i], day_bps, false),
            ] {
                if rate == 0 || payment.n.is_zero() {
                    continue;
                }
                let shares = categories
                    .iter()
                    .filter_map(|(name, category)| {
                        let value = if night {
                            &category.night[i]
                        } else {
                            &category.day[i]
                        };
                        (!value.n.is_zero()).then(|| (name.clone(), value.clone()))
                    })
                    .collect();
                *paid_rates
                    .entry((payment.clone(), rate, shares))
                    .or_default() += 1;
            }
        }
        for ((payment, rate, shares), count) in paid_rates {
            let tax = payment.minimum(&Fraction::ratio(hourly.min(5000) * rate, 600_000));
            let social = payment.minimum(&Fraction::ratio(hourly.min(2500) * rate, 600_000));
            tax_free = tax_free.add(&tax.times(count));
            social_free = social_free.add(&social.times(count));
            for (name, share) in shares {
                if let Some(bucket) = categories.get_mut(&name) {
                    bucket.free = bucket.free.add(&tax.mul(&share).div(&payment).times(count));
                }
            }
        }
        let tax_free_cents = tax_free.floor()?;
        let social_free_cents = social_free.floor()?;
        let mut rows = categories
            .into_iter()
            .map(|(name, bucket)| {
                Ok((
                    name,
                    bucket.paid,
                    bucket.free.floor()?,
                    bucket.free.remainder(),
                ))
            })
            .collect::<Sfn<Vec<_>>>()?;
        let mut remaining = tax_free_cents - rows.iter().map(|row| row.2).sum::<i64>();
        let mut order: Vec<_> = (0..rows.len()).collect();
        order.sort_by(|&a, &b| {
            (&rows[b].3.n * &rows[a].3.d)
                .cmp(&(&rows[a].3.n * &rows[b].3.d))
                .then_with(|| rows[a].0.cmp(&rows[b].0))
        });
        for i in order {
            if remaining <= 0 {
                break;
            }
            rows[i].2 += 1;
            remaining -= 1;
        }
        let breakdown: Vec<_> = rows.into_iter().map(|(category, paid, free, _)| json!({"category":category,"paidPremiumCents":paid,"taxFreeCents":free,"taxablePremiumCents":paid-free})).collect();
        let mut result = json!({"shiftId":shift["id"],"workedMinutes":worked_minutes,"nightMinutes":night_minutes,"dayMinutes":day_minutes,"paidPremiumCents":paid_premium,"taxFreeCents":tax_free_cents,"socialInsuranceFreeCents":social_free_cents,"taxablePremiumCents":paid_premium-tax_free_cents,"socialInsuranceLiablePremiumCents":paid_premium-social_free_cents,"premiumBreakdown":breakdown});
        if let Some(source) = shift.get("sourceShiftId") {
            result["sourceShiftId"] = source.clone();
        }
        results.push(result);
    }
    let paid_premium: i64 = results
        .iter()
        .filter_map(|v| v["paidPremiumCents"].as_i64())
        .sum();
    if paid_premium > gross {
        return Err(invalid(
            "Zuschlagszahlungen überschreiten das Gesamtbrutto.",
        ));
    }
    let tax_free: i64 = results
        .iter()
        .filter_map(|v| v["taxFreeCents"].as_i64())
        .sum();
    let social_free: i64 = results
        .iter()
        .filter_map(|v| v["socialInsuranceFreeCents"].as_i64())
        .sum();
    Ok(
        json!({"status":"available","ruleVersion":"DE-SFN-2026-PROTOTYPE","calculationBasis":basis,"workEvidence":input["workEvidence"],"amounts":{"grossCents":gross,"taxableGrossCents":gross-tax_free,"socialInsuranceGrossCents":gross-social_free,"regularMonthlySocialInsuranceGrossCents":regular},"shifts":results,"paidPremiumCents":paid_premium,"taxFreeCents":tax_free,"socialInsuranceFreeCents":social_free}),
    )
}

pub fn classify_sfn_payroll_2026(
    input: &Value,
    resolver: &RuleResolver,
    mode: CalculationMode,
) -> Result<Value, HolidayError> {
    match classify(input, resolver, mode) {
        Ok(value) => Ok(value),
        Err(Failure {
            holiday_error: Some(error),
            ..
        }) => Err(error),
        Err(failure) => Ok(json!({"status":failure.status,"reason":failure.reason})),
    }
}

#[derive(Debug)]
pub enum SfnError {
    Holiday(HolidayError),
    Pap(PapError),
}
impl From<HolidayError> for SfnError {
    fn from(value: HolidayError) -> Self {
        Self::Holiday(value)
    }
}
impl From<PapError> for SfnError {
    fn from(value: PapError) -> Self {
        Self::Pap(value)
    }
}
impl std::fmt::Display for SfnError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Holiday(error) => error.fmt(f),
            Self::Pap(error) => error.fmt(f),
        }
    }
}
impl std::error::Error for SfnError {}

pub fn calculate_monthly_net_pay_with_sfn(
    input: &Value,
    resolver: &RuleResolver,
) -> Result<Value, SfnError> {
    let classification =
        classify_sfn_payroll_2026(&input["payroll"], resolver, CalculationMode::Verified)?;
    if classification["status"] != "available" {
        return Ok(json!({"status":"unavailable","stage":"sfn","reason":classification["reason"]}));
    }
    if js_truthy(&input["profile"])
        && input["profile"]["worksInSaxony"]
            != (input["payroll"]["workplace"]["federalState"] == "SN")
    {
        return Ok(
            json!({"status":"unavailable","stage":"net-pay","reason":"Beschäftigungsort Sachsen ist im Steuerprofil und in der SFN-Zuordnung widersprüchlich."}),
        );
    }
    let pay_input = json!({"month":input["payroll"]["month"],"profile":input["profile"],"specialCases":input["specialCases"],"amounts":classification["amounts"]});
    let pay = calculate_monthly_net_pay(&pay_input, CalculationMode::Verified)?;
    match pay {
        NetPayResult::Available(pay) => Ok(
            json!({"status":"available","classification":classification,"pay":NetPayResult::Available(pay)}),
        ),
        NetPayResult::MissingProfile { reason }
        | NetPayResult::InvalidInput { reason }
        | NetPayResult::Unsupported { reason } => {
            Ok(json!({"status":"unavailable","stage":"net-pay","reason":reason}))
        }
    }
}
