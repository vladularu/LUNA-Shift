import type { SpecialDuty } from "@/domain/special-duty";
import { useState } from "react";

import type {
  Appointment,
  EntryLocation,
  EntryNotification,
  RecurrenceRule,
  ShiftEntry,
  ShiftType,
} from "@/domain/types";
import { SHIFT_TYPE_COLORS } from "@/theme/palette";

export function useEntryEditorDraft(
  initialShift: ShiftEntry | null,
  initialAppointment: Appointment | null,
  mode: "SHIFT" | "APPOINTMENT",
) {
  const specialDuty = useState<SpecialDuty | null>(initialShift?.specialDuty ?? null);
  const shiftType = useState<ShiftType>(initialShift?.type ?? "CUSTOM");
  const shiftAllDay = useState(initialShift?.allDay ?? false);
  const selectedTemplateId = useState(initialShift?.templateId ?? null);
  const shiftTitle = useState(initialShift?.title ?? "Dienst");
  const startTime = useState(initialShift?.startTime ?? "08:00");
  const endTime = useState(initialShift?.endTime ?? "16:00");
  const breakMinutes = useState(String(initialShift?.breakMinutes ?? 30));
  const shiftColor = useState(initialShift?.color ?? SHIFT_TYPE_COLORS.CUSTOM);
  const shiftSymbol = useState(initialShift?.symbol ?? "D");
  const shiftNote = useState(initialShift?.note ?? "");
  const shiftNotification = useState<EntryNotification | null>(initialShift?.notification ?? null);
  const shiftAlarmEnabled = useState(initialShift?.alarmEnabled ?? false);
  const shiftLocation = useState<EntryLocation | null>(initialShift?.location ?? null);
  const overtimeMinutes = useState(String(initialShift?.overtimeMinutes ?? 0));
  const tariffOvertimeConfirmed = useState(initialShift?.tariffOvertimeConfirmed ?? false);
  const appointmentTitle = useState(initialAppointment?.title ?? "Ohne Titel");
  const allDay = useState(initialAppointment?.allDay ?? false);
  const appointmentStart = useState(initialAppointment?.startTime ?? "12:00");
  const appointmentEnd = useState(initialAppointment?.endTime ?? "13:00");
  const appointmentNote = useState(initialAppointment?.note ?? "");
  const appointmentRecurrence = useState<RecurrenceRule | null>(
    initialAppointment?.recurrence ?? null,
  );
  const appointmentNotification = useState<EntryNotification | null>(
    initialAppointment?.notification ?? null,
  );
  const appointmentLocation = useState<EntryLocation | null>(initialAppointment?.location ?? null);
  const draft = JSON.stringify(
    mode === "SHIFT"
      ? [
          shiftType[0],
          specialDuty[0],
          shiftAllDay[0],
          selectedTemplateId[0],
          shiftTitle[0],
          startTime[0],
          endTime[0],
          breakMinutes[0],
          shiftColor[0],
          shiftSymbol[0],
          shiftNote[0],
          shiftNotification[0],
          shiftAlarmEnabled[0],
          shiftLocation[0],
          overtimeMinutes[0],
          tariffOvertimeConfirmed[0],
        ]
      : [
          appointmentTitle[0],
          allDay[0],
          appointmentStart[0],
          appointmentEnd[0],
          appointmentNote[0],
          appointmentRecurrence[0],
          appointmentNotification[0],
          appointmentLocation[0],
        ],
  );
  const [initialDraft] = useState(draft);
  return {
    // Opening an appointment sheet alone must not create its default values.
    hasChanges: (mode === "SHIFT" && initialShift === null) || draft !== initialDraft,
    specialDuty,
    shiftType,
    shiftAllDay,
    selectedTemplateId,
    shiftTitle,
    startTime,
    endTime,
    breakMinutes,
    shiftColor,
    shiftSymbol,
    shiftNote,
    shiftNotification,
    shiftAlarmEnabled,
    shiftLocation,
    overtimeMinutes,
    tariffOvertimeConfirmed,
    appointmentTitle,
    allDay,
    appointmentStart,
    appointmentEnd,
    appointmentNote,
    appointmentRecurrence,
    appointmentNotification,
    appointmentLocation,
  };
}
