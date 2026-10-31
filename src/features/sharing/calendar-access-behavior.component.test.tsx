import { expect, it, jest } from "@jest/globals";
import { act, fireEvent } from "@testing-library/react-native";
import { CalendarAccessScreen } from "./calendar-access-screen";
import { controller, own, render } from "@/testing/sharing-fixtures";
import type { SharingController } from "./sharing-ui-contract";

it("keeps save progress out of the content flow while a permission write is pending", async () => {
  let finish!: () => void;
  const setMemberRights = jest
    .fn<NonNullable<SharingController["setMemberRights"]>>()
    .mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
  const c = controller({ calendars: [own], contentRightsAvailable: true, setMemberRights });
  const screen = await render(
    <CalendarAccessScreen controller={c} calendarId="own" memberId="active" onBack={() => {}} />,
  );
  await fireEvent(screen.getByRole("switch", { name: "Notizen freigeben" }), "valueChange", true);
  try {
    expect(setMemberRights).toHaveBeenCalledWith("own", "active", {
      shifts: true,
      appointments: false,
      notes: true,
    });
    expect(screen.queryByLabelText("Wird bearbeitet")).toBeNull();
    expect(screen.getByRole("button", { name: "Zurück zur Übersicht" })).toBeEnabled();
  } finally {
    await act(async () => finish());
  }
});
it("still reports a failed photo-consent save and keeps the confirmed value", async () => {
  const setMemberProfilePhoto = jest
    .fn<NonNullable<SharingController["setMemberProfilePhoto"]>>()
    .mockRejectedValue(new Error("private token=secret"));
  const c = controller({ calendars: [own], profilePhotosAvailable: true, setMemberProfilePhoto });
  const screen = await render(
    <CalendarAccessScreen controller={c} calendarId="own" memberId="active" onBack={() => {}} />,
  );
  await fireEvent(screen.getByRole("switch", { name: "Profilbild teilen" }), "valueChange", true);
  expect(
    screen.getByText(
      "Die Profilbild-Freigabe konnte nicht gespeichert werden. Versuche es erneut.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByRole("switch", { name: "Profilbild teilen" }).props.accessibilityState.checked,
  ).toBe(false);
  expect(screen.queryByText(/private token/)).toBeNull();
});
