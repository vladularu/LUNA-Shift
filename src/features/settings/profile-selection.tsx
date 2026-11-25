import { Text } from "@/ui/text";
import Ionicons from "@/ui/icon";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { HeaderTitle } from "expo-router/react-navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { Keyboard, Platform, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { profileSelectionRoute } from "@/navigation/routes";
import { usePalette } from "@/theme/palette";
import { MINIMUM_TOUCH_TARGET, SPACING } from "@/theme/tokens";
import { TEXT_MAX_SCALE, TYPOGRAPHY } from "@/theme/typography";
import { CardSeparator, RowButton, SectionHeader, SurfaceCard } from "@/ui/design-system";
import { Field, type DropdownOption } from "@/ui/form-controls";
import { ProfilePage, ProfilePageTitleContext } from "./profile-page";
import { LoadFailureView } from "@/ui/loading-view";
import { LunaChoiceMenu } from "@/ui/luna-choice-menu";
import { SelectionSheet } from "@/ui/selection-sheet";

type ChoiceValue = string | number;
interface SelectionRequest {
  readonly id: string;
  readonly title: string;
  readonly prompt?: string;
  readonly returnTo: string;
  readonly value: ChoiceValue;
  readonly options: readonly DropdownOption<ChoiceValue>[];
  readonly onChange: (value: ChoiceValue) => void;
}
interface SelectionContextValue {
  readonly request: SelectionRequest | null;
  readonly open: (request: Omit<SelectionRequest, "id">) => void;
  readonly clear: (requestId?: string) => void;
}
const SelectionContext = createContext<SelectionContextValue | null>(null);
export const ProfileEditorControlContext = createContext({ busy: false, nativeChoices: false });
export function ProfileSelectionProvider({ children }: PropsWithChildren) {
  const [request, setRequest] = useState<SelectionRequest | null>(null);
  const sequence = useRef(0);
  const clear = useCallback(
    (requestId?: string) =>
      setRequest((current) =>
        requestId === undefined || current?.id === requestId ? null : current,
      ),
    [],
  );
  return (
    <SelectionContext.Provider
      value={{
        request,
        open: (next) => {
          Keyboard.dismiss();
          const id = `profile-choice-${++sequence.current}`;
          setRequest({ ...next, id });
          router.push(profileSelectionRoute(id));
        },
        clear,
      }}
    >
      {children}
    </SelectionContext.Provider>
  );
}
export function ProfileChoice<T extends ChoiceValue>({
  label,
  value,
  options,
  onChange,
  modalTitle,
  selectionPrompt,
  disabled = false,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly DropdownOption<T>[];
  readonly onChange: (value: T) => void;
  readonly modalTitle?: string;
  readonly selectionPrompt?: string;
  readonly disabled?: boolean;
}) {
  const palette = usePalette();
  const context = useContext(SelectionContext);
  const { busy, nativeChoices } = useContext(ProfileEditorControlContext);
  const returnTo = useContext(ProfilePageTitleContext);
  const [popup, setPopup] = useState(false);
  const useLunaPresentation = nativeChoices && Platform.OS === "ios";
  const locked = busy || disabled;
  const selected = options.find((option) => option.value === value);
  const valueLabel = selected?.selectionLabel ?? selected?.label ?? "Bitte auswählen";
  if (!context) throw new Error("ProfileSelectionProvider fehlt.");
  const request = {
    title: modalTitle ?? label,
    prompt: selectionPrompt,
    returnTo,
    value,
    options,
    onChange: (next: ChoiceValue) => {
      const option = options.find((candidate) => candidate.value === next);
      if (option) onChange(option.value);
    },
  };
  const row = (
    <RowButton
      titleColor={palette.text}
      title={label}
      subtitle={valueLabel}
      disabled={locked}
      accessibilityLabel={`${label}: ${valueLabel}`}
      accessibilityHint="Öffnet die Auswahl. Deine Angaben werden beim Speichern übernommen."
      onPress={() => {
        if (useLunaPresentation) {
          Keyboard.dismiss();
          setPopup(true);
        } else context.open(request);
      }}
    />
  );
  const menuOptions = options.filter((option) => option.value !== "UNSET");
  if (!useLunaPresentation) return row;
  if (menuOptions.length > 0 && !menuOptions.some((option) => option.group || option.subtitle))
    return (
      <LunaChoiceMenu
        compact
        label={label}
        displayLabel={selectionPrompt}
        accessibilityLabel={selectionPrompt}
        value={selected && selected.value !== "UNSET" ? String(selected.value) : null}
        options={menuOptions.map((option) => ({
          value: String(option.value),
          label: option.label,
        }))}
        disabled={locked}
        onChange={(next) => {
          const option = menuOptions.find((candidate) => String(candidate.value) === next);
          if (option) onChange(option.value);
        }}
        testPrefix="profile-native"
        fallback={row}
      />
    );
  return (
    <>
      {row}
      {popup ? (
        <SelectionSheet
          luna
          title={request.title}
          visible
          disabled={locked}
          onClose={() => setPopup(false)}
          cancelLabel={`Zurück zu ${returnTo}`}
          keyboardAware
        >
          {(dismiss) => (
            <View
              testID="profile-selection-content"
              style={{ gap: SPACING.md, padding: SPACING.lg }}
            >
              <ProfileOptionList
                request={request}
                searchable={!selectionPrompt}
                onSelect={(next) => {
                  request.onChange(next);
                  dismiss();
                }}
              />
            </View>
          )}
        </SelectionSheet>
      ) : null}
    </>
  );
}
export function ProfileSelectionScreen() {
  const context = useContext(SelectionContext);
  const params = useLocalSearchParams<{ requestId?: string }>();
  const matchingRequest =
    context?.request && (!params.requestId || params.requestId === context.request.id)
      ? context.request
      : null;
  const [initialRequest] = useState(matchingRequest);
  const request = matchingRequest ?? initialRequest;
  if (!request)
    return (
      <LoadFailureView
        title="Auswahl nicht verfügbar"
        message="Öffne die Auswahl erneut in deinem Arbeitsprofil."
        actionLabel="Zurück"
        onRetry={() => router.back()}
      />
    );
  return <SelectionPage key={request.id} request={request} clear={context!.clear} />;
}
function SelectionPage({
  request,
  clear,
}: {
  readonly request: SelectionRequest;
  readonly clear: (requestId?: string) => void;
}) {
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const headerSide =
    Math.max(insets.left, insets.right) + SPACING.lg + MINIMUM_TOUCH_TARGET + SPACING.sm;
  const titleMaxWidth = Math.max(0, width - 2 * headerSide);
  const choosing = useRef(false);
  useEffect(() => () => clear(request.id), [clear, request.id]);
  return (
    <ProfilePage
      title={request.title}
      backLabel={`Zurück zu ${request.returnTo}`}
      onBack={() => {
        if (choosing.current) return;
        choosing.current = true;
        clear(request.id);
        router.back();
      }}
      testID="profile-selection-content"
    >
      <Stack.Screen
        options={{
          title: request.title,
          presentation: "card",
          headerStyle: { backgroundColor: palette.background },
          headerTintColor: palette.text,
          headerTitleStyle: { color: palette.text },
          headerTitle:
            Platform.OS === "ios" && request.prompt
              ? ({ children }) => (
                  <HeaderTitle tintColor={palette.text} style={{ maxWidth: titleMaxWidth }}>
                    {children}
                  </HeaderTitle>
                )
              : undefined,
          statusBarStyle: palette.dark ? "light" : "dark",
        }}
      />
      <ProfileOptionList
        request={request}
        searchable={request.title === "Tarifvertrag"}
        onSelect={(value) => {
          if (choosing.current) return;
          choosing.current = true;
          request.onChange(value);
          clear(request.id);
          router.back();
        }}
      />
    </ProfilePage>
  );
}

function ProfileOptionList({
  request,
  searchable,
  onSelect,
}: {
  readonly request: Omit<SelectionRequest, "id">;
  readonly searchable: boolean;
  readonly onSelect: (value: ChoiceValue) => void;
}) {
  const palette = usePalette();
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase("de-DE");
  const options = request.options.filter(
    (option) =>
      option.value !== "UNSET" &&
      `${option.label} ${option.subtitle ?? ""} ${option.group ?? ""}`
        .toLocaleLowerCase("de-DE")
        .includes(search),
  );
  const groups = [...new Set(options.map((option) => option.group ?? ""))];
  const searchLabel = request.title === "Tarifvertrag" ? "Tarif suchen" : `${request.title} suchen`;
  return (
    <>
      {request.prompt ? (
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={TEXT_MAX_SCALE}
          style={{ color: palette.text, ...TYPOGRAPHY.sectionTitle }}
        >
          {request.prompt}
        </Text>
      ) : null}
      {searchable ? (
        <Field
          label={searchLabel}
          value={query}
          onChangeText={setQuery}
          placeholder={searchLabel}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      ) : null}
      {groups.map((group) => (
        <View key={group} style={{ gap: SPACING.sm }}>
          {group ? <SectionHeader title={group} /> : null}
          <SurfaceCard>
            {options
              .filter((option) => (option.group ?? "") === group)
              .map((option, index) => (
                <View key={option.value}>
                  {index ? <CardSeparator /> : null}
                  <RowButton
                    title={option.label}
                    subtitle={option.subtitle}
                    accessibilityLabel={option.selectionLabel ?? option.label}
                    accessibilityState={{ selected: option.value === request.value }}
                    trailing={
                      option.value === request.value ? (
                        <Ionicons
                          accessibilityElementsHidden
                          name="checkmark"
                          size={22}
                          color={palette.primary}
                        />
                      ) : (
                        <View style={{ width: 22 }} />
                      )
                    }
                    onPress={() => onSelect(option.value)}
                  />
                </View>
              ))}
          </SurfaceCard>
        </View>
      ))}
      {!options.length ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: palette.textMuted, ...TYPOGRAPHY.body }}
        >
          {request.title === "Tarifvertrag" || request.title === "Tarif"
            ? "Keine passenden Tarife gefunden."
            : "Keine passenden Einträge gefunden."}
        </Text>
      ) : null}
      <Text
        maxFontSizeMultiplier={TEXT_MAX_SCALE}
        style={{ color: palette.textMuted, ...TYPOGRAPHY.footnote }}
      >
        Auswahl wird in deinen Entwurf übernommen.
      </Text>
    </>
  );
}
export function useProfileSelection() {
  const context = useContext(SelectionContext);
  if (!context) throw new Error("ProfileSelectionProvider fehlt.");
  return context;
}
