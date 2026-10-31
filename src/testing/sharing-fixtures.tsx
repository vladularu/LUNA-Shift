import { jest } from "@jest/globals";
import { act, render as renderNative } from "@testing-library/react-native";
import { Alert } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import type { ReactElement, ReactNode } from "react";
import type {
  SharingCalendarView,
  SharingController,
} from "@/features/sharing/sharing-ui-contract";
export function render(ui: ReactElement) {
  return renderNative(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <SafeAreaInsetsContext.Provider value={{ top: 0, bottom: 0, left: 0, right: 0 }}>
        {children}
      </SafeAreaInsetsContext.Provider>
    ),
  });
}

export function controller(overrides: Partial<SharingController> = {}): SharingController {
  const action = () => jest.fn<() => Promise<void>>().mockResolvedValue();
  return {
    status: "signedIn",
    account: { displayName: "Alex" },
    busy: false,
    error: false,
    calendars: [],
    availableAppointments: [],
    claimResult: null,
    appleAvailable: true,
    accountDeletionAvailable: true,
    preview: jest.fn(() => ({
      entryCount: 1,
      entries: [{ title: "Spät", when: "12.10. · 13:00–21:00" }],
    })),
    signIn: action(),
    refresh: action(),
    createCalendar: jest.fn<SharingController["createCalendar"]>().mockResolvedValue("own"),
    createInvitation: jest.fn<SharingController["createInvitation"]>().mockResolvedValue({
      calendarId: "own",
      id: "invite",
      url: "https://luna.example/sharing-invite?token=" + "b".repeat(64),
      expiresAt: "2099-10-19T12:30:00Z",
    }),
    shareInvitation: action(),
    preparePublicationPreview: jest
      .fn<SharingController["preparePublicationPreview"]>()
      .mockResolvedValue({
        confirmationId: "confirmation",
        entryCount: 1,
        entries: [{ title: "Spät", when: "12.10. · 13:00–21:00" }],
      }),
    publishCalendar: action(),
    setVisible: action(),
    setColor: action(),
    invite: action(),
    setMember: action(),
    revokeInvite: action(),
    deleteCalendar: action(),
    leaveCalendar: action(),
    claimInvite: action(),
    signOut: action(),
    deleteAccount: action(),
    ...overrides,
  };
}
export const own: SharingCalendarView = {
  id: "own",
  name: "Mein Dienstplan",
  color: "#527D92",
  visibility: "DETAILS",
  isOwner: true,
  visible: true,
  publishedAt: "2026-10-12T12:30:00Z",
  syncState: "current",
  members: [
    { userId: "pending", displayName: "Sam", status: "PENDING" },
    { userId: "active", displayName: "Kim", status: "ACTIVE" },
  ],
  invites: [{ id: "invite", expiresAt: "2099-10-19T12:30:00Z", consumedAt: null, revokedAt: null }],
};
export const foreign: SharingCalendarView = {
  ...own,
  id: "foreign",
  name: "Sams Plan",
  isOwner: false,
  members: [],
  invites: [],
};
export async function confirmLastAlert() {
  const calls = jest.mocked(Alert.alert).mock.calls;
  const buttons = calls[calls.length - 1][2];
  await act(async () => buttons?.find((button) => button.style === "destructive")?.onPress?.());
}
