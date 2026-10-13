import { beforeEach, expect, it, jest } from "@jest/globals";
import { requireOptionalNativeModule } from "expo";
import { ImageManipulator } from "expo-image-manipulator";
import {
  prepareCalendarWidgetBackground,
  pruneCalendarWidgetBackgrounds,
} from "./calendar-widget-background.ios";

const mockFiles = new Map<string, number>();
const mockGroup = "file:///shared/ExpoWidgets";
const mockSource = "file:///app/calendar-backgrounds/calendar-one.jpg";
const mockDelete = jest.fn();
const mockCopy = jest.fn<(uri: string) => Promise<void>>();
const mockResize = jest.fn();
const mockRelease = jest.fn();
let mockDimensions = { width: 1600, height: 1000 };
jest.mock("expo", () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock("expo-file-system", () => {
  class Directory {
    uri: string;
    constructor(...parts: (string | Directory)[]) {
      this.uri = parts.map((p) => (typeof p === "string" ? p.replace(/\/$/, "") : p.uri)).join("/");
    }
    list() {
      return [...mockFiles.keys()]
        .filter(
          (uri) => uri.startsWith(this.uri + "/") && !uri.slice(this.uri.length + 1).includes("/"),
        )
        .map((uri) => new File(uri));
    }
  }
  class File {
    uri: string;
    constructor(...parts: (string | Directory)[]) {
      this.uri = new Directory(...parts).uri;
    }
    get name() {
      return this.uri.split("/").pop()!;
    }
    get parentDirectory() {
      return new Directory(this.uri.slice(0, this.uri.lastIndexOf("/")));
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    get size() {
      return mockFiles.get(this.uri) ?? 0;
    }
    async copy(destination: File) {
      await mockCopy(destination.uri);
      mockFiles.set(destination.uri, this.size);
    }
    delete() {
      mockDelete(this.uri);
      mockFiles.delete(this.uri);
    }
  }
  return { Directory, File, Paths: { document: "file:///app" } };
});
jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  ImageManipulator: {
    manipulate: jest.fn(() => ({
      resize: mockResize,
      release: mockRelease,
      renderAsync: async () => ({
        ...mockDimensions,
        release: mockRelease,
        saveAsync: async () => {
          mockFiles.set("file:///cache/widget.jpg", 12000);
          return { uri: "file:///cache/widget.jpg" };
        },
      }),
    })),
  },
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockFiles.clear();
  mockFiles.set(mockSource, 30000);
  jest.mocked(requireOptionalNativeModule).mockReturnValue({ widgetsDirectory: mockGroup });
  mockCopy.mockResolvedValue();
  mockDimensions = { width: 1600, height: 1000 };
});
it("copies a bounded JPEG to the group and publishes only a relative filename", async () => {
  expect(await prepareCalendarWidgetBackground(mockSource)).toBe("luna-widget-calendar-one.jpg");
  expect(mockResize).toHaveBeenCalledWith({ width: 720 });
  expect(mockFiles.has(mockGroup + "/luna-widget-calendar-one.jpg")).toBe(true);
  expect(mockDelete).toHaveBeenCalledWith("file:///cache/widget.jpg");
  expect(mockFiles.has(mockSource)).toBe(true);
  expect(mockRelease).toHaveBeenCalledTimes(3);
});
it("reuses an immutable local photo and bounds portrait images without stretching", async () => {
  mockDimensions = { width: 600, height: 1600 };
  await prepareCalendarWidgetBackground(mockSource);
  expect(mockResize).toHaveBeenCalledWith({ height: 720 });
  await prepareCalendarWidgetBackground(mockSource);
  expect(ImageManipulator.manipulate).toHaveBeenCalledTimes(1);
});
it("needs no photo work for Standard or unavailable groups", async () => {
  expect(await prepareCalendarWidgetBackground(null)).toBeNull();
  jest.mocked(requireOptionalNativeModule).mockReturnValue(null);
  expect(await prepareCalendarWidgetBackground(mockSource)).toBeNull();
  expect(ImageManipulator.manipulate).not.toHaveBeenCalled();
});
it("rejects remote, arbitrary, missing and oversized files before reading an image", async () => {
  for (const uri of [
    "https://example.test/calendar-one.jpg",
    "file:///app/private.jpg",
    "file:///app/calendar-backgrounds/calendar-missing.jpg",
  ]) {
    await expect(prepareCalendarWidgetBackground(uri)).rejects.toThrow("Invalid local");
  }
  mockFiles.set(mockSource, 9 * 1024 * 1024);
  await expect(prepareCalendarWidgetBackground(mockSource)).rejects.toThrow("Invalid local");
  expect(ImageManipulator.manipulate).not.toHaveBeenCalled();
});
it("removes a failed partial copy and releases images without touching the source", async () => {
  mockCopy.mockImplementation(async (uri) => {
    mockFiles.set(uri, 2);
    throw new Error("copy failed");
  });
  await expect(prepareCalendarWidgetBackground(mockSource)).rejects.toThrow("copy failed");
  expect(mockFiles.has(mockGroup + "/luna-widget-calendar-one.jpg")).toBe(false);
  expect(mockFiles.has(mockSource)).toBe(true);
  expect(mockRelease).toHaveBeenCalledTimes(3);
});
it("prunes only obsolete owned photos after publication and clears them on removal", () => {
  for (const name of [
    "luna-widget-calendar-one.jpg",
    "luna-widget-calendar-two.jpg",
    "other-widget.jpg",
    "nested/private.jpg",
  ])
    mockFiles.set(mockGroup + "/" + name, 10);
  pruneCalendarWidgetBackgrounds("luna-widget-calendar-one.jpg");
  expect(mockDelete.mock.calls).toEqual([[mockGroup + "/luna-widget-calendar-two.jpg"]]);
  pruneCalendarWidgetBackgrounds(null);
  expect(mockFiles.has(mockGroup + "/luna-widget-calendar-one.jpg")).toBe(false);
  expect(mockFiles.has(mockGroup + "/other-widget.jpg")).toBe(true);
  expect(mockFiles.has(mockSource)).toBe(true);
});
