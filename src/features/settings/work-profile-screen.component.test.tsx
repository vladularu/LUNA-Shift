import { render } from "@testing-library/react-native";
import { expect, it, jest } from "@jest/globals";
import { WorkProfileScreen } from "./work-profile-screen";
const mockEditor = jest.fn();
jest.mock("./settings-editor-screen", () => ({
  SettingsEditorScreen: (props: unknown) => {
    mockEditor(props);
    return null;
  },
}));
it("uses the existing shared employment editor for work-profile links", async () => {
  await render(<WorkProfileScreen />);
  expect(mockEditor).toHaveBeenCalledWith({ sectionOverride: "EMPLOYMENT" });
});
