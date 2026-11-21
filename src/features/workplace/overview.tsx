import Icon from "@/ui/icon";
import { Fragment } from "react";
import { usePalette } from "@/theme/palette";
import { View } from "react-native";
import { SectionHeader, SurfaceCard, RowButton, CardSeparator } from "@/ui/design-system";
import {
  hasAgreedRestLimit,
  questionIds,
  rulesAt,
  type QuestionId,
  type WorkplaceData,
  type WorkplaceRule,
} from "@/domain/workplace-rules";
import { topics } from "./questions";
import { Headline } from "./flow-layout";
export const ruleGroups: { name: string; ids: readonly QuestionId[] }[] = [
  { name: "Dienstplanung", ids: ["week", "series", "weekend"] },
  { name: "Nachtarbeit", ids: ["night", "recovery"] },
  { name: "Arbeits- und Ruhezeit", ids: ["rest", "switch", "duration"] },
];
export const topicIcons = {
  week: "calendar-outline",
  series: "repeat-outline",
  weekend: "calendar-outline",
  night: "moon-outline",
  recovery: "bed-outline",
  rest: "hourglass-outline",
  switch: "swap-vertical-outline",
  duration: "time-outline",
  time: "time-outline",
} as const;
export const topicStep: Record<QuestionId, number> = {
  week: 1,
  series: 2,
  weekend: 3,
  night: 4,
  recovery: 4,
  rest: 5,
  switch: 5,
  duration: 6,
};
export const shiftLabels = { EARLY: "Frühdienst", LATE: "Spätdienst", NIGHT: "Nachtdienst" };
export function ruleSummary(id: QuestionId, r?: WorkplaceRule): string {
  if (!r) return "Noch offen";
  switch (r.mode) {
    case "unknown":
      return "Weiß ich nicht";
    case "none":
      return "Keine feste Regel";
    case "limit":
      return (
        "Höchstens " +
        r.count +
        " " +
        (id === "night" ? (r.count === 1 ? "Nacht" : "Nächte") : r.count === 1 ? "Tag" : "Tage")
      );
    case "average":
      return "Ø " + r.count.toLocaleString("de-DE") + " Tage über " + r.weeks + " Wochen";
    case "alternate":
      return "Jedes zweite Wochenende";
    case "monthly":
      return r.count + " freie WE pro Monat";
    case "rolling":
      return r.count + " freie WE in " + r.weeks + " Wochen";
    case "off":
      return id === "night" ? "Keine Nachtdienste" : "Keine Wochenendarbeit";
    case "recovery":
      return (
        r.count +
        (r.unit === "hours" ? " Std." : " volle Tage") +
        " frei ab " +
        r.nights +
        " Nächten"
      );
    case "rest":
      return (
        "Mindestens " +
        (r.minutes / 60).toLocaleString("de-DE") +
        " Stunden" +
        (hasAgreedRestLimit(r) && !r.makeup ? " · Ausgleich offen" : "")
      );
    case "duration":
      return (
        "Höchstens " +
        (r.minutes / 60).toLocaleString("de-DE") +
        " Std. " +
        (r.gross ? "inkl. Pausen" : "ohne Pausen")
      );
    case "switch":
      return shiftLabels[r.from] + " vor " + shiftLabels[r.to] + " vermeiden";
  }
}
export function RuleOverview({
  data,
  today,
  onEdit,
}: {
  data: WorkplaceData;
  today: string;
  onEdit: (id: QuestionId, date: string) => void;
}) {
  const p = usePalette();
  const current = rulesAt(data.history, today);
  return (
    <>
      <Headline>Sonderregelungen in deinem Betrieb</Headline>
      {ruleGroups.map((group) => (
        <View key={group.name} style={{ gap: 8 }}>
          <SectionHeader title={group.name} />
          <SurfaceCard>
            {group.ids.map((id, index) => (
              <Fragment key={id}>
                {index > 0 && <CardSeparator />}
                <RowButton
                  titleColor={p.text}
                  leading={<Icon name={topicIcons[id]} size={20} color={p.textMuted} />}
                  title={topics[id].title}
                  subtitle={ruleSummary(id, current[id])}

                  onPress={() => onEdit(id, today)}
                />
              </Fragment>
            ))}
          </SurfaceCard>
        </View>
      ))}
      {data.history
        .filter((row) => row.from > today)
        .map((row) => (
          <View key={row.from} style={{ gap: 8 }}>
            <SectionHeader title={"Ab " + row.from.split("-").reverse().join(".")} />
            <SurfaceCard>
              {questionIds
                .filter((id) => row.rules[id])
                .map((id, index) => (
                  <Fragment key={id}>
                    {index > 0 && <CardSeparator />}
                    <RowButton
                      titleColor={p.text}
                      leading={<Icon name={topicIcons[id]} size={20} color={p.textMuted} />}
                      title={topics[id].title}

                      subtitle={ruleSummary(id, row.rules[id])}
                      onPress={() => onEdit(id, row.from)}
                    />
                  </Fragment>
                ))}
            </SurfaceCard>
          </View>
        ))}
    </>
  );
}
