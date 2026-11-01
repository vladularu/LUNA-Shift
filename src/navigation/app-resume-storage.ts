import { createAppResumeStore } from "./app-resume-state";

// Browser navigation already has its own URL/history. Native storage is platform-specific.
export const appResumeStore = createAppResumeStore({
  read: async () => null,
  write: async () => {},
});
