import { SPACING, RADII } from "@/theme/tokens";
import { useRef, useState } from "react";
import { Modal, View, Pressable } from "react-native";
import { Text, TextInput } from "@/ui/text";
import { Temporal } from "@js-temporal/polyfill";
import { usePalette } from "@/theme/palette";
import { TYPOGRAPHY } from "@/theme/typography";
import { Field, PrimaryButton } from "@/ui/form-controls";
import Icon from "@/ui/icon";
import { DropdownField } from "@/ui/dropdown-field";
import { InlineNotice, SectionHeader } from "@/ui/design-system";
import { InfoDisclosure } from "@/ui/info-disclosure";
import { ProfileDateField } from "@/features/settings/profile-date-field";
import { usePflegeShiftProfile } from "@/application/pflegeshift-provider";
import {
  ALL_WORKPLACE_DATES,
  changeRuleForAllDates,
  changeRule,
  isoDate,
  questionIds,
  rulesAt,
  validateRule,
  type QuestionId,
  type WorkplaceData,
} from "@/domain/workplace-rules";
import { draftFor, isAgreedShortRestDraft, ruleInput, topics, type Draft } from "./questions";
import { Choices, FlowPage, Headline, LinkAction, Progress, Welcome } from "./flow-layout";
import { RuleOverview, ruleSummary, shiftLabels as shiftChoices, topicStep } from "./overview";
function Select({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: Record<string, string>;
  onChange: (v: string) => void;
}) {
  return (
    <DropdownField
      label={label}
      value={value}
      options={Object.entries(choices).map(([v, name]) => ({ value: v, label: name }))}
      onChange={onChange}
    />
  );
}
const dutyChoices = {
  all: "Alle Dienste",
  regular: "Regulärer Dienst",
  standby: "Bereitschaftsdienst",
  callout: "Einsatz aus der Rufbereitschaft",
};

export type Save = (update: (current: WorkplaceData) => WorkplaceData) => Promise<void>;
type Screen = "intro" | "overview" | "answer" | "details";
export function RuleFlow({
  data,
  today,
  entry,
  save,
  onClose,
}: {
  data: WorkplaceData;
  today: string;
  entry: "intro" | "overview";
  save: Save;
  onClose: () => void;
}) {
  const p = usePalette();
  const { profile } = usePflegeShiftProfile();
  const [screen, setScreen] = useState<Screen>(entry);
  const [guided, setGuided] = useState(entry === "intro");
  const [id, setId] = useState<QuestionId>("week"),
    [draft, setDraft] = useState<Draft>({ mode: "" });
  const [date, setDate] = useState(today),
    [example, setExample] = useState(false);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [allDates, setAllDates] = useState(false),
    [extra, setExtra] = useState(false);
  const lock = useRef(false);
  const topic = topics[id],
    mode = draft.mode,
    known = !!mode && mode !== "none" && mode !== "unknown";
  function openRule(key: QuestionId, from: string, edit: boolean) {
    const value = draftFor(rulesAt(data.history, from)[key]);
    const versions = data.history.filter((row) => row.rules[key]);
    setAllDates(versions.length === 1 && versions[0]?.from === ALL_WORKPLACE_DATES);
    setExtra(false);
    setId(key);
    setDate(from);
    setDraft(value);
    setExample(false);
    setError("");
    setScreen(edit && value.mode ? "details" : "answer");
  }
  function begin() {
    setGuided(true);
    openRule("week", today, false);
  }
  function changeMode(value: string) {
    if (mode !== value)
      setDraft(value === "rest" ? { mode: value, duty: "regular" } : { mode: value });
    setError("");
  }
  function field(key: string, value: string) {
    setDraft((old) => ({ ...old, [key]: value }));
    setError("");
  }
  async function commit(exit = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (exit) {
        await save((old) => ({ ...old, handled: true }));
        onClose();
        return;
      }
      if (!mode) throw Error("Bitte wähle eine Antwort aus.");
      if (!allDates && !isoDate.safeParse(date).success)
        throw Error("Bitte wähle ein gültiges Datum.");
      if (known && !draft.source) throw Error("Gib an, wie die Regel bei euch gilt.");
      if (mode === "duration" && !draft.gross) throw Error("Gib an, ob Pausen enthalten sind.");
      let rule;
      try {
        rule = validateRule(id, ruleInput(draft));
      } catch {
        throw Error(
          mode === "alternate"
            ? "Wähle den Samstag eines freien Wochenendes oder lass das Feld leer."
            : "Prüfe bitte den Wert und die Angaben zu deiner Regel.",
        );
      }
      const next = questionIds
        .slice(questionIds.indexOf(id) + 1)
        .find((key) => key !== "recovery" || rule.mode !== "off");
      const finished = guided && !next;
      await save((old) => ({
        ...(allDates ? changeRuleForAllDates(old, id, rule) : changeRule(old, date, id, rule)),
        handled: old.handled || finished,
      }));
      if (!guided) {
        setScreen("overview");
        return;
      }
      if (next) {
        openRule(next, allDates ? today : date, false);
        return;
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen. Versuche es erneut.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function back() {
    if (lock.current) return;
    setError("");
    setExample(false);
    if (screen === "overview") {
      onClose();
      return;
    }
    if (screen === "intro") {
      if (entry === "overview") {
        setScreen("overview");
        return;
      }
      void commit(true);
      return;
    }
    if (!guided) {
      setScreen("overview");
      return;
    }
    if (screen === "details") {
      setScreen("answer");
      return;
    }
    const previous = questionIds
      .slice(0, questionIds.indexOf(id))
      .filter((key) => key !== "recovery" || rulesAt(data.history, date).night?.mode !== "off")
      .at(-1);
    if (previous) openRule(previous, date, false);
    else setScreen("intro");
  }
  const input = (key: string, label: string, numeric = false) => (
    <Field
      label={label}
      keyboardType={numeric ? "decimal-pad" : "default"}
      value={draft[key] ?? ""}
      onChangeText={(v) => field(key, v)}
    />
  );
  const pick = (key: string, label: string, choices: Record<string, string>) => (
    <Select
      label={label}
      value={draft[key] || (key === "onRequest" ? "false" : "Auswählen")}
      choices={choices}
      onChange={(v) => field(key, v)}
    />
  );
  const isQuestion = screen === "answer" || screen === "details";
  const datePicker = (
    <ProfileDateField
      value={date.split("-").reverse().join(".")}
      onChange={(v) => setDate(v.split(".").reverse().join("-"))}
      disabled={busy}
    />
  );
  const primary =
    screen === "intro"
      ? "Fragen starten"
      : !guided
        ? "Änderung speichern"
        : id === "duration" && (screen === "details" || !known)
          ? "Zum Dienstplan-Check"
          : "Weiter";
  const help = (
    <>
      <InfoDisclosure
        key={id}
        summary="Tarif und Gesetz ansehen"
        details={
          (["week", "weekend", "series", "recovery"].includes(id) &&
          !profile?.tariff &&
          !profile?.vkaETariff
            ? "Zur Orientierung für Beschäftigte im TVöD: "
            : "") + topic.basis
        }
      />
      <LinkAction
        icon="document-text-outline"
        label="Beispiel aus der Pflege"
        onPress={() => setExample((v) => !v)}
      />
      {example && (
        <>
          <InlineNotice message={topic.sample} />
          <LinkAction
            label="Beispiel als eigene Regel übernehmen"
            onPress={() => {
              setDraft({ ...topic.example });
              setExample(false);
              setError("");
              setScreen("details");
            }}
          />
        </>
      )}
    </>
  );
  return (
    <Modal visible presentationStyle="fullScreen" animationType="slide" onRequestClose={back}>
      <FlowPage
        pageKey={screen + id}
        busy={busy}
        title={
          screen === "intro" || screen === "overview"
            ? "Dienstplan-Check"
            : guided
              ? "Sonderregelungen"
              : "Regel bearbeiten"
        }
        onBack={back}
        aside={
          guided && isQuestion ? (
            <LinkAction label="Später" disabled={busy} onPress={() => void commit(true)} />
          ) : null
        }
        footer={
          <>
            {!!error && <InlineNotice message={error} />}
            {screen !== "overview" && (
              <PrimaryButton
                disabled={busy || (screen === "answer" && !mode)}
                onPress={() => {
                  if (screen === "intro") {
                    begin();
                    return;
                  }
                  if (screen === "answer" && (known || !guided)) {
                    setExample(false);
                    setScreen("details");
                    return;
                  }
                  void commit();
                }}
              >
                {screen === "answer" && !guided ? "Weiter" : primary}
              </PrimaryButton>
            )}
            {screen === "intro" && (
              <View style={{ alignItems: "center" }}>
                <LinkAction
                  disabled={busy}
                  label={entry === "intro" ? "Direkt zum Dienstplan-Check" : "Zurück zur Übersicht"}
                  onPress={() => (entry === "intro" ? void commit(true) : setScreen("overview"))}
                />
              </View>
            )}
          </>
        }
      >
        {screen === "intro" ? (
          <Welcome />
        ) : screen === "overview" ? (
          <>
            <RuleOverview
              data={data}
              today={today}
              onEdit={(key, from) => {
                setGuided(false);
                openRule(key, from, true);
              }}
            />
            <LinkAction
              label="Fragen der Reihe nach durchgehen"
              onPress={() => {
                setGuided(true);
                setScreen("intro");
              }}
            />
          </>
        ) : (
          <>
            {guided && <Progress step={topicStep[id]} label={topic.title} />}
            <Headline>{screen === "answer" ? topic.question : topic.title}</Headline>
            {screen === "answer" && id === "weekend" && (
              <Text style={{ ...TYPOGRAPHY.small, color: p.textMuted }}>
                Ein ganzes Wochenende umfasst Samstag und Sonntag.
              </Text>
            )}
            {screen === "answer" && id === "rest" && (
              <Text style={{ ...TYPOGRAPHY.small, color: p.textMuted }}>
                Die Ruhezeit beginnt mit dem Dienstende und endet mit dem nächsten Dienstbeginn.
              </Text>
            )}
            {screen === "answer" ? (
              <Choices
                value={mode}
                options={{
                  ...topic.choices,
                  none:
                    id === "rest"
                      ? "Keine betriebliche Sonderregel"
                      : id === "duration"
                        ? "Keine Sonderregel bekannt"
                        : "Keine feste Regel",
                  unknown: "Weiß ich nicht",
                }}
                onChange={changeMode}
              />
            ) : (
              <>
                <Text style={{ ...TYPOGRAPHY.body, color: p.textMuted }}>
                  {["short", "standard", "alternate", "off"].includes(mode)
                    ? topic.choices[mode]
                    : topic.question}
                </Text>
                {mode === "limit" ? (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: SPACING.md,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.xs }}>
                      <TextInput
                        accessibilityLabel={id === "night" ? "Anzahl Nächte" : "Anzahl Tage"}
                        keyboardType="number-pad"
                        selectTextOnFocus
                        maxLength={3}
                        placeholder="–"
                        placeholderTextColor={p.textMuted}
                        value={draft.count ?? ""}
                        onChangeText={(value) => field("count", value.replace(/[^0-9]/g, ""))}
                        style={{
                          ...TYPOGRAPHY.screenTitle,
                          color: p.text,
                          width: draft.count?.length === 3 ? 64 : 48,
                          minHeight: 48,
                          padding: 0,
                          textAlign: "center",
                          fontVariant: ["tabular-nums"],
                          backgroundColor: p.surfaceMuted,
                          borderRadius: RADII.small,
                        }}
                      />
                      <Text style={{ ...TYPOGRAPHY.body, color: p.text }}>
                        {id === "night"
                          ? draft.count === "1"
                            ? "Nacht"
                            : "Nächte"
                          : draft.count === "1"
                            ? "Tag"
                            : "Tage"}
                      </Text>
                    </View>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        backgroundColor: p.surfaceMuted,
                        borderRadius: RADII.control,
                      }}
                    >
                      {([-1, 1] as const).map((delta) => {
                        const value = Number(draft.count) || 0;
                        const max = id === "week" ? 7 : 366;
                        const disabled = delta === -1 ? value <= 1 : value >= max;
                        return (
                          <Pressable
                            key={delta}
                            accessibilityRole="button"
                            accessibilityLabel={
                              delta === -1 ? "Anzahl verringern" : "Anzahl erhöhen"
                            }
                            accessibilityState={{ disabled }}
                            disabled={disabled}
                            onPress={() =>
                              field("count", String(Math.max(1, Math.min(max, value + delta))))
                            }
                            style={({ pressed }) => ({
                              width: 48,
                              height: 44,
                              alignItems: "center",
                              justifyContent: "center",
                              opacity: disabled ? 0.35 : pressed ? 0.65 : 1,
                            })}
                          >
                            {delta === 1 && (
                              <View
                                style={{
                                  position: "absolute",
                                  left: 0,
                                  width: 1,
                                  height: 18,
                                  backgroundColor: p.border,
                                }}
                              />
                            )}
                            <Icon name={delta === -1 ? "remove" : "add"} size={21} color={p.text} />
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
                {["average", "monthly", "rolling", "recovery"].includes(mode) &&
                  input(
                    "count",
                    mode === "monthly" || mode === "rolling"
                      ? "Anzahl ganzer freier Wochenenden"
                      : id === "night"
                        ? "Höchstens so viele Nachtdienste"
                        : mode === "recovery"
                          ? "Dauer der freien Zeit"
                          : "Anzahl Arbeitstage",
                    true,
                  )}
                {(mode === "average" || mode === "rolling") &&
                  input("weeks", "Zeitraum in aufeinanderfolgenden Wochen", true)}
                {mode === "alternate" && (
                  <>
                    <LinkAction
                      icon="calendar-outline"
                      label={
                        draft.anchor
                          ? "Ohne festes Startdatum prüfen"
                          : "Freies Wochenende als Startdatum wählen"
                      }
                      onPress={() => {
                        const d = Temporal.PlainDate.from(today);
                        field(
                          "anchor",
                          draft.anchor ? "" : d.add({ days: (6 - d.dayOfWeek + 7) % 7 }).toString(),
                        );
                      }}
                    />
                    {!!draft.anchor && (
                      <ProfileDateField
                        label="Freier Samstag"
                        value={draft.anchor.split("-").reverse().join(".")}
                        onChange={(v) => field("anchor", v.split(".").reverse().join("-"))}
                        disabled={busy}
                      />
                    )}
                  </>
                )}
                {mode === "recovery" && (
                  <>
                    {pick("unit", "Wie wird die freie Zeit gezählt?", {
                      days: "Ganze freie Kalendertage",
                      hours: "Stunden ab Dienstende",
                    })}
                    {input("nights", "Ab wie vielen aufeinanderfolgenden Nächten?", true)}
                  </>
                )}
                {(mode === "rest" || mode === "duration") && (
                  <>
                    {mode === "duration" && pick("duty", "Für welche Dienste?", dutyChoices)}
                    {input(
                      "hours",
                      mode === "rest" ? "Mindestruhezeit in Stunden" : "Höchstdauer in Stunden",
                      true,
                    )}
                    {mode === "duration" &&
                      pick("gross", "Sind die Pausen in dieser Dauer enthalten?", {
                        yes: "Ja, mit Pausen",
                        no: "Nein, ohne Pausen",
                      })}
                  </>
                )}
                {mode === "switch" && (
                  <>
                    {pick("from", "Vom", shiftChoices)}
                    {pick("to", "Direkt zum", shiftChoices)}
                  </>
                )}

                <LinkAction
                  icon="options-outline"
                  label="Antwort ändern"
                  onPress={() => {
                    setExample(false);
                    setScreen("answer");
                  }}
                />
                {known ? (
                  <>
                    <SectionHeader title="Ist das verbindlich vereinbart?" />
                    <Choices
                      value={draft.source ?? ""}
                      options={{
                        agreed: "Ja, das ist vereinbart",
                        usual: "So wird bei uns üblicherweise geplant",
                      }}
                      onChange={(v) => field("source", v)}
                    />
                  </>
                ) : (
                  <Text style={{ color: p.textMuted }}>
                    {ruleSummary(id, validateRule(id, ruleInput(draft)))}
                  </Text>
                )}
                {isAgreedShortRestDraft(draft) && (
                  <>
                    {pick("duty", "Nach welchen Diensten gilt die Vereinbarung?", dutyChoices)}
                    {pick("makeupKnown", "Kennst du die Regel zum Ausgleich?", {
                      unknown: "Weiß ich nicht",
                      yes: "Ja, Dauer und Frist eintragen",
                    })}
                    {draft.makeupKnown === "yes" ? (
                      <>
                        {input("makeupHours", "Ruhezeit zum Ausgleich in Stunden", true)}
                        {input("makeupDays", "Frist für den Ausgleich in Tagen", true)}
                      </>
                    ) : (
                      <Text style={{ color: p.textMuted }}>
                        LUNA prüft die vereinbarte Mindestdauer. Die Prüfung des Ausgleichs bleibt
                        offen.
                      </Text>
                    )}
                  </>
                )}
                <SectionHeader title="Für welchen Zeitraum gilt die Regel?" />
                <Choices
                  value={allDates ? "all" : "date"}
                  options={{ date: "Ab Datum", all: "Für den gesamten Zeitraum" }}
                  onChange={(v) => setAllDates(v === "all")}
                />
                {allDates ? (
                  <Text style={{ ...TYPOGRAPHY.small, color: p.textMuted }}>
                    Gilt auch für frühere Dienste. Vorhandene Zeiträume dieser Regel werden beim
                    Speichern ersetzt.
                  </Text>
                ) : (
                  datePicker
                )}
                {known && (
                  <LinkAction
                    icon="options-outline"
                    label={extra ? "Weitere Angaben schließen" : "Weitere Angaben (freiwillig)"}
                    onPress={() => setExtra((v) => !v)}
                  />
                )}
                {extra &&
                  mode === "rest" &&
                  !isAgreedShortRestDraft(draft) &&
                  pick("duty", "Nach welchen Diensten gilt die Regel?", dutyChoices)}
                {extra &&
                  mode === "rest" &&
                  !isAgreedShortRestDraft(draft) &&
                  input(
                    "compensation",
                    "So wird die kürzere Ruhezeit ausgeglichen (falls bekannt)",
                  )}
                {extra &&
                  (mode === "rest" || mode === "duration") &&
                  input("basis", "Wo ist das vereinbart? (falls bekannt)")}
                {known &&
                  extra &&
                  pick("onRequest", "Ausnahme auf eigenen Wunsch", {
                    false: "Keine bekannt",
                    true: "Ja, für einzelne Dienste",
                  })}
              </>
            )}
            {help}
          </>
        )}
      </FlowPage>
    </Modal>
  );
}
