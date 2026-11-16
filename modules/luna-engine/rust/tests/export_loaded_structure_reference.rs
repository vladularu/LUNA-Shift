#[path = "support/value_pool_source_numbers.rs"]
mod value_pool;
use luna_engine::{
    calendar::loaded_scope::{RawScopeRows, ScopeLoadFailure},
    contract::OwnerIdentity,
    runtime::{
        SnapshotRegistry,
        calendar_loaded::{CalendarLoadTicket, CalendarLoadedPool, LoadedPoolError, LoadedStart},
        export_report::{collation::ExportCollationDraft, structure::ExportStructureIndex},
        write_resource::WriteContextStamp,
    },
};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
fn stamp() -> WriteContextStamp {
    WriteContextStamp::from_raw(&json!({"dataSpaceId":"0123456789abcdef0123456789abcdef","inputToken":"11111111111111111111111111111111","databaseSchemaVersion":35})).unwrap()
}
fn ranks(data: &Value, strings: &[String]) -> Vec<u8> {
    let source = data["collationRanks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| (v[0].as_str().unwrap(), v[1].as_u64().unwrap()))
        .collect::<BTreeMap<_, _>>();
    let groups = strings
        .iter()
        .map(|s| source[s.as_str()])
        .collect::<BTreeSet<_>>()
        .into_iter()
        .enumerate()
        .map(|(i, v)| (v, i))
        .collect::<BTreeMap<_, _>>();
    serde_json::to_vec(
        &strings
            .iter()
            .map(|s| (s, groups[&source[s.as_str()]]))
            .collect::<BTreeMap<_, _>>(),
    )
    .unwrap()
}
fn failure(s: &str) -> ScopeLoadFailure {
    match s {
        "PROFILE" => ScopeLoadFailure::Profile,
        "TEMPLATES" => ScopeLoadFailure::Templates,
        "CALENDAR" => ScopeLoadFailure::Calendar,
        "TARIFF" => ScopeLoadFailure::TariffDecisions,
        "PATTERN" => ScopeLoadFailure::WorkPattern,
        _ => panic!("unknown original IO group"),
    }
}
struct Job<'a> {
    ticket: CalendarLoadTicket,
    raw: &'a Value,
    ended: bool,
    completed: bool,
    calendar_error: bool,
}
struct Replay<'a> {
    data: &'a Value,
    case: &'a Value,
    pool: CalendarLoadedPool,
    jobs: Vec<Job<'a>>,
    next_failure: Option<String>,
}
impl<'a> Replay<'a> {
    fn publish_failure(&self, ticket: &CalendarLoadTicket, kind: ScopeLoadFailure) {
        let d = self.pool.prepare_failure(ticket, kind).unwrap();
        let r = ranks(self.data, d.candidates());
        self.pool.finalize(d, &r).unwrap();
    }
    fn begin(&mut self, start: LoadedStart) {
        let LoadedStart::Read(ticket) = start else {
            return;
        };
        let capture = &self.case["input"]["captures"][self.jobs.len()];
        assert_eq!(json!(ticket.range()), capture["range"]);
        let mut ended = false;
        let mut calendar_error = capture["queries"].as_array().unwrap().is_empty();
        if let Some(kind) = self.next_failure.as_deref() {
            if ticket.full_snapshot() && kind != "CALENDAR" {
                self.publish_failure(&ticket, failure(kind));
                ended = true;
                self.next_failure = None;
            } else if kind == "CALENDAR" {
                calendar_error = true;
                self.next_failure = None;
            }
        }
        self.jobs.push(Job {
            ticket,
            raw: &capture["rawSource"],
            ended,
            completed: false,
            calendar_error,
        });
    }
    fn complete(&mut self, id: usize) {
        let job = &mut self.jobs[id];
        assert!(!job.completed);
        job.completed = true;
        if job.ended {
            return;
        }
        let ticket = job.ticket.clone();
        let calendar_error = job.calendar_error;
        let raw = job.raw;
        let intake = match self.pool.reserve_source(&ticket) {
            Ok(v) => v,
            Err(LoadedPoolError::Stale) => return,
            Err(e) => panic!("unexpected reserve {e:?}"),
        };
        if calendar_error {
            drop(intake);
            self.publish_failure(&ticket, ScopeLoadFailure::Calendar);
            return;
        }
        let source = RawScopeRows::new(
            Arc::from(raw["shiftRows"].as_array().unwrap().clone()),
            Arc::from(raw["appointmentRows"].as_array().unwrap().clone()),
            Arc::from(raw["templateRows"].as_array().unwrap().clone()),
        );
        let draft = source
            .map_err(|_| ())
            .and_then(|source| self.pool.prepare_query(intake, source).map_err(|_| ()));
        let draft = match draft {
            Ok(v) => v,
            Err(()) => {
                self.publish_failure(&ticket, ScopeLoadFailure::Calendar);
                return;
            }
        };
        let r = ranks(self.data, draft.candidates());
        let d = self.pool.finish_query(draft, &r).unwrap();
        if d.has_verified_ranks() {
            self.pool.finalize_cached(d).unwrap();
        } else {
            let r = ranks(self.data, d.candidates());
            self.pool.finalize(d, &r).unwrap();
        }
    }
}
#[test]
fn actual_native_loaded_sources_reproduce_original_export_candidates_for_all_load_retain_frames() {
    let data = value_pool::decode(include_str!("../../reference/loaded-scope-golden.json"));
    let expected = value_pool::decode(include_str!(
        "../../reference/export-loaded-candidates-golden.json"
    ));
    assert_eq!(expected["cases"].as_array().unwrap().len(), 21);
    let mut frames = 0;
    let mut prepared = 0;
    for declared in expected["cases"].as_array().unwrap() {
        let case = data["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == declared["id"])
            .unwrap();
        let registry = SnapshotRegistry::default();
        registry
            .reset_for_owner(&OwnerIdentity::new("loaded-export", 1).unwrap())
            .unwrap();
        let owner = registry.utility_owner_marker().unwrap();
        let pool = CalendarLoadedPool::new(registry);
        pool.bind_locale("original-fixture-Intl").unwrap();
        let mut r = Replay {
            data: &data,
            case,
            pool,
            jobs: Vec::new(),
            next_failure: case["input"]["initialIoFailure"]
                .as_str()
                .map(str::to_owned),
        };
        let mut epoch = case["input"]["observedEpochMilliseconds"].as_i64().unwrap();
        let first = r
            .pool
            .active_month(
                case["input"]["activeMonth"].as_str().unwrap(),
                epoch,
                "original-token",
            )
            .unwrap();
        r.begin(first);
        for i in 0..declared["frames"].as_array().unwrap().len() {
            if i > 0 {
                let step = &case["input"]["steps"][i - 1];
                match step["kind"].as_str().unwrap() {
                    "MONTH" => {
                        let s = r
                            .pool
                            .active_month(step["value"].as_str().unwrap(), epoch, "original-token")
                            .unwrap();
                        r.begin(s)
                    }
                    "CLOCK" => epoch = step["value"].as_i64().unwrap(),
                    "RELOAD" | "BACKGROUND" => {
                        let s = r
                            .pool
                            .reload(step["kind"] == "BACKGROUND", epoch, "original-token")
                            .unwrap();
                        r.begin(s)
                    }
                    "FAIL_NEXT" => {
                        r.next_failure = Some(step["group"].as_str().unwrap().to_owned())
                    }
                    "COMPLETE" => {
                        let id = step["id"]
                            .as_u64()
                            .map(|v| v as usize)
                            .unwrap_or_else(|| r.jobs.iter().position(|v| !v.completed).unwrap());
                        r.complete(id)
                    }
                    "UNMOUNT" => r.pool.unmount().unwrap(),
                    other => panic!("unexpected load-only command {other}"),
                }
            }
            let observed = &case["expected"]["frames"][i];
            let frame = &declared["frames"][i];
            let snapshot = r.pool.snapshot().unwrap();
            let state = json!(snapshot.status);
            for key in ["ready", "error", "calendarRange"] {
                assert_eq!(
                    state[key], observed["public"][key],
                    "{} frame{i} {key}",
                    case["id"]
                );
            }
            if let Some(source) = snapshot.source {
                let book = source.entries().unwrap();
                assert_eq!(
                    json!(book.entries().iter().map(Arc::as_ref).collect::<Vec<_>>()),
                    observed["entries"]
                );
                let index = Arc::new(ExportStructureIndex::from_loaded(source).unwrap());
                assert_eq!(
                    index.scanned_entry_count(),
                    observed["entries"].as_array().unwrap().len()
                );
                let period = frame["period"].as_str().unwrap();
                let candidates = index.candidates(period).unwrap();
                assert_eq!(
                    json!(candidates.strings()),
                    frame["candidates"],
                    "{} frame{i}",
                    case["id"]
                );
                assert_eq!(
                    candidates.readable_entry_count(),
                    frame["readableCount"].as_u64().unwrap() as usize
                );
                let draft =
                    ExportCollationDraft::prepare(owner.clone(), stamp(), index.clone(), period)
                        .unwrap();
                let proof = draft
                    .finalize(&serde_json::to_vec(&frame["platformRanks"]).unwrap())
                    .unwrap();
                for text in candidates.strings() {
                    assert_eq!(
                        proof.verified_rank(text).unwrap(),
                        frame["platformRanks"][text].as_u64().unwrap() as u32
                    );
                }
                prepared += 1;
            } else {
                assert!(observed["entries"].as_array().unwrap().is_empty());
            }
            frames += 1;
            r.pool.collect_retired().unwrap();
        }
        assert_eq!(
            r.jobs.len(),
            case["input"]["captures"].as_array().unwrap().len()
        );
    }
    assert_eq!(frames, 127);
    assert!(prepared > 50);
}
fn synthetic_ranks(strings: &[String]) -> Vec<u8> {
    serde_json::to_vec(
        &strings
            .iter()
            .enumerate()
            .map(|(i, s)| (s, i as u32))
            .collect::<BTreeMap<_, _>>(),
    )
    .unwrap()
}
fn publish_native(
    pool: &CalendarLoadedPool,
    rows: Arc<RawScopeRows>,
) -> luna_engine::runtime::calendar_loaded::LoadedReadSource {
    let LoadedStart::Read(ticket) = pool
        .active_month("2026-11", 1_794_744_000_000, "original-token")
        .unwrap()
    else {
        panic!()
    };
    let intake = pool.reserve_source(&ticket).unwrap();
    let d = pool.prepare_query(intake, rows).unwrap();
    let r = synthetic_ranks(d.candidates());
    let d = pool.finish_query(d, &r).unwrap();
    if d.has_verified_ranks() {
        pool.finalize_cached(d).unwrap().source.unwrap()
    } else {
        let r = synthetic_ranks(d.candidates());
        pool.finalize(d, &r).unwrap().source.unwrap()
    }
}
#[test]
fn same_core_live_scope_is_required_by_drafts_proofs_and_every_candidate_read() {
    use luna_engine::runtime::export_report::{ExportTimeError, collation::ExportCollationError};
    let data = value_pool::decode(include_str!("../../reference/loaded-scope-golden.json"));
    let raw = &data["cases"][0]["input"]["initial"];
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("loaded-export", 1).unwrap())
        .unwrap();
    let marker = registry.utility_owner_marker().unwrap();
    let pool = CalendarLoadedPool::new(registry.clone());
    pool.bind_locale("synthetic-boundary-only").unwrap();
    let rows = RawScopeRows::new(
        Arc::from(raw["shiftRows"].as_array().unwrap().clone()),
        Arc::from(raw["appointmentRows"].as_array().unwrap().clone()),
        Arc::from([]),
    )
    .unwrap();
    let source = publish_native(&pool, rows);
    let index = Arc::new(ExportStructureIndex::from_loaded(source.clone()).unwrap());
    let weak = Arc::downgrade(&index);
    let draft =
        ExportCollationDraft::prepare(marker.clone(), stamp(), index.clone(), "2026-11").unwrap();
    let other =
        ExportCollationDraft::prepare(marker.clone(), stamp(), index.clone(), "2026-11").unwrap();
    let r = synthetic_ranks(other.candidates().unwrap());
    let proof = other.finalize(&r).unwrap();
    let foreign = SnapshotRegistry::default();
    foreign
        .reset_for_owner(&OwnerIdentity::new("loaded-export", 1).unwrap())
        .unwrap();
    assert!(matches!(
        ExportCollationDraft::prepare(
            foreign.utility_owner_marker().unwrap(),
            stamp(),
            index.clone(),
            "2026-11"
        ),
        Err(ExportCollationError::ForeignBinding)
    ));
    let raw_ranks = synthetic_ranks(draft.candidates().unwrap());
    pool.active_month("2020-06", 1_794_744_000_000, "original-token")
        .unwrap();
    assert!(marker.is_current().unwrap());
    assert!(!index.is_current().unwrap());
    assert!(matches!(
        index.candidates("2026-11"),
        Err(ExportTimeError::StaleSource)
    ));
    assert!(draft.candidates().is_err());
    assert!(draft.candidate_digest().is_err());
    assert!(draft.finalize(&raw_ranks).is_err());
    assert!(!proof.is_current().unwrap());
    assert!(proof.verified_rank("2026-11-15").is_err());
    assert!(
        proof
            .ranks_for(&marker, &stamp(), &index, "2026-11")
            .is_err()
    );
    assert!(matches!(
        ExportStructureIndex::from_loaded(source),
        Err(ExportTimeError::StaleSource)
    ));
    drop(index);
    assert!(weak.upgrade().is_some());
    drop(proof);
    assert!(weak.upgrade().is_none());
}
#[test]
fn fifty_thousand_current_native_records_share_one_index_and_release_the_original_owner() {
    use luna_engine::calendar::window::CalendarRecordSource;
    let data = value_pool::decode(include_str!("../../reference/loaded-scope-golden.json"));
    let raw = &data["cases"][0]["input"]["initial"];
    let mut appointment = raw["appointmentRows"][0].clone();
    appointment["date"] = json!("2026-11-15");
    appointment["title"] = json!("a");
    appointment["created_at"] = json!("i");
    appointment["updated_at"] = json!("i");
    appointment["recurrence_frequency"] = Value::Null;
    appointment["recurrence_interval"] = Value::Null;
    let appointments = (0..49_999)
        .map(|i| {
            let mut v = appointment.clone();
            v["id"] = json!(format!("a{i}"));
            v
        })
        .collect::<Vec<_>>();
    let rows = RawScopeRows::new(
        Arc::from([raw["shiftRows"][0].clone()]),
        Arc::from(appointments),
        Arc::from([]),
    )
    .unwrap();
    let weak = Arc::downgrade(&rows);
    let registry = SnapshotRegistry::default();
    registry
        .reset_for_owner(&OwnerIdentity::new("loaded-export", 1).unwrap())
        .unwrap();
    let marker = registry.utility_owner_marker().unwrap();
    let pool = CalendarLoadedPool::new(registry);
    pool.bind_locale("synthetic-budget-ownership-only").unwrap();
    let source = publish_native(&pool, rows);
    assert_eq!(source.entries_len(), 50_000);
    assert!(source.record(50_000).is_none());
    for (i, entry) in source.entries().unwrap().entries().iter().enumerate() {
        assert!(std::ptr::eq(
            source.record(i).unwrap().base_value(),
            entry.base_value()
        ));
    }
    let index = Arc::new(ExportStructureIndex::from_loaded(source.clone()).unwrap());
    assert_eq!(index.scanned_entry_count(), 50_000);
    let draft = ExportCollationDraft::prepare(marker, stamp(), index.clone(), "2026-11").unwrap();
    let ranks = synthetic_ranks(draft.candidates().unwrap());
    let proof = draft.finalize(&ranks).unwrap();
    assert_eq!(
        index.candidates("2026-11").unwrap().readable_entry_count(),
        50_000
    );
    assert_eq!(
        index.candidates("2026-12").unwrap().readable_entry_count(),
        0
    );
    assert_eq!(index.scanned_entry_count(), 50_000);
    drop(source);
    drop(index);
    drop(pool);
    assert!(weak.upgrade().is_some());
    assert!(!proof.is_current().unwrap());
    drop(proof);
    assert!(weak.upgrade().is_none());
}
