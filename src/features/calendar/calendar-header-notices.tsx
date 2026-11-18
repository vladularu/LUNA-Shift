import { View } from "react-native";

import { SCREEN_LAYOUT, SPACING } from "@/theme/tokens";
import { InlineNotice } from "@/ui/design-system";
import { PrimaryButton } from "@/ui/form-controls";

export function CalendarHeaderNotices({
  plannerError,
  preferences,
}: {
  readonly plannerError: string | null;
  readonly preferences: {
    readonly error: string | null;
    readonly saving: boolean;
    readonly retry: () => void;
  };
}) {
  return (
    <>
      {plannerError ? (
        <View
          style={{
            paddingHorizontal: SCREEN_LAYOUT.horizontalPadding,
            paddingBottom: SPACING.sm,
          }}
        >
          <InlineNotice message={plannerError} tone="error" />
        </View>
      ) : null}
      {preferences.error ? (
        <View
          style={{
            gap: SPACING.sm,
            paddingHorizontal: SCREEN_LAYOUT.horizontalPadding,
            paddingBottom: SPACING.sm,
          }}
        >
          <InlineNotice message={preferences.error} tone="error" />
          <PrimaryButton disabled={preferences.saving} onPress={preferences.retry}>
            Speichern erneut versuchen
          </PrimaryButton>
        </View>
      ) : null}
    </>
  );
}
