import { useEffect, useId, useState } from "react";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import type { SharingController } from "@/domain/sharing-ui-contract";

export function sharedPersonPresentation(
  controller: Pick<SharingController, "status" | "calendars" | "profilePhotosAvailable">,
  userId: string,
) {
  const calendars =
    controller.status === "signedIn"
      ? controller.calendars.filter(
          (calendar) =>
            !calendar.isOwner && calendar.ownerId === userId && calendar.syncState !== "expired",
        )
      : [];
  const person = calendars.find((calendar) => calendar.profilePhotoUri) ?? calendars[0];
  return {
    color: calendars[0]?.color,
    photoUri: controller.profilePhotosAvailable ? person?.profilePhotoUri : null,
    calendarIds: calendars.map((calendar) => calendar.id),
  };
}

export function useSharingPhotoView(controller: SharingController, calendarIds: readonly string[]) {
  const viewId = useId();
  const load = controller.loadProfilePhotos;
  const ids =
    controller.status === "signedIn" && controller.profilePhotosAvailable
      ? [...new Set(calendarIds)].slice(0, 8).join(",")
      : "";
  useEffect(() => {
    void load?.(ids ? ids.split(",") : [], viewId).catch(() => {});
  }, [ids, load, viewId]);
  useEffect(
    () => () => {
      void load?.([], viewId).catch(() => {});
    },
    [load, viewId],
  );
}

type Section = "members" | "incoming";
export interface SharingPhotoTarget {
  readonly key: string;
  readonly section: Section;
  readonly calendarIds: readonly string[];
}
export interface SharingPhotoGeometry {
  readonly viewport: { readonly offset: number; readonly height: number };
  readonly sections: Readonly<Record<string, number>>;
  readonly cards: Readonly<Record<string, number>>;
  readonly rows: Readonly<Record<string, { readonly top: number; readonly height: number }>>;
}
export function visibleSharingPhotoIds(
  targets: readonly SharingPhotoTarget[],
  geometry: SharingPhotoGeometry,
): readonly string[] {
  const { offset, height } = geometry.viewport;
  if (height <= 0) return [];
  return [
    ...new Set(
      targets
        .filter((target) => {
          const section = geometry.sections[target.section],
            card = geometry.cards[target.section],
            row = geometry.rows[target.key];
          if (section === undefined || card === undefined || !row) return false;
          const top = section + card + row.top;
          return top + row.height > offset && top < offset + height;
        })
        .flatMap((target) => target.calendarIds),
    ),
  ].slice(0, 8);
}
export function useVisibleSharingPhotos(
  controller: SharingController,
  targets: readonly SharingPhotoTarget[],
) {
  const [geometry, setGeometry] = useState<SharingPhotoGeometry>({
    viewport: { offset: 0, height: 0 },
    sections: {},
    cards: {},
    rows: {},
  });
  useSharingPhotoView(controller, visibleSharingPhotoIds(targets, geometry));
  function topLayout(kind: "sections" | "cards", section: Section) {
    return (event: LayoutChangeEvent) => {
      const top = event.nativeEvent.layout.y;
      setGeometry((old) =>
        old[kind][section] === top ? old : { ...old, [kind]: { ...old[kind], [section]: top } },
      );
    };
  }
  return {
    onLayout(event: LayoutChangeEvent) {
      const height = event.nativeEvent.layout.height;
      setGeometry((old) =>
        old.viewport.height === height ? old : { ...old, viewport: { ...old.viewport, height } },
      );
    },
    onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
      const offset = event.nativeEvent.contentOffset.y;
      setGeometry((old) =>
        old.viewport.offset === offset ? old : { ...old, viewport: { ...old.viewport, offset } },
      );
    },
    sectionLayout: (section: Section) => topLayout("sections", section),
    cardLayout: (section: Section) => topLayout("cards", section),
    rowLayout: (key: string) => (event: LayoutChangeEvent) => {
      const { y: top, height } = event.nativeEvent.layout;
      setGeometry((old) =>
        old.rows[key]?.top === top && old.rows[key]?.height === height
          ? old
          : { ...old, rows: { ...old.rows, [key]: { top, height } } },
      );
    },
  };
}
