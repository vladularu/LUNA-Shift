import { HStack, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  background,
  containerBackground,
  cornerRadius,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";
import type { CalendarWidgetProps, WidgetDay } from "./calendar-widget-data";

// Registration/layout fallback; the SDK plugin installs the direct SwiftUI renderer.
export function CalendarWidget(props: CalendarWidgetProps, environment: WidgetEnvironment) {
  "widget";
  const small = environment.widgetFamily === "systemSmall";
  const dark =
    props?.themeMode === "dark" ||
    (props?.themeMode !== "light" && environment.colorScheme === "dark");
  const colors = dark ? props?.dark : props?.light;
  const destination = props?.url ?? "pflegeshift:///";
  if (!colors || props.state !== "ready" || !props.days?.length) {
    return (
      <VStack spacing={8} modifiers={[widgetURL(destination)]}>
        <Text>LUNA Shift</Text>
        <Text>
          {props?.state === "expired"
            ? "Kalender aktualisieren"
            : "Dein Dienstplan auf einen Blick"}
        </Text>
      </VStack>
    );
  }
  const columns = small ? 3 : 7;
  const count = small ? 6 : environment.widgetFamily === "systemLarge" ? 28 : 14;
  const days = (small ? props.days : (props.weekDays ?? props.days)).slice(0, count);
  const rows = Array.from({ length: Math.ceil(days.length / columns) }, (_, index) =>
    days.slice(index * columns, (index + 1) * columns),
  );
  const tinted = environment.widgetRenderingMode !== "fullColor";
  const primary = tinted
    ? { type: "hierarchical" as const, style: "primary" as const }
    : colors.text;
  function dayCell(day: WidgetDay) {
    const first = day.shifts[0];
    const today = day.date === (props.todayDate ?? props.days[0].date);
    const chip = dark ? first?.dark : first?.light;
    const spoken = day.shifts
      .map(
        (shift) =>
          `${shift.title}, ${shift.start ? shift.start + " bis " + shift.end + (shift.nextDay ? " am Folgetag" : "") : "ganztägig"}`,
      )
      .join("; ");
    return (
      <VStack
        key={day.date}
        spacing={3}
        modifiers={[
          frame({ maxWidth: Infinity }),
          accessibilityLabel(
            `${today ? "Heute, " : ""}${day.weekday}, ${day.shortDate}, ${spoken || "kein Eintrag"}`,
          ),
        ]}
      >
        <Text
          modifiers={[
            font({ size: 12, weight: today ? "semibold" : "regular" }),
            foregroundStyle(tinted ? primary : today ? colors.onToday : colors.text),
            frame({ minWidth: 25, minHeight: 18 }),
            ...(today ? [background(colors.today)] : []),
            cornerRadius(9),
          ]}
        >
          {String(Number(day.date.slice(-2)))}
        </Text>
        {first ? (
          <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity }), cornerRadius(2)]}>
            <Text
              modifiers={[
                font({ size: 10, weight: "medium" }),
                foregroundStyle(tinted ? primary : (props.chipStyle?.textColor ?? first.textColor)),
                background(chip?.main ?? first.color),
                frame({ maxWidth: Infinity, minHeight: 12 }),
                lineLimit(1),
                minimumScaleFactor(0.7),
              ]}
            >
              {first.displayLabel ?? first.title}
            </Text>
            {first.detail ? (
              <Text
                modifiers={[
                  font({ size: 10 }),
                  foregroundStyle(tinted ? primary : (chip?.onDetail ?? first.textColor)),
                  background(chip?.detail ?? first.color),
                  frame({ maxWidth: Infinity, minHeight: 12 }),
                  lineLimit(1),
                ]}
              >
                {first.detail}
              </Text>
            ) : null}
          </VStack>
        ) : null}
        {day.shifts.length > 1 ? (
          <Text
            modifiers={[font({ size: 8 }), foregroundStyle(primary)]}
          >{`+${day.shifts.length - 1}`}</Text>
        ) : null}
      </VStack>
    );
  }
  return (
    <VStack
      spacing={8}
      modifiers={[
        containerBackground(colors.background, "widget"),
        widgetURL(destination),
        frame({ maxWidth: Infinity, maxHeight: Infinity }),
      ]}
    >
      {rows.map((row) => (
        <HStack key={row[0].date} spacing={2} alignment="top">
          {row.map(dayCell)}
        </HStack>
      ))}
    </VStack>
  );
}
export default createWidget("LUNAShiftCalendar", CalendarWidget);
