import { defineConfig } from "vitest/config";
import base from "../vitest.config";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["scripts/benchmark-private-cloud.ts"],
    maxWorkers: 1,
    fileParallelism: false,
  },
});
