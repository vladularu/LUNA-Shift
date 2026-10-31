import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { useContext, useEffect, useId, useRef, useState } from "react";
import { PrivateCloudContext } from "@/features/private-cloud/private-cloud-context";
import { useSharingUiController } from "@/features/sharing/sharing-ui-provider";
import { usePalette } from "@/theme/palette";
import { Text } from "@/ui/text";
import { PersonAvatar } from "@/ui/person-avatar";
import { CALENDAR_PERSON_WIDTH, calendarPersonLabels } from "./calendar-person-labels";
import { MINIMUM_TOUCH_TARGET, SPACING } from "@/theme/tokens";
import { SharingStatus } from "@/features/sharing/sharing-ui-elements";
import { TYPOGRAPHY } from "@/theme/typography";
import type { SharingController } from "@/domain/sharing-ui-contract";

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
  const { fontScale } = useWindowDimensions();
  const cloud = useContext(PrivateCloudContext);
  const ownUser = cloud?.ready ? cloud.user : null;
  const ownPhotoUri = ownUser ? cloud?.photo?.uri : null;
  const [failed, setFailed] = useState(false);
  const requests = useRef(new Map<string, number>());
  const photoViewId = useId();
  const [viewport, setViewport] = useState({ width: 390, offset: 0 });
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
    {
      id: "own",
      name: "Ich",
      color: palette.text,
      visible: ownVisible,
      profilePhotoUri: ownPhotoUri,
    },
    ...controller.calendars.filter((item) => !item.isOwner),
  ];
  const labels = calendarPersonLabels(rows);
  const first = Math.max(
    0,
    Math.floor((viewport.offset - SPACING.lg) / (CALENDAR_PERSON_WIDTH + SPACING.sm)),
  );
  const count = Math.ceil(viewport.width / (CALENDAR_PERSON_WIDTH + SPACING.sm)) + 1;
  const photoIds = rows
    .slice(first, first + Math.min(count, 8))
    .filter((row) => row.id !== "own")
    .map((row) => row.id)
    .join(",");
  const loadPhotos = controller.loadProfilePhotos;
  useEffect(() => {
    void loadPhotos?.(photoIds ? photoIds.split(",") : [], photoViewId).catch(() => {});
  }, [photoIds, photoViewId, loadPhotos, controller.profilePhotosAvailable]);
  useEffect(
    () => () => {
      void loadPhotos?.([], photoViewId).catch(() => {});
    },
    [loadPhotos, photoViewId],
  );
  return (
    <View>
      <ScrollView
        testID="calendar-person-filter-viewport"
        horizontal
        onLayout={(event) => {
          // Native events are released before queued state updaters may run.
          const width = event.nativeEvent.layout.width;
          setViewport((old) => (old.width === width ? old : { ...old, width }));
        }}
        onScroll={(event) => {
          const offset = event.nativeEvent.contentOffset.x;
          setViewport((old) => (old.offset === offset ? old : { ...old, offset }));
        }}
        scrollEventThrottle={100}
        style={{
          height: Math.max(
            MINIMUM_TOUCH_TARGET,
            Math.ceil(TYPOGRAPHY.caption.lineHeight * fontScale * 2),
          ),
          flexGrow: 0,
        }}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, gap: SPACING.sm }}
      >
        {rows.map((row) => (
          <Pressable
            key={row.id}
            accessibilityRole="button"
            accessibilityLabel={
              row.id === "own" ? "Meinen Kalender anzeigen" : `${row.name} anzeigen`
            }
            accessibilityHint="Tippen blendet die Dienste ein oder aus."
            accessibilityState={{ selected: row.visible }}
            onPress={() => {
              if (row.id === "own") onOwnVisible(!ownVisible);
              else setVisible(row.id, !row.visible);
            }}
            style={{
              width: CALENDAR_PERSON_WIDTH,
              minWidth: MINIMUM_TOUCH_TARGET,
              minHeight: MINIMUM_TOUCH_TARGET,
              flexDirection: "row",
              gap: SPACING.xs,
              alignItems: "center",
              justifyContent: "flex-start",
            }}
          >
            <PersonAvatar
              key={row.id === "own" ? (ownUser?.id ?? "guest") : row.id}
              name={row.id === "own" ? ownUser?.displayName || "Ich" : row.name}
              color={row.color}
              selected={row.visible}
              photoUri={row.id === "own" ? ownPhotoUri : row.profilePhotoUri}
            />
            <Text
              accessible={false}
              numberOfLines={2}
              style={{
                ...TYPOGRAPHY.caption,
                color: palette.text,
                flex: 1,
                opacity: row.visible ? 1 : 0.6,
              }}
            >
              {labels.get(row.id)}
            </Text>
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
