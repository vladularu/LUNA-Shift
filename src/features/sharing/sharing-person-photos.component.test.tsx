import { expect, it, jest } from "@jest/globals";
import { act, fireEvent, within } from "@testing-library/react-native";
import { CalendarSharingScreen } from "./calendar-sharing-screen";
import { CalendarAccessScreen } from "./calendar-access-screen";
import { controller, own, foreign, render } from "@/testing/sharing-fixtures";
import type { SharingController } from "@/domain/sharing-ui-contract";
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
const uri = "data:image/jpeg;base64,shared-photo";
const received = {
  ...foreign,
  ownerId: "active",
  name: "Kims Plan",
  color: "#E776A8",
  profilePhotoUri: uri,
};
const withPhotos = () => controller({ calendars: [own, received], profilePhotosAvailable: true });
it("shows the same consented photo in the member row, color selector and access header", async () => {
  const c = withPhotos();
  const overview = await render(<CalendarSharingScreen controller={c} />);
  const member = within(overview.getByTestId("sharing-member-active"));
  expect(
    member.getByTestId("calendar-person-photo", { includeHiddenElements: true }).props.source.uri,
  ).toBe(uri);
  expect(
    within(overview.getByRole("button", { name: "Farbe für Kims Plan" })).getByTestId(
      "calendar-person-photo",
      { includeHiddenElements: true },
    ).props.source.uri,
  ).toBe(uri);
  await overview.unmount();
  const page = await render(
    <CalendarAccessScreen controller={c} calendarId="own" memberId="active" onBack={() => {}} />,
  );
  expect(
    page.getByTestId("calendar-person-photo", { includeHiddenElements: true }).props.source.uri,
  ).toBe(uri);
  expect(page.getByText("Kim")).toBeTruthy();
  expect(page.getByRole("button", { name: "Zurück zur Übersicht" })).toBeEnabled();
});
it("keeps initials when an identically named calendar belongs to another account", async () => {
  const c = controller({
    profilePhotosAvailable: true,
    calendars: [own, { ...received, ownerId: "another", name: "Kim" }],
  });
  const screen = await render(
    <CalendarAccessScreen controller={c} calendarId="own" memberId="active" onBack={() => {}} />,
  );
  expect(screen.queryByTestId("calendar-person-photo", { includeHiddenElements: true })).toBeNull();
  expect(screen.getByText("K", { includeHiddenElements: true })).toBeTruthy();
});
it("replaces a changed photo and immediately clears a withdrawn one in settings", async () => {
  const c = withPhotos();
  const screen = await render(<CalendarSharingScreen controller={c} />);
  await screen.rerender(
    <CalendarSharingScreen
      controller={{
        ...c,
        calendars: [own, { ...received, profilePhotoUri: "data:image/jpeg;base64,new-photo" }],
      }}
    />,
  );
  expect(
    screen
      .getAllByTestId("calendar-person-photo", { includeHiddenElements: true })
      .every((photo) => photo.props.source.uri.endsWith("new-photo")),
  ).toBe(true);
  await screen.rerender(
    <CalendarSharingScreen
      controller={{ ...c, calendars: [own, { ...received, profilePhotoUri: null }] }}
    />,
  );
  expect(screen.queryByTestId("calendar-person-photo", { includeHiddenElements: true })).toBeNull();
  expect(screen.getByText("Kims Plan")).toBeTruthy();
});
it("does not mistake my outgoing photo permission for permission to see the other person's photo", async () => {
  const c = controller({
    profilePhotosAvailable: true,
    calendars: [{ ...own, members: [{ ...own.members[1], shareProfilePhoto: true }] }],
  });
  const screen = await render(
    <CalendarAccessScreen controller={c} calendarId="own" memberId="active" onBack={() => {}} />,
  );
  expect(screen.queryByTestId("calendar-person-photo", { includeHiddenElements: true })).toBeNull();
  expect(
    screen.getByRole("switch", { name: "Profilbild teilen" }).props.accessibilityState.checked,
  ).toBe(true);
});
it("loads the settings rows currently in view and clears their photo subscription on unmount", async () => {
  const load = jest.fn<NonNullable<SharingController["loadProfilePhotos"]>>().mockResolvedValue();
  const incoming = Array.from({ length: 12 }, (_, i) => ({
    ...foreign,
    id: "received-" + i,
    ownerId: "owner-" + i,
  }));
  const c = controller({
    calendars: incoming,
    profilePhotosAvailable: true,
    loadProfilePhotos: load,
  });
  const screen = await render(<CalendarSharingScreen controller={c} />);
  const layout = (y: number, height = 56) => ({
    nativeEvent: { layout: { x: 0, y, width: 390, height } },
  });
  await act(async () => {
    await fireEvent(screen.getByTestId("sharing-photo-viewport"), "layout", layout(0, 160));
    await fireEvent(screen.getByTestId("sharing-incoming-section"), "layout", layout(100));
    await fireEvent(screen.getByTestId("sharing-incoming-card"), "layout", layout(30));
    for (let i = 0; i < incoming.length; i++)
      await fireEvent(
        screen.getByTestId("sharing-incoming-received-" + i),
        "layout",
        layout(i * 56),
      );
  });
  expect(load).toHaveBeenLastCalledWith(["received-0"], expect.any(String));
  await fireEvent.scroll(screen.getByTestId("sharing-photo-viewport"), {
    nativeEvent: { contentOffset: { x: 0, y: 578 } },
  });
  expect(load).toHaveBeenLastCalledWith(
    ["received-8", "received-9", "received-10"],
    expect.any(String),
  );
  await screen.unmount();
  expect(load).toHaveBeenLastCalledWith([], expect.any(String));
});
