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
  padding,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";
import type { CalendarWidgetProps, WidgetDay } from "./calendar-widget-data";

// Registration/layout fallback; the SDK plugin installs the direct SwiftUI renderer.
export function CalendarWidget(props: CalendarWidgetProps, environment: WidgetEnvironment) {
  "widget";
  const small = environment.widgetFamily === "systemSmall";
  // Shared with every native service-widget size; constants stay in the isolated runtime.
  const dayFont = 14;
  const chipFont = 11;
  const lineHeight = 13;
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
    const first = day.shifts.find((shift) => !shift.ownerName) ?? day.shifts[0];
    const today = day.date === (props.todayDate ?? props.days[0].date);
    const chip = dark ? first?.dark : first?.light;
    const spoken = (first ? [first] : [])
      .map(
        (shift) =>
          `${shift.ownerName ? shift.ownerName + ", nur ansehen, " : ""}${shift.title}, ${shift.start ? shift.start + " bis " + shift.end + (shift.nextDay ? " am Folgetag" : "") : "ganztägig"}`,
      )
      .join("; ");
    return (
      <VStack
        key={day.date}
        spacing={2}
        modifiers={[
          frame({
            maxWidth: Infinity,
            maxHeight: Infinity,
            alignment: "top",
          }),
          accessibilityLabel(
            `${today ? "Heute, " : ""}${day.weekday}, ${day.shortDate}, ${spoken || "kein Eintrag"}`,
          ),
        ]}
      >
        <Text
          modifiers={[
            font({ size: dayFont, weight: today ? "semibold" : "regular" }),
            foregroundStyle(tinted ? primary : today ? colors.onToday : colors.text),
            frame({ minWidth: 28, minHeight: 20 }),
            ...(today ? [background(colors.today)] : []),
            cornerRadius(10),
            padding({ bottom: 6 }),
          ]}
        >
          {String(Number(day.date.slice(-2)))}
        </Text>
        {first ? (
          <HStack spacing={0} modifiers={[frame({ maxWidth: Infinity }), cornerRadius(2)]}>
            {first.ownerColor ? (
              <VStack
                modifiers={[
                  frame({ width: 3, height: lineHeight * (first.detail ? 2 : 1) }),
                  background(first.ownerColor),
                ]}
              >
                {null}
              </VStack>
            ) : null}
            <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity })]}>
              <Text
                modifiers={[
                  font({ size: chipFont, weight: "medium" }),
                  foregroundStyle(
                    tinted
                      ? primary
                      : first.ownerColor
                        ? (chip?.onDetail ?? first.textColor)
                        : (props.chipStyle?.textColor ?? first.textColor),
                  ),
                  background((first.ownerColor ? chip?.detail : chip?.main) ?? first.color),
                  frame({ maxWidth: Infinity, minHeight: lineHeight }),
                  lineLimit(1),
                  minimumScaleFactor(0.7),
                ]}
              >
                {first.displayLabel ?? first.title}
              </Text>
              {first.detail ? (
                <Text
                  modifiers={[
                    font({ size: chipFont }),
                    foregroundStyle(tinted ? primary : (chip?.onDetail ?? first.textColor)),
                    background(chip?.detail ?? first.color),
                    frame({ maxWidth: Infinity, minHeight: lineHeight }),
                    lineLimit(1),
                  ]}
                >
                  {first.detail}
                </Text>
              ) : null}
            </VStack>
          </HStack>
        ) : null}
      </VStack>
    );
  }
  return (
    <VStack
      spacing={0}
      modifiers={[
        containerBackground(colors.background, "widget"),
        widgetURL(destination),
        frame({ maxWidth: Infinity, maxHeight: Infinity }),
      ]}
    >
      {rows.map((row) => (
        <HStack
          key={row[0].date}
          spacing={2}
          alignment="top"
          modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: "top" })]}
        >
          {row.map(dayCell)}
        </HStack>
      ))}
    </VStack>
  );
}
export default createWidget("LUNAShiftCalendar", CalendarWidget);
