//! Payroll forms retain only their native opening source, never report facts or
//! sender-supplied settings/seed proofs. Writes share the profile permit channel.
use super::*;
use crate::{
    input::{InputError, net_form::InitialNetSettings},
    runtime::{
        payroll_form::source::{PayrollSetupSubmit, PayrollSource, PayrollSourceMode},
        write_resource::{
            NativeWriteContext, NativeWritePermit, WriteContextStamp, WriteResourceError,
        },
    },
};
use serde::Deserialize;
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub(super) enum Event {
    View,
    AnnualSubmit { form: Value },
    SetupSubmit { input: PayrollSetupSubmit },
    TimingSubmit { choice: String },
    AnnualReset { year: i32 },
}
enum Submission {
    Settings(InitialNetSettings),
    Timing(String),
    Reset(i32),
}
struct WriteIo {
    context: NativeWriteContext,
    permit: NativeWritePermit,
}
struct Write {
    id: u64,
    submission: Submission,
    io: Option<WriteIo>,
}
pub(super) struct PayrollState {
    pub revision: u64,
    pub stamp: WriteContextStamp,
    source: PayrollSource,
    write: Option<Write>,
    next_write: u64,
    feedback: Option<Value>,
}
fn next(value: u64) -> Result<u64, FormResourceError> {
    value
        .checked_add(1)
        .filter(|value| *value <= crate::money::MAX_SAFE_INTEGER as u64)
        .ok_or(FormResourceError::Capacity)
}
fn error(error: InputError) -> Value {
    json!({"kind":"ERROR","error":{"name":error.name(),"message":error.message(),"userFacing":error.user_facing_message().is_some()}})
}
impl PayrollState {
    pub fn new(source: PayrollSource, stamp: WriteContextStamp) -> Result<Self, FormResourceError> {
        if source
            .retained_bytes()
            .is_none_or(|bytes| bytes > MAX_FORM_METADATA_BYTES as u64)
        {
            return Err(FormResourceError::OutputTooLarge);
        }
        Ok(Self {
            revision: 0,
            stamp,
            source,
            write: None,
            next_write: 0,
            feedback: None,
        })
    }
    pub fn check(&self, revision: u64) -> Result<(), FormResourceError> {
        if self.revision == revision {
            Ok(())
        } else {
            Err(FormResourceError::StaleResource)
        }
    }
    pub fn outcome(&self, id: u64) -> Value {
        let mut value = json!({"state":"PAYROLL_READY","resourceId":id,"resourceRevision":self.revision,"view":self.source.view(),"feedback":self.feedback});
        if let Some(write) = &self.write {
            value["state"] = json!(if write.io.is_some() {
                "WRITE_PERMIT_READY"
            } else {
                "WRITE_CONTEXT_REQUIRED"
            });
            value["writeId"] = json!(write.id);
        }
        value
    }
    /// true is the original no-change close effect; no SQL capability is minted.
    pub fn event(&mut self, event: &Event) -> Result<bool, FormResourceError> {
        if matches!(event, Event::View) {
            return Ok(false);
        }
        let revision = next(self.revision)?;
        if self.write.is_some() {
            self.revision = revision;
            return Ok(false);
        }
        let submission = match event {
            Event::View => unreachable!(),
            Event::AnnualSubmit { form } => {
                if self.source.mode() != PayrollSourceMode::Annual {
                    return Err(FormResourceError::InvalidHeader);
                }
                match self.source.prepare_annual(form) {
                    Ok(Some(settings)) => Ok(Some(Submission::Settings(settings))),
                    Ok(None) => Ok(None),
                    Err(error) => Err(error),
                }
            }
            Event::SetupSubmit { input } => {
                if self.source.mode() != PayrollSourceMode::Setup {
                    return Err(FormResourceError::InvalidHeader);
                }
                self.source
                    .prepare_setup(input)
                    .map(|settings| Some(Submission::Settings(settings)))
            }
            Event::TimingSubmit { choice } => {
                if self.source.mode() != PayrollSourceMode::Timing {
                    return Err(FormResourceError::InvalidHeader);
                }
                Ok(Some(Submission::Timing(choice.clone())))
            }
            Event::AnnualReset { year } => {
                if self.source.mode() != PayrollSourceMode::Annual
                    || year.to_string() != self.source.month()[..4]
                    || self.source.view()["presentation"]["resetGrossCents"].is_null()
                {
                    return Err(FormResourceError::InvalidHeader);
                }
                Ok(Some(Submission::Reset(*year)))
            }
        };
        self.revision = revision;
        match submission {
            Ok(Some(submission)) => {
                let id = next(self.next_write)?;
                self.next_write = id;
                self.write = Some(Write {
                    id,
                    submission,
                    io: None,
                });
                self.feedback = None;
                Ok(false)
            }
            Ok(None) => Ok(true),
            Err(e) => {
                self.feedback = Some(error(e));
                Ok(false)
            }
        }
    }
    fn write(&self, id: u64) -> Result<&Write, FormResourceError> {
        self.write
            .as_ref()
            .filter(|write| write.id == id)
            .ok_or(FormResourceError::StaleResource)
    }
    fn failure(&mut self, message: Option<InputError>) {
        let write = self.write.take().expect("checked native write");
        let fixed = match write.submission {
            Submission::Timing(_) => Some(
                "Der Auszahlungsmonat wurde nicht gespeichert. Bitte erneut laden und versuchen.",
            ),
            Submission::Reset(_) => Some(
                "Die automatische Berechnung konnte nicht übernommen werden. Bitte erneut versuchen.",
            ),
            Submission::Settings(_) => None,
        };
        self.feedback = Some(match fixed {
            Some(message) => error(InputError::source(message, "Error")),
            None => error(message.unwrap_or_else(|| {
                InputError::source(
                    match self.source.mode() {
                        PayrollSourceMode::Annual => {
                            "Die Änderung konnte nicht gespeichert werden."
                        }
                        PayrollSourceMode::Setup => "Die Angaben konnten nicht gesichert werden.",
                        PayrollSourceMode::Timing => unreachable!("fixed timing failure"),
                    },
                    "Error",
                )
            })),
        });
    }
    pub fn prepare_write(
        &mut self,
        id: u64,
        context: NativeWriteContext,
        epoch: i64,
    ) -> Result<(), FormResourceError> {
        let revision = next(self.revision)?;
        if context.stamp() != &self.stamp || self.write(id)?.io.is_some() {
            return Err(FormResourceError::StaleResource);
        }
        let result = match &self.write(id)?.submission {
            Submission::Settings(settings) => context.prepare_net(settings, epoch as f64),
            Submission::Timing(choice) => {
                context.prepare_timing(self.source.month(), choice, epoch as f64)
            }
            Submission::Reset(year) => context.prepare_annual_reset(*year, epoch as f64),
        };
        match result {
            Ok(permit) => {
                self.write.as_mut().expect("checked write").io = Some(WriteIo { context, permit })
            }
            Err(error) => self.failure(match error {
                WriteResourceError::Input(error) => Some(error),
                _ => None,
            }),
        }
        self.revision = revision;
        Ok(())
    }
    pub fn take(
        &self,
        id: u64,
    ) -> Result<crate::runtime::write_resource::TakenNativeWrite, FormResourceError> {
        let io = self
            .write(id)?
            .io
            .as_ref()
            .ok_or(FormResourceError::StaleResource)?;
        io.context
            .take(&io.permit)
            .map_err(|_| FormResourceError::StaleResource)
    }
    pub fn ack(&mut self, id: u64, stamp: WriteContextStamp) -> Result<(), FormResourceError> {
        let revision = next(self.revision)?;
        let io = self
            .write(id)?
            .io
            .as_ref()
            .ok_or(FormResourceError::StaleResource)?;
        io.context
            .acknowledge(&io.permit, stamp.clone())
            .map_err(|_| FormResourceError::StaleResource)?;
        self.write = None;
        self.stamp = stamp;
        self.revision = revision;
        Ok(())
    }
    pub fn abort(
        &mut self,
        id: u64,
        failure: &super::profile::IoFailure,
    ) -> Result<(), FormResourceError> {
        let revision = next(self.revision)?;
        let write = self.write(id)?;
        if let Some(io) = &write.io {
            io.context
                .abort(&io.permit)
                .map_err(|_| FormResourceError::StaleResource)?;
        }
        self.failure(match failure {
            super::profile::IoFailure::SourceChanged => Some(InputError::source(
                "Der Eintrag wurde zwischenzeitlich geändert. Bitte neu laden.",
                "ConcurrencyError",
            )),
            super::profile::IoFailure::IoFailed => None,
        });
        self.revision = revision;
        Ok(())
    }
}
