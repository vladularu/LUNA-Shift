import { editorDutyDuration, editorDutyTariff } from "./special-duty-editor-state";
import { calculateTimedShiftMinutes } from "@/engine/working-time";
import { DayEditorSpecialDutyFields } from "./day-editor-special-duty";
import { TextInput } from "@/ui/text";
import { router, Stack, useFocusEffect, useNavigation } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePreventRemove, type NavigationAction } from "expo-router/react-navigation";
import { Alert, Keyboard } from "react-native";
import {
  usePflegeShiftEntries,
  usePflegeShiftProfile,
  usePflegeShiftTemplates,
} from "@/application/pflegeshift-provider";
import { useRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import { type CalendarEntry, type EntryLocation, type ShiftType } from "@/domain/types";
import { userFacingErrorMessage } from "@/domain/errors";
import { ValidationError } from "@/domain/validation";
import { AppointmentEditOverlay } from "@/features/day-editor/appointment-edit-overlay";
import { resolveShiftTypePreset } from "@/features/day-editor/shift-type-preset";
import { ShiftEditOverlay } from "@/features/day-editor/shift-edit-overlay";
import { useEntryEditorDraft } from "@/features/day-editor/use-entry-editor-draft";
import { criticalIssueForSavedShift } from "@/features/day-editor/saved-shift-compliance";
import { AlarmSheet, NotificationSheet, PauseSheet } from "@/features/day-editor/entry-options";
import {
  consumeLocationSelection,
  prepareLocationPicker,
} from "@/features/location/location-selection";
import { useStableEditorSession } from "@/features/editor-session";
import { APPOINTMENT_COLOR } from "@/theme/palette";
import { deletionFeedback, selectionFeedback, warningFeedback } from "@/ui/haptics";
import {
  focusInvalidField,
  integerRangeFieldError,
  requiredFieldError,
} from "@/ui/form-validation";
import { locationPickerRoute } from "@/navigation/routes";

type EditorMode = "SHIFT" | "APPOINTMENT";
export function DayEditorForm({
  date,
  existing: loadedExisting,
  onDeletionChange,
  requestedMode,
  sessionKey,
}: {
  readonly date: string;
  readonly existing: CalendarEntry | null;
  readonly onDeletionChange: (entry: CalendarEntry | null) => void;
  readonly requestedMode: EditorMode;
  readonly sessionKey: string;
}) {
  const navigation = useNavigation();
  const { profile } = usePflegeShiftProfile();
  const { templates } = usePflegeShiftTemplates();
  const { entries, removeEntry, upsertShift, upsertAppointment } = usePflegeShiftEntries();
  const { resolver: ruleResolver } = useRuleCatalogRuntime();
  const { initialValue: existing } = useStableEditorSession(sessionKey, () => loadedExisting);
  const mode: EditorMode = existing?.kind ?? requestedMode;
  const initialShift = existing?.kind === "SHIFT" ? existing : null;
  const initialAppointment = existing?.kind === "APPOINTMENT" ? existing : null;
  const draftState = useEntryEditorDraft(initialShift, initialAppointment, mode);
  const [specialDuty, setSpecialDuty] = draftState.specialDuty;
  const [shiftType, setShiftType] = draftState.shiftType;
  const [shiftAllDay, setShiftAllDay] = draftState.shiftAllDay;
  const [selectedTemplateId, setSelectedTemplateId] = draftState.selectedTemplateId;
  const [shiftTitle, setShiftTitle] = draftState.shiftTitle;
  const [startTime, setStartTime] = draftState.startTime;
  const [endTime, setEndTime] = draftState.endTime;
  const [breakMinutes, setBreakMinutes] = draftState.breakMinutes;
  const [shiftColor, setShiftColor] = draftState.shiftColor;
  const [shiftSymbol, setShiftSymbol] = draftState.shiftSymbol;
  const [shiftNote, setShiftNote] = draftState.shiftNote;
  const [shiftNotification, setShiftNotification] = draftState.shiftNotification;
  const [shiftAlarmEnabled, setShiftAlarmEnabled] = draftState.shiftAlarmEnabled;
  const [shiftLocation, setShiftLocation] = draftState.shiftLocation;
  const [overtimeMinutes, setOvertimeMinutes] = draftState.overtimeMinutes;
  const [tariffOvertimeConfirmed, setTariffOvertimeConfirmed] = draftState.tariffOvertimeConfirmed;
  const holidayPremiumMode = initialShift?.holidayPremiumMode ?? "WITH_TIME_OFF";
  const [appointmentTitle, setAppointmentTitle] = draftState.appointmentTitle;
  const [allDay, setAllDay] = draftState.allDay;
  const [appointmentStart, setAppointmentStart] = draftState.appointmentStart;
  const [appointmentEnd, setAppointmentEnd] = draftState.appointmentEnd;
  const appointmentColor = initialAppointment?.color ?? APPOINTMENT_COLOR;
  const [appointmentNote, setAppointmentNote] = draftState.appointmentNote;
  const [appointmentRecurrence, setAppointmentRecurrence] = draftState.appointmentRecurrence;
  const [appointmentNotification, setAppointmentNotification] = draftState.appointmentNotification;
  const [appointmentLocation, setAppointmentLocation] = draftState.appointmentLocation;
  const [optionSheet, setOptionSheet] = useState<
    "ALARM" | "PAUSE" | "RECURRENCE" | "NOTIFICATION" | null
  >(null);
  const [breakError, setBreakError] = useState<string | null>(null);
  const [appointmentTitleError, setAppointmentTitleError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { hasChanges } = draftState;
  const shiftTitleRef = useRef<TextInput>(null);
  const breakRef = useRef<TextInput>(null);
  const overtimeRef = useRef<TextInput>(null);
  const appointmentTitleRef = useRef<TextInput>(null);
  const savingRef = useRef(false);
  const [exit, setExit] = useState<{ action?: NavigationAction } | null>(null);
  const exitHandled = useRef(false);
  useFocusEffect(
    useCallback(() => {
      const selected = consumeLocationSelection();
      if (selected === undefined) return;
      if (mode === "SHIFT") setShiftLocation(selected);
      else setAppointmentLocation(selected);
    }, [mode, setAppointmentLocation, setShiftLocation]),
  );
  function openLocationPicker(current: EntryLocation | null) {
    prepareLocationPicker(current);
    router.push(locationPickerRoute() as never);
  }
  const shiftIsAbsence = ["VACATION", "SICK", "FREE"].includes(shiftType);
  const shiftIsTimed = !shiftIsAbsence && !shiftAllDay;

  function chooseType(type: ShiftType) {
    const preset = resolveShiftTypePreset(type, templates);
    setSpecialDuty(null);
    setShiftType(type);
    setShiftAllDay(preset.allDay ?? ["VACATION", "SICK", "FREE"].includes(type));
    setSelectedTemplateId(preset.templateId);
    setShiftTitle(preset.title);
    setStartTime(preset.startTime ?? "08:00");
    setEndTime(preset.endTime ?? "16:00");
    setBreakMinutes(String(preset.breakMinutes));
    setShiftColor(preset.color);
    setShiftSymbol(preset.symbol);
    selectionFeedback();
  }

  async function save(closeAfterSave = true): Promise<boolean> {
    if (savingRef.current) return false;
    if (!hasChanges) {
      if (closeAfterSave) setExit({});
      return true;
    }
    const nextShiftTitleError =
      mode === "SHIFT" ? requiredFieldError(shiftTitle, "Bezeichnung") : null;
    const nextBreakError =
      mode === "SHIFT" && shiftIsTimed
        ? integerRangeFieldError(breakMinutes, "Pause", 0, 1_440)
        : null;
    let nextOvertimeError =
      mode === "SHIFT" && shiftIsTimed
        ? integerRangeFieldError(overtimeMinutes, "Überstunden", 0, 1_440)
        : null;
    const nextAppointmentTitleError =
      mode === "APPOINTMENT" ? requiredFieldError(appointmentTitle, "Titel") : null;
    if (
      nextOvertimeError === null &&
      mode === "SHIFT" &&
      shiftIsTimed &&
      profile &&
      nextBreakError === null
    ) {
      const netMinutes = calculateTimedShiftMinutes(
        { date, startTime, endTime, breakMinutes: Number(breakMinutes) },
        profile.timeZone,
      );
      if (Number(overtimeMinutes) > netMinutes) {
        nextOvertimeError = "Überstunden dürfen die Nettoarbeitszeit nicht überschreiten.";
      }
    }
    setBreakError(nextBreakError);
    setAppointmentTitleError(nextAppointmentTitleError);
    const firstError =
      nextShiftTitleError ?? nextBreakError ?? nextOvertimeError ?? nextAppointmentTitleError;
    if (firstError) {
      setError(firstError);
      focusInvalidField(
        nextShiftTitleError
          ? shiftTitleRef
          : nextBreakError
            ? breakRef
            : nextOvertimeError
              ? overtimeRef
              : appointmentTitleRef,
        firstError,
      );
      return false;
    }
    try {
      savingRef.current = true;
      setSaving(true);
      setError(null);
      if (mode === "SHIFT") {
        const overtime = shiftIsTimed ? Number(overtimeMinutes) : 0;
        const breakValue = shiftIsTimed ? Number(breakMinutes) : 0;
        if (profile && shiftIsTimed) {
          const netMinutes = calculateTimedShiftMinutes(
            { date, startTime, endTime, breakMinutes: breakValue },
            profile.timeZone,
          );
          if (overtime > netMinutes) {
            throw new ValidationError(
              "Überstunden dürfen die Nettoarbeitszeit nicht überschreiten.",
            );
          }
        }
        const saved = await upsertShift({
          ...(initialShift ? { id: initialShift.id, expectedRevision: initialShift.revision } : {}),
          date: initialShift?.date ?? date,
          specialDuty,
          templateId: shiftIsTimed ? selectedTemplateId : null,
          title: shiftTitle,
          type: shiftType,
          allDay: shiftIsAbsence || shiftAllDay,
          startTime: shiftIsAbsence ? null : startTime,
          endTime: shiftIsAbsence ? null : endTime,
          breakMinutes: breakValue,
          color: shiftColor,
          symbol: shiftSymbol,
          note: shiftNote,
          notification: shiftNotification,
          alarmEnabled: shiftIsTimed ? shiftAlarmEnabled : false,
          location: shiftLocation,
          overtimeMinutes: overtime,
          tariffOvertimeConfirmed: overtime > 0 && tariffOvertimeConfirmed,
          holidayPremiumMode,
        });
        if (profile && shiftIsTimed) {
          const critical = criticalIssueForSavedShift(saved, entries, profile, ruleResolver);
          if (critical) Alert.alert("ArbZG-Hinweis", critical.title);
        }
      } else {
        await upsertAppointment({
          ...(initialAppointment
            ? { id: initialAppointment.id, expectedRevision: initialAppointment.revision }
            : {}),
          date: initialAppointment?.date ?? date,
          title: appointmentTitle,
          allDay,
          startTime: allDay ? null : appointmentStart,
          endTime: allDay ? null : appointmentEnd,
          color: appointmentColor,
          note: appointmentNote,
          recurrence: appointmentRecurrence,
          notification: appointmentNotification,
          location: appointmentLocation,
        });
      }
      if (closeAfterSave) {
        setExit({});
      }
      return true;
    } catch (saveError) {
      warningFeedback();
      setError(userFacingErrorMessage(saveError, "Eintrag konnte nicht gespeichert werden."));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function deleteEntry() {
    if (!existing || savingRef.current) return;
    try {
      savingRef.current = true;
      setSaving(true);
      setError(null);
      onDeletionChange(existing);
      await removeEntry(existing);
      deletionFeedback();
      setExit({});
    } catch (deleteError) {
      onDeletionChange(null);
      warningFeedback();
      setError(userFacingErrorMessage(deleteError, "Eintrag konnte nicht gelöscht werden."));
      savingRef.current = false;
      setSaving(false);
    }
  }

  function confirmDeleteEntry(title: string, message: string) {
    Alert.alert(title, message, [
      { text: "Abbrechen", style: "cancel" },
      { text: "Löschen", style: "destructive", onPress: () => void deleteEntry() },
    ]);
  }

  // Let iOS track the finger freely when an existing entry has no edits.
  // Unsaved drafts and in-flight operations still require validation and persistence.
  usePreventRemove(exit === null && (hasChanges || saving), ({ data }) => {
    if (savingRef.current) return;
    Keyboard.dismiss();
    void save(false).then((saved) => {
      if (saved) setExit({ action: data.action });
    });
  });
  useEffect(() => {
    if (!exit || exitHandled.current) return;
    exitHandled.current = true;
    if (exit.action) navigation.dispatch(exit.action);
    else router.back();
  }, [exit, navigation]);

  if (mode === "SHIFT") {
    const durationMinutes = editorDutyDuration(
      shiftIsTimed,
      {
        date: initialShift?.date ?? date,
        startTime,
        endTime,
        breakMinutes: Number(breakMinutes) || 0,
        allDay: false,
        specialDuty,
      },
      profile?.timeZone ?? "Europe/Berlin",
    );
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <ShiftEditOverlay
          specialDutyKind={specialDuty?.kind}
          specialDutyFields={
            shiftIsTimed && shiftType !== "TRAINING" ? (
              <DayEditorSpecialDutyFields
                tariffFamily={editorDutyTariff(profile, initialShift?.date ?? date)}
                draft={draftState}
                date={initialShift?.date ?? date}
                timeZone={profile?.timeZone ?? "Europe/Berlin"}
              />
            ) : undefined
          }
          alarmEnabled={shiftAlarmEnabled}
          breakMinutes={breakMinutes}
          busy={saving}
          date={initialShift?.date ?? date}
          durationMinutes={durationMinutes}
          endTime={endTime}
          error={error}
          location={shiftLocation}
          note={shiftNote}
          notification={shiftNotification}
          onAlarmPress={() => setOptionSheet("ALARM")}
          onBreakMinutesChange={(value) => {
            setBreakMinutes(String(value));
            if (breakError) setBreakError(null);
          }}
          onBreakPress={() => setOptionSheet("PAUSE")}
          onDismiss={() => {
            setExit({});
          }}
          onDelete={
            initialShift
              ? () =>
                  confirmDeleteEntry(
                    "Dienst löschen?",
                    "Dieser Dienst wird aus dem Kalender entfernt.",
                  )
              : undefined
          }
          onEndTimeChange={setEndTime}
          onLocationPress={() => openLocationPicker(shiftLocation)}
          onNoteChange={setShiftNote}
          onNotificationChange={setShiftNotification}
          onNotificationPress={() => setOptionSheet("NOTIFICATION")}
          onOvertimeMinutesChange={setOvertimeMinutes}
          onRequestClose={() => save(false)}
          onShiftTypeChange={chooseType}
          onStartTimeChange={setStartTime}
          onTariffOvertimeConfirmedChange={setTariffOvertimeConfirmed}
          overtimeInputRef={overtimeRef}
          overtimeMinutes={overtimeMinutes}
          shiftColor={shiftColor}
          shiftIsTimed={shiftIsTimed}
          shiftSymbol={shiftSymbol}
          shiftTitle={shiftTitle}
          shiftType={shiftType}
          startTime={startTime}
          tariffOvertimeConfirmed={tariffOvertimeConfirmed}
        />
        {optionSheet === "NOTIFICATION" ? (
          <NotificationSheet
            deferredSelection
            onChange={setShiftNotification}
            onClose={() => setOptionSheet(null)}
            value={shiftNotification}
          />
        ) : null}
        {optionSheet === "PAUSE" ? (
          <PauseSheet
            onChange={(value) => {
              setBreakMinutes(String(value));
              if (breakError) setBreakError(null);
            }}
            onClose={() => setOptionSheet(null)}
            value={Number(breakMinutes) || 0}
          />
        ) : null}
        {optionSheet === "ALARM" ? (
          <AlarmSheet
            onChange={setShiftAlarmEnabled}
            onClose={() => setOptionSheet(null)}
            value={shiftAlarmEnabled}
          />
        ) : null}
      </>
    );
  }

  const durationMinutes = allDay
    ? null
    : calculateTimedShiftMinutes(
        {
          date,
          startTime: appointmentStart,
          endTime: appointmentEnd,
          breakMinutes: 0,
          allDay: false,
        },
        profile?.timeZone ?? "Europe/Berlin",
      );
  const isSeries = Boolean(initialAppointment?.recurrence);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <AppointmentEditOverlay
        allDay={allDay}
        appointmentColor={appointmentColor}
        busy={saving}
        date={date}
        durationMinutes={durationMinutes}
        endTime={appointmentEnd}
        error={error}
        location={appointmentLocation}
        note={appointmentNote}
        notification={appointmentNotification}
        onAllDayChange={setAllDay}
        onDelete={
          initialAppointment
            ? () =>
                confirmDeleteEntry(
                  isSeries ? "Terminserie löschen?" : "Termin löschen?",
                  isSeries
                    ? "Alle Termine dieser Serie werden gelöscht."
                    : "Dieser Termin wird aus dem Kalender entfernt.",
                )
            : undefined
        }
        onDismiss={() => setExit({})}
        onEndTimeChange={setAppointmentEnd}
        onLocationPress={() => openLocationPicker(appointmentLocation)}
        onNoteChange={setAppointmentNote}
        onNotificationChange={setAppointmentNotification}
        onNotificationPress={() => setOptionSheet("NOTIFICATION")}
        onRecurrenceChange={setAppointmentRecurrence}
        onRequestClose={() => save(false)}
        onStartTimeChange={setAppointmentStart}
        onTitleChange={(value) => {
          setAppointmentTitle(value);
          if (appointmentTitleError) setAppointmentTitleError(null);
        }}
        recurrence={appointmentRecurrence}
        startTime={appointmentStart}
        title={appointmentTitle}
      />
      {optionSheet === "NOTIFICATION" ? (
        <NotificationSheet
          onChange={setAppointmentNotification}
          onClose={() => setOptionSheet(null)}
          value={appointmentNotification}
        />
      ) : null}
    </>
  );
}
