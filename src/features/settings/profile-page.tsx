import { createContext, type PropsWithChildren } from "react";
import { Keyboard } from "react-native";
import { usePalette } from "@/theme/palette";
import { FormScreen } from "@/ui/form-layout";
import { BackFooterLayout } from "@/ui/back-footer-layout";

export const ProfilePageTitleContext = createContext("Arbeitsprofil");

export function ProfilePage({
  children,
  title,
  backLabel,
  onBack,
  backDisabled = false,
  testID,
}: PropsWithChildren<{
  readonly title: string;
  readonly backLabel: string;
  readonly onBack: () => void;
  readonly backDisabled?: boolean;
  readonly testID?: string;
}>) {
  const palette = usePalette();
  return (
    <ProfilePageTitleContext.Provider value={title}>
      <BackFooterLayout
        disabled={backDisabled}
        footerTestID="profile-back-footer"
        label={backLabel}
        onPress={() => {
          Keyboard.dismiss();
          onBack();
        }}
        style={{ backgroundColor: palette.background }}
        testID={testID}
      >
        {(bottomPadding) => (
          <FormScreen bottomPadding={bottomPadding} testID="profile-scroll-content">
            {children}
          </FormScreen>
        )}
      </BackFooterLayout>
    </ProfilePageTitleContext.Provider>
  );
}
