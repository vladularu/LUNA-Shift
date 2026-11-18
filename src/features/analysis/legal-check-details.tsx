import type { ReactNode } from "react";
import { Alert, Linking, Pressable, View } from "react-native";
import type { ComplianceIssue, ShiftEntry } from "@/domain/types";
import { useOptionalRuleCatalogRuntime } from "@/application/rule-catalog-runtime-provider";
import { usePalette } from "@/theme/palette";
import { MINIMUM_TOUCH_TARGET, SPACING } from "@/theme/tokens";
import { CHECK_REFERENCE_TYPOGRAPHY, TYPOGRAPHY } from "@/theme/typography";
import { Text } from "@/ui/text";
import { legalCheckPresentation } from "./legal-check-presentation";
import { RestCheckDetails, restCheckDetailModel } from "./rest-check-details";
import {
  CheckDetailCard,
  checkSourceLinkStyle,
  CheckDetailStack,
  CheckDetailHeading,
  useCheckReferenceDetail,
} from "./check-detail-layout";
import { CheckDetailDisclosure } from "./check-detail-disclosure";
import { checkPeriodLabel } from "./check-period-label";

export function LegalCheckDetails({
  issue,
  title,
  missing,
  children,
  embedded = false,
  shifts,
  timeZone,
}: {
  readonly issue: ComplianceIssue;
  readonly title: string;
  readonly missing: boolean;
  readonly children?: ReactNode;
  readonly embedded?: boolean;
  readonly shifts?: readonly ShiftEntry[];
  readonly timeZone?: string;
}) {
  const palette = usePalette();
  const reference = useCheckReferenceDetail();
  const runtime = useOptionalRuleCatalogRuntime();
  const rest =
    !missing && shifts && timeZone
      ? restCheckDetailModel(issue, shifts, timeZone, runtime?.resolver)
      : null;
  const presentation = legalCheckPresentation(issue);
  const body = reference
    ? { ...CHECK_REFERENCE_TYPOGRAPHY.body, color: reference.secondary }
    : { color: palette.textMuted, ...TYPOGRAPHY.body };
  if (rest) return <RestCheckDetails model={rest} />;
  const basis = (
    <>
      {presentation.sources.length ? (
        <View style={{ gap: SPACING.sm }}>
          {presentation.sources.map((source) => (
            <Pressable
              key={source.url}
              accessibilityRole="link"
              accessibilityLabel={source.title}
              onPress={() => {
                void Linking.openURL(source.url).catch(() =>
                  Alert.alert("Link nicht geöffnet", "Du kannst die Quelle später erneut öffnen."),
                );
              }}
              style={{ minHeight: MINIMUM_TOUCH_TARGET, justifyContent: "center" }}
            >
              <Text style={[body, checkSourceLinkStyle(palette)]}>{source.title}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={body}>
          Für diesen Prüfpunkt ist keine konkrete Rechtsquelle hinterlegt. Maßgeblich ist zunächst
          die Klärung der erfassten Angaben.
        </Text>
      )}
    </>
  );
  return (
    <CheckDetailStack testID="legal-check-detail-content" embedded={embedded}>
      <CheckDetailHeading
        kind="legal"
        period={checkPeriodLabel(issue.date, issue.date)}
        title={title}
        caption="Gesetzliche Prüfung"
      />
      {children ? (
        <CheckDetailCard accent={reference?.legalLine}>{children}</CheckDetailCard>
      ) : null}
      <CheckDetailCard
        title={reference ? "Wie wird das eingeordnet?" : "Einordnung und Prüfmaßstab"}
        accent={reference ? undefined : palette.legalCheckBorder}
      >
        <Text style={body}>{issue.description}</Text>
        <Text style={body}>
          Die Prüfung berücksichtigt die erfassten Zeiten und die unterstützten Regeln. Persönliche,
          tarifliche oder betriebliche Ausnahmen können eine gesonderte Einordnung erfordern.
        </Text>
        {missing ? (
          <Text style={body}>Einige zugehörige Dienste sind nicht mehr verfügbar.</Text>
        ) : null}
      </CheckDetailCard>
      <CheckDetailCard disclosure={!!reference} title={reference ? undefined : "Rechtsgrundlage"}>
        {reference ? (
          <CheckDetailDisclosure title="Prüfgrundlage">{basis}</CheckDetailDisclosure>
        ) : (
          basis
        )}
      </CheckDetailCard>
    </CheckDetailStack>
  );
}
