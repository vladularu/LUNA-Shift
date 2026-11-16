//! Private, resource-bound calendar/catalog intake. Review commands never
//! replace the global report snapshot or reinterpret UI output as source data.
use super::*;
use crate::runtime::day_editor_review::{NativeDayReviewAssembly, NativeDayReviewSource};

#[derive(Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum CandidateFamily {
    Calendar,
    Catalog,
}
pub(super) enum ReviewSlot {
    Building(Box<NativeDayReviewAssembly>),
    Ready(Box<NativeDayReviewSource>),
    Unavailable,
}
fn invalid() -> FormResourceError {
    FormResourceError::InvalidSource
}
impl DayState {
    /// None means an ordinary form event. This method runs only while the
    /// existing Resource lock, native revision and core/owner fence are held.
    pub(in crate::runtime::form_resource) fn review_event(
        &mut self,
        event: &Event,
        raw: &[u8],
        epoch: i64,
    ) -> Result<Option<Value>, FormResourceError> {
        let frame = match event {
            Event::ReviewBegin { stamp } => {
                if !raw.is_empty() {
                    return Err(FormResourceError::InvalidHeader);
                }
                if self.terminal || self.write.is_some() || stamp != &self.stamp {
                    return Err(FormResourceError::StaleResource);
                }
                let assembly = NativeDayReviewAssembly::new(
                    Arc::clone(self.controller.source()),
                    stamp.clone(),
                    epoch,
                )
                .map_err(|_| invalid())?;
                self.review = Some(ReviewSlot::Building(Box::new(assembly)));
                json!({"state":"SOURCE_OPEN"})
            }
            Event::ReviewCalendar { source } => {
                self.review_builder()?
                    .calendar(source, raw)
                    .map_err(|_| invalid())?;
                json!({"state":"SOURCE_OPEN"})
            }
            Event::ReviewCatalog {
                catalog_kind,
                source,
            } => {
                self.review_builder()?
                    .catalog(*catalog_kind, source, raw)
                    .map_err(|_| invalid())?;
                json!({"state":"SOURCE_OPEN"})
            }
            Event::ReviewPrepare => {
                if !raw.is_empty() {
                    return Err(FormResourceError::InvalidHeader);
                }
                self.review_builder()?.prepare().map_err(|_| invalid())?;
                json!({"state":"CANDIDATES_READY"})
            }
            Event::ReviewCandidates { family, offset } => {
                if !raw.is_empty() {
                    return Err(FormResourceError::InvalidHeader);
                }
                let builder = self.review_builder()?;
                let candidates = match family {
                    CandidateFamily::Calendar => builder.calendar_candidates(),
                    CandidateFamily::Catalog => builder.catalog_candidates(),
                }
                .map_err(|_| invalid())?;
                if *offset > candidates.len() {
                    return Err(FormResourceError::InvalidHeader);
                }
                let mut items = Vec::new();
                let mut bytes = 0usize;
                for item in candidates.iter().skip(*offset).take(128) {
                    let size = serde_json::to_vec(item).map_err(|_| invalid())?.len();
                    if bytes.saturating_add(size) > 128 * 1024 {
                        if items.is_empty() {
                            return Err(FormResourceError::OutputTooLarge);
                        }
                        break;
                    }
                    bytes += size;
                    items.push(item);
                }
                json!({"state":"CANDIDATE_PAGE","offset":offset,
                    "nextOffset":offset+items.len(),"total":candidates.len(),"items":items})
            }
            Event::ReviewFinish => {
                self.review_builder()?;
                let value = crate::contract::bounded_json(raw)
                    .map_err(|_| FormResourceError::InvalidHeader)?;
                let obj = value
                    .as_object()
                    .filter(|o| {
                        o.len() == 2
                            && o.contains_key("calendarRanks")
                            && o.contains_key("catalogRanks")
                    })
                    .ok_or(FormResourceError::InvalidHeader)?;
                let calendar = serde_json::to_vec(&obj["calendarRanks"]).map_err(|_| invalid())?;
                let catalog = serde_json::to_vec(&obj["catalogRanks"]).map_err(|_| invalid())?;
                let Some(ReviewSlot::Building(builder)) = self.review.take() else {
                    return Err(FormResourceError::StaleResource);
                };
                match builder.finish(&calendar, &catalog).map_err(|_| invalid())? {
                    Some(source) => {
                        self.review = Some(ReviewSlot::Ready(Box::new(source)));
                        json!({"state":"READY"})
                    }
                    None => {
                        self.review = Some(ReviewSlot::Unavailable);
                        json!({"state":"UNAVAILABLE","code":"PROFILE_MISSING"})
                    }
                }
            }
            _ => return Ok(None),
        };
        Ok(Some(frame))
    }
    fn review_builder(&mut self) -> Result<&mut NativeDayReviewAssembly, FormResourceError> {
        if self.terminal || self.write.is_some() {
            return Err(FormResourceError::StaleResource);
        }
        match self.review.as_mut() {
            Some(ReviewSlot::Building(builder)) => Ok(builder),
            _ => Err(FormResourceError::StaleResource),
        }
    }
}
