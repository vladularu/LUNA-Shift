import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { AccessibilityInfo, Pressable, Text, View } from "react-native";
import { usePflegeShiftProfile, usePflegeShiftStatus } from "@/application/pflegeshift-provider";
import { HOLIDAY_REGION_LABELS, type HolidayRegion, type UserProfile } from "@/domain/types";
import { holidayRegionsForState } from "@/domain/employment-profile";
import { userFacingErrorMessage } from "@/domain/errors";
import type { RouteParam } from "@/navigation/route-params";
import { usePalette } from "@/theme/palette";
import { RADII, SPACING } from "@/theme/tokens";
import { TYPOGRAPHY } from "@/theme/typography";
import { PrimaryButton, SecondaryButton } from "@/ui/form-controls";
import { LoadFailureView, LoadingView } from "@/ui/loading-view";
import { ProfilePage } from "./profile-page";
import { useProfileLeaveGuard } from "./use-profile-leave-guard";

const QUESTIONS = ["work", "night", "sunday", "region"] as const;
type Question = (typeof QUESTIONS)[number];
const BOOLEAN_OPTIONS = [
  { value: true, label: "Ja" },
  { value: false, label: "Nein" },
  { value: null, label: "Weiß ich nicht" },
] as const;
const COPY = {
  work: [
    "Sind alle deine Arbeitszeiten erfasst?",
    "Auch Arbeitszeiten aus einem Nebenjob zählen dazu.",
  ],
  night: [
    "Arbeitest du regelmäßig nachts oder in Wechselschicht?",
    "Gemeint ist dein übliches Arbeitsmodell.",
  ],
  sunday: [
    "Ist Sonn- und Feiertagsarbeit für deine Tätigkeit erlaubt?",
    "Falls du unsicher bist, kannst du das mit deinem Arbeitgeber klären.",
  ],
  region: ["Welche Feiertage gelten an deinem Arbeitsort?", "Wähle die Region deines Arbeitsorts."],
} as const;

export function CheckProfileScreen() {
  const { ready, error, reload } = usePflegeShiftStatus();
  const { profile } = usePflegeShiftProfile();
  const params = useLocalSearchParams<{ questions?: RouteParam }>();
  const raw = params.questions;
  const requested =
    typeof raw === "string" ? raw.split(",") : raw === undefined ? ["work", "night", "sunday"] : [];
  const valid =
    requested.length > 0 &&
    requested.every((value) => (QUESTIONS as readonly string[]).includes(value));
  if (!valid)
    return (
      <LoadFailureView
        title="Angaben können nicht geöffnet werden"
        message="Der Link enthält unbekannte Fragen."
        onRetry={() => router.back()}
        actionLabel="Schließen"
      />
    );
  if (ready && error) return <LoadFailureView message={error} onRetry={() => void reload()} />;
  if (!ready || !profile) return <LoadingView />;
  const questions = [...new Set(requested)] as Question[];
  if (raw === undefined && profile.holidayRegion === "UNKNOWN") questions.push("region");
  return (
    <CheckProfileForm
      key={typeof raw === "string" ? raw : "default"}
      profile={profile}
      questions={questions}
    />
  );
}

export function CheckProfileForm({
  profile,
  questions: initialQuestions,
}: {
  readonly profile: UserProfile;
  readonly questions: readonly Question[];
}) {
  const palette = usePalette();
  const { updateProfile } = usePflegeShiftProfile();
  // Saving can update the profile before navigation closes; keep this flow's pages stable.
  const [questions] = useState(() => [...initialQuestions]);
  const [page, setPage] = useState(0);
  const [work, setWork] = useState(profile.allEmploymentWorkRecorded);
  const [night, setNight] = useState(profile.regularRotatingNightWork);
  const [sunday, setSunday] = useState(profile.sundayHolidayWorkEligible);
  const [region, setRegion] = useState<HolidayRegion>(profile.holidayRegion);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const answers = questions.map((item) =>
    item === "region" ? region : item === "work" ? work : item === "night" ? night : sunday,
  );
  const [snapshot] = useState(() => JSON.stringify(answers));
  const leave = useProfileLeaveGuard(JSON.stringify(answers) !== snapshot, saving);
  const question = questions[page];
  const value = question === "work" ? work : question === "night" ? night : sunday;
  const setValue = question === "work" ? setWork : question === "night" ? setNight : setSunday;
  const [title, hint] = COPY[question];
  const options =
    question === "region"
      ? [
          { value: "UNKNOWN", label: "Weiß ich nicht" },
          ...holidayRegionsForState(profile.federalState)
            .filter((item) => item !== "UNKNOWN")
            .map((item) => ({ value: item, label: HOLIDAY_REGION_LABELS[item] })),
        ]
      : BOOLEAN_OPTIONS;

  async function advance() {
    if (busyRef.current) return;
    if (page < questions.length - 1) {
      setPage(page + 1);
      AccessibilityInfo.announceForAccessibility(COPY[questions[page + 1]][0]);
      return;
    }
    busyRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await updateProfile({
        ...profile,
        ...(questions.includes("work") ? { allEmploymentWorkRecorded: work } : {}),
        ...(questions.includes("night") ? { regularRotatingNightWork: night } : {}),
        ...(questions.includes("sunday") ? { sundayHolidayWorkEligible: sunday } : {}),
        ...(questions.includes("region") ? { holidayRegion: region } : {}),
      });
      leave.saved();
    } catch (failure) {
      busyRef.current = false;
      setError(userFacingErrorMessage(failure, "Die Angaben konnten nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ProfilePage
      title="Deine Prüfung"
      backLabel="Später"
      onBack={() => {
        if (!busyRef.current) router.back();
      }}
      backDisabled={saving}
    >
      <View style={{ gap: SPACING.lg }}>
        <Text
          accessibilityLabel={`Frage ${page + 1} von ${questions.length}`}
          style={{ color: palette.textMuted, ...TYPOGRAPHY.caption }}
        >
          {page + 1} / {questions.length}
        </Text>
        <Text accessibilityRole="header" style={{ color: palette.text, ...TYPOGRAPHY.screenTitle }}>
          {title}
        </Text>
        <Text style={{ color: palette.textMuted, ...TYPOGRAPHY.body }}>{hint}</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel={title} style={{ gap: SPACING.sm }}>
          {options.map((option) => {
            const selected = (question === "region" ? region : value) === option.value;
            return (
              <Pressable
                key={option.label}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled: saving }}
                disabled={saving}
                onPress={() => {
                  if (question === "region") setRegion(option.value as HolidayRegion);
                  else setValue(option.value as boolean | null);
                }}
                style={{
                  minHeight: 48,
                  justifyContent: "center",
                  padding: SPACING.md,
                  borderRadius: RADII.control,
                  borderWidth: 1,
                  borderColor: selected ? palette.primary : palette.border,
                  backgroundColor: selected ? palette.primarySoft : palette.surface,
                }}
              >
                <Text style={{ color: palette.text, ...TYPOGRAPHY.body }}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {error ? (
          <Text accessibilityRole="alert" style={{ color: palette.danger, ...TYPOGRAPHY.body }}>
            {error}
          </Text>
        ) : null}
        <PrimaryButton disabled={saving} onPress={() => void advance()}>
          {saving ? "Wird gespeichert …" : page === questions.length - 1 ? "Speichern" : "Weiter"}
        </PrimaryButton>
        {page > 0 ? (
          <SecondaryButton disabled={saving} onPress={() => setPage(page - 1)}>
            Zurück
          </SecondaryButton>
        ) : null}
      </View>
    </ProfilePage>
  );
}
