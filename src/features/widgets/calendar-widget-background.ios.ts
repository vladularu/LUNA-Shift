import { requireOptionalNativeModule } from "expo";
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

const OWN_PHOTO = /^luna-widget-calendar-[a-z0-9-]+\.jpg$/;
function sharedDirectory(): Directory | null {
  const module = requireOptionalNativeModule<{ readonly widgetsDirectory: string | null }>(
    "ExpoWidgets",
  );
  const uri = module?.widgetsDirectory;
  return typeof uri === "string" && uri.startsWith("file://") ? new Directory(uri) : null;
}

// Share only the selected, already-imported calendar JPEG. Never pass an app
// sandbox path into the timeline or fetch remote images in the widget process.
export async function prepareCalendarWidgetBackground(uri: string | null): Promise<string | null> {
  if (uri === null) return null;
  const directory = sharedDirectory();
  if (directory === null) return null;
  const source = new File(uri);
  const appPhotos = new Directory(Paths.document, "calendar-backgrounds");
  if (
    source.parentDirectory.uri !== appPhotos.uri ||
    !/^calendar-[a-z0-9-]+\.jpg$/.test(source.name) ||
    !source.exists ||
    source.size <= 0 ||
    source.size > 8 * 1024 * 1024
  ) {
    throw new Error("Invalid local calendar background.");
  }
  const name = `luna-widget-${source.name}`;
  const destination = new File(directory, name);
  if (destination.exists && destination.size > 0) return name;
  const context = ImageManipulator.manipulate(source.uri);
  try {
    const original = await context.renderAsync();
    const width = original.width,
      height = original.height;
    original.release();
    if (Math.max(width, height) > 720)
      context.resize(width >= height ? { width: 720 } : { height: 720 });
    const image = await context.renderAsync();
    try {
      const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
      const temporary = new File(saved.uri);
      try {
        await temporary.copy(destination, { overwrite: true });
      } finally {
        if (temporary.exists) temporary.delete();
      }
      if (!destination.exists || destination.size <= 0)
        throw new Error("Empty widget calendar background.");
      return name;
    } finally {
      image.release();
    }
  } catch (cause) {
    if (destination.exists) destination.delete();
    throw cause;
  } finally {
    context.release();
  }
}

// Called only after the current timeline was published. Keep the source app
// photo and every other widget asset untouched, including folders.
export function pruneCalendarWidgetBackgrounds(keep: string | null): void {
  const directory = sharedDirectory();
  if (directory === null) return;
  for (const file of directory.list()) {
    if (file instanceof File && OWN_PHOTO.test(file.name) && file.name !== keep) file.delete();
  }
}
