import { Image, Pressable, ScrollView, View } from "react-native";
import { useContext, useRef, useState } from "react";
import { PrivateCloudContext } from "@/features/private-cloud/private-cloud-context";
import { useSharingUiController } from "@/features/sharing/sharing-ui-provider";
import { usePalette } from "@/theme/palette";
import { Text } from "@/ui/text";
import Ionicons from "@/ui/icon";
import { MINIMUM_TOUCH_TARGET, RADII, SPACING } from "@/theme/tokens";
import { SharingStatus } from "@/features/sharing/sharing-ui-elements";
import { TYPOGRAPHY } from "@/theme/typography";
import type { SharingController } from "@/domain/sharing-ui-contract";

function PersonAvatar({
  name,
  color,
  visible,
  photoUri,
}: {
  readonly name: string;
  readonly color: string;
  readonly visible: boolean;
  readonly photoUri?: string | null;
}) {
  const palette = usePalette();
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const initials = name
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join("")
    .toLocaleUpperCase("de-DE");
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 40,
        height: 40,
        borderRadius: RADII.pill,
        borderWidth: 2,
        borderColor: visible ? color : palette.border,
        alignItems: "center",
        justifyContent: "center",
        opacity: visible ? 1 : 0.6,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: RADII.pill,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: palette.surface,
        }}
      >
        {photoUri && photoUri !== failedUri ? (
          <Image
            key={photoUri}
            testID="calendar-person-photo"
            source={{ uri: photoUri }}
            resizeMode="cover"
            accessible={false}
            onError={() => setFailedUri(photoUri)}
            style={{ width: 32, height: 32 }}
          />
        ) : initials ? (
          <Text allowFontScaling={false} style={{ ...TYPOGRAPHY.label, color: palette.text }}>
            {initials}
          </Text>
        ) : (
          <Ionicons name="person-outline" size={18} color={palette.text} />
        )}
      </View>
      {visible ? (
        <View
          style={{
            position: "absolute",
            right: -2,
            bottom: -2,
            width: 14,
            height: 14,
            borderRadius: RADII.pill,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: palette.text,
          }}
        >
          <Ionicons name="checkmark" size={10} color={palette.surface} />
        </View>
      ) : null}
    </View>
  );
}

export function SharedCalendarFilters(props: {
  readonly ownVisible: boolean;
  readonly onOwnVisible: (visible: boolean) => void;
}) {
  const controller = useSharingUiController();
  if (!controller) return null;
  return <Filters {...props} controller={controller} />;
}
function Filters({
  controller,
  ownVisible,
  onOwnVisible,
}: {
  readonly controller: SharingController;
  readonly ownVisible: boolean;
  readonly onOwnVisible: (visible: boolean) => void;
}) {
  const palette = usePalette();
  const cloud = useContext(PrivateCloudContext);
  const ownUser = cloud?.ready ? cloud.user : null;
  const ownPhotoUri = ownUser ? cloud?.photo?.uri : null;
  const [failed, setFailed] = useState(false);
  const requests = useRef(new Map<string, number>());
  const setVisible = (id: string, visible: boolean) => {
    const revision = (requests.current.get(id) ?? 0) + 1;
    requests.current.set(id, revision);
    setFailed(false);
    void controller.setVisible(id, visible).catch((error: unknown) => {
      if (
        error instanceof Error &&
        ["SHARE_ACCOUNT_CHANGED", "SHARE_NOT_FOUND"].includes(error.message)
      )
        return;
      if (revision === requests.current.get(id)) setFailed(true);
    });
  };
  const rows = [
    { id: "own", name: "Du", color: palette.text, visible: ownVisible },
    ...controller.calendars.filter((item) => !item.isOwner),
  ];
  return (
    <View>
      <ScrollView
        testID="calendar-person-filter-viewport"
        horizontal
        style={{ height: MINIMUM_TOUCH_TARGET, flexGrow: 0 }}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, gap: SPACING.sm }}
      >
        {rows.map((row) => (
          <Pressable
            key={row.id}
            accessibilityRole="button"
            accessibilityLabel={`${row.name} anzeigen`}
            accessibilityHint="Tippen blendet die Dienste ein oder aus."
            accessibilityState={{ selected: row.visible }}
            onPress={() => {
              if (row.id === "own") onOwnVisible(!ownVisible);
              else setVisible(row.id, !row.visible);
            }}
            style={{
              minWidth: MINIMUM_TOUCH_TARGET,
              minHeight: MINIMUM_TOUCH_TARGET,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <PersonAvatar
              key={row.id === "own" ? (ownUser?.id ?? "guest") : row.id}
              name={row.id === "own" ? ownUser?.displayName || "Du" : row.name}
              color={row.color}
              visible={row.visible}
              photoUri={row.id === "own" ? ownPhotoUri : null}
            />
          </Pressable>
        ))}
      </ScrollView>
      <SharingStatus busy={false} failed={failed || controller.error} />
      {controller.offline && !failed && !controller.error ? (
        <Text
          style={{ ...TYPOGRAPHY.caption, color: palette.textMuted, paddingHorizontal: SPACING.lg }}
        >
          {controller.calendars.some(
            (calendar) => calendar.visible && calendar.syncState === "offline",
          )
            ? "Offline · Gespeicherter Stand"
            : "Offline · Freigaben werden später aktualisiert"}
        </Text>
      ) : null}
    </View>
  );
}
