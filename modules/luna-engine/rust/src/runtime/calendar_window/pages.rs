use super::{model::*, resource::Resource};
use crate::{
    calendar::window::{CalendarWindowView, WindowBounds},
    contract::calendar_window::PageView,
    report::cache_budget::serialized_bytes,
};
use serde::{Serialize, Serializer, ser::SerializeSeq};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Prepared<'a> {
    resource_id: u64,
    candidate_digest: &'a str,
    total: u32,
    bounds: &'a WindowBounds,
    projected_count: u32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Ready<'a> {
    resource_id: u64,
    bounds: &'a WindowBounds,
    projected_count: u32,
    visible_count: u32,
    date_group_count: u32,
    month_group_count: u32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Candidates<'a> {
    resource_id: u64,
    page: CandidatePage<'a>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CandidatePage<'a> {
    candidates: &'a [String],
    next_after: Option<u32>,
    total: u32,
    candidate_digest: &'a str,
}
#[derive(Serialize)]
struct Unavailable<'a> {
    reason: &'a crate::runtime::report::ReportIssue,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Read<'a> {
    resource_id: u64,
    view: PageView,
    page: Page<'a>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Page<'a> {
    items: Elements<'a>,
    next_after: Option<u32>,
    total: u32,
}
pub(super) struct Elements<'a> {
    pub view: &'a CalendarWindowView,
    pub selector: PageView,
    pub start: usize,
    pub end: usize,
    pub navigation: Option<&'a super::resource::NavigationFrame>,
    pub display: Option<&'a crate::contract::calendar_window::EntryPresentation>,
}
impl Serialize for Elements<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut seq = serializer.serialize_seq(Some(self.end - self.start))?;
        for index in self.start..self.end {
            match self.selector {
                PageView::Expanded => seq.serialize_element(
                    &self.view.window().entry(index as u32).expect("bounded row"),
                )?,
                PageView::Visible => seq.serialize_element(
                    &self
                        .view
                        .window()
                        .entry(self.view.visible_indices()[index])
                        .expect("indexed row"),
                )?,
                PageView::VisibleIndices => {
                    seq.serialize_element(&self.view.visible_indices()[index])?
                }
                PageView::Dates => seq.serialize_element(&self.view.date_groups()[index])?,
                PageView::Months => seq.serialize_element(&self.view.month_groups()[index])?,
                PageView::Navigation => seq.serialize_element(
                    &self.navigation.expect("checked single navigation frame"),
                )?,
                PageView::EntryPresentations => seq.serialize_element(
                    &super::display::entry(
                        self.view,
                        index as u32,
                        self.display.expect("checked display options"),
                        &self
                            .navigation
                            .expect("checked native clock")
                            .clock
                            .time_zone,
                    )
                    .map_err(serde::ser::Error::custom)?,
                )?,
                PageView::DatePreviews => seq.serialize_element(
                    &super::display::day(
                        self.view,
                        index,
                        self.display.expect("checked display options"),
                    )
                    .map_err(serde::ser::Error::custom)?,
                )?,
            }
        }
        seq.end()
    }
}
pub(super) fn total(
    view: &CalendarWindowView,
    selector: PageView,
    navigation: Option<&super::resource::NavigationFrame>,
) -> usize {
    match selector {
        PageView::Expanded | PageView::EntryPresentations => view.window().projected_len() as usize,
        PageView::Visible => view.visible_indices().len(),
        PageView::VisibleIndices => view.visible_indices().len(),
        PageView::Dates | PageView::DatePreviews => view.date_groups().len(),
        PageView::Months => view.month_groups().len(),
        PageView::Navigation => usize::from(navigation.is_some()),
    }
}
pub(super) fn candidate_end(
    resource: &Resource,
    start: usize,
    limit: u16,
) -> Result<usize, WindowPoolError> {
    fit(start, resource.candidates.len(), limit, |index| {
        serialized_bytes(&resource.candidates[index], MAX_PAGE_BYTES)
    })
}
pub(super) fn read_end(
    view: &CalendarWindowView,
    selector: PageView,
    start: usize,
    limit: u16,
    navigation: Option<&super::resource::NavigationFrame>,
    display: Option<&crate::contract::calendar_window::EntryPresentation>,
) -> Result<usize, WindowPoolError> {
    fit(start, total(view, selector, navigation), limit, |index| {
        serialized_bytes(
            &Elements {
                view,
                selector,
                start: index,
                end: index + 1,
                navigation,
                display,
            },
            MAX_PAGE_BYTES,
        )
    })
}
fn fit(
    start: usize,
    total: usize,
    limit: u16,
    bytes: impl Fn(usize) -> Option<u64>,
) -> Result<usize, WindowPoolError> {
    if start > total {
        return Err(WindowPoolError::InvalidPage);
    }
    let mut end = start;
    // Small bounded scope/header overhead remains separate from the row data.
    let mut used = 16 * 1024u64;
    while end < total && end - start < usize::from(limit) {
        let next = bytes(end).ok_or(WindowPoolError::OutputLimit)?;
        if used.saturating_add(next).saturating_add(1) > MAX_PAGE_BYTES {
            break;
        }
        used += next + 1;
        end += 1;
    }
    if end == start && start < total {
        return Err(WindowPoolError::OutputLimit);
    }
    Ok(end)
}
impl Completion {
    pub fn serialize_current(&self) -> Result<Vec<u8>, WindowPoolError> {
        self.check()?;
        let out = match &self.reply {
            Reply::Unavailable { scope, reason, .. } => serialize(&frame(
                scope,
                "CALENDAR_WINDOW_UNAVAILABLE",
                Unavailable { reason },
            )),
            Reply::Prepared(r) => serialize(&frame(
                &r.scope,
                "CALENDAR_WINDOW_PREPARED",
                Prepared {
                    resource_id: r.id,
                    candidate_digest: &r.digest,
                    total: r.candidates.len() as u32,
                    bounds: &r.bounds,
                    projected_count: r.projected,
                },
            )),
            Reply::Candidates {
                resource: r,
                start,
                end,
            } => serialize(&frame(
                &r.scope,
                "CALENDAR_WINDOW_CANDIDATES",
                Candidates {
                    resource_id: r.id,
                    page: CandidatePage {
                        candidates: &r.candidates[*start..*end],
                        next_after: (*end < r.candidates.len()).then_some(*end as u32),
                        total: r.candidates.len() as u32,
                        candidate_digest: &r.digest,
                    },
                },
            )),
            Reply::Ready { resource: r, view } => serialize(&frame(
                &r.scope,
                "CALENDAR_WINDOW_READY",
                Ready {
                    resource_id: r.id,
                    bounds: &r.bounds,
                    projected_count: r.projected,
                    visible_count: view.visible_indices().len() as u32,
                    date_group_count: view.date_groups().len() as u32,
                    month_group_count: view.month_groups().len() as u32,
                },
            )),
            Reply::Read {
                resource: r,
                view,
                selector,
                start,
                end,
                total,
            } => serialize(&frame(
                &r.scope,
                "CALENDAR_WINDOW_PAGE",
                Read {
                    resource_id: r.id,
                    view: *selector,
                    page: Page {
                        items: Elements {
                            view,
                            selector: *selector,
                            start: *start,
                            end: *end,
                            navigation: r.navigation.as_ref(),
                            display: r
                                .scope
                                .presentation
                                .as_ref()
                                .and_then(|p| p.entries.as_ref()),
                        },
                        next_after: (end < total).then_some(*end as u32),
                        total: *total as u32,
                    },
                },
            )),
        }?;
        self.check()?;
        Ok(out)
    }
}
