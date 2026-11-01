import * as SecureStore from "expo-secure-store";
import { createAppResumeStore } from "./app-resume-state";

const KEY = "luna.last-view.v1";
export const appResumeStore = createAppResumeStore({
  read: () => SecureStore.getItemAsync(KEY),
  write: (value) =>
    value === null
      ? SecureStore.deleteItemAsync(KEY)
      : SecureStore.setItemAsync(KEY, value, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }),
});
