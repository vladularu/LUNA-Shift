import { useEffect, useRef, useState } from "react";
import type { SQLiteDatabase } from "expo-sqlite";
import * as picker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { File } from "expo-file-system";
import { isAccountPhoto } from "@/domain/account-photo";
import { UserFacingError, userFacingErrorMessage } from "@/domain/errors";
import {
  loadAccountPhoto,
  saveAccountPhoto,
} from "@/infrastructure/database/account-photo-repository";
import type { PrivateCloudRuntime } from "@/features/private-cloud/private-cloud-context";

async function choosePhoto(): Promise<string | undefined> {
  const selection = await picker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: false,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.85,
    exif: false,
  });
  if (selection.canceled) return undefined;
  const asset = selection.assets[0];
  if (
    !asset ||
    !Number.isFinite(asset.width) ||
    !Number.isFinite(asset.height) ||
    asset.width <= 0 ||
    asset.height <= 0 ||
    new File(asset.uri).size > 20 * 1024 * 1024
  )
    throw new UserFacingError("Bitte wähle ein gültiges Foto mit höchstens 20 MB.");
  const context = ImageManipulator.manipulate(asset.uri);
  try {
    const edge = Math.min(asset.width, asset.height);
    context.crop({
      originX: (asset.width - edge) / 2,
      originY: (asset.height - edge) / 2,
      width: edge,
      height: edge,
    });
    context.resize({ width: Math.min(edge, 512), height: Math.min(edge, 512) });
    const image = await context.renderAsync();
    try {
      const result = await image.saveAsync({
        format: SaveFormat.JPEG,
        compress: 0.8,
        base64: true,
      });
      try {
        if (!result.base64 || !isAccountPhoto(result.base64))
          throw new UserFacingError("Dieses Foto ist zu groß. Bitte wähle ein anderes Bild.");
        return result.base64;
      } finally {
        try {
          const temporary = new File(result.uri);
          if (temporary.exists) temporary.delete();
        } catch {
          /* Cache cleanup must not lose a prepared photo. */
        }
      }
    } finally {
      image.release();
    }
  } finally {
    context.release();
  }
}

export function useAccountPhoto(
  db: SQLiteDatabase,
  accountId: string | null,
  ready: boolean,
  runtime: PrivateCloudRuntime,
) {
  const [state, setState] = useState<{
    accountId: string | null;
    image: string | null;
    ready: boolean;
    error: string | null;
  }>({ accountId: null, image: null, ready: false, error: null });
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const generation = useRef(0);
  const identity = useRef(accountId);
  identity.current = accountId;
  useEffect(() => {
    const epoch = ++generation.current;
    if (!ready || !accountId) return;
    setState({ accountId, image: null, ready: false, error: null });
    void loadAccountPhoto(db, accountId).then(
      (image) => {
        if (epoch === generation.current)
          setState({ accountId, image: image ?? null, ready: true, error: null });
      },
      () => {
        if (epoch === generation.current)
          setState({
            accountId,
            image: null,
            ready: true,
            error: "Dein Profilbild konnte nicht geladen werden. Du kannst es erneut auswählen.",
          });
      },
    );
    return () => {
      generation.current = epoch + 1;
    };
  }, [db, accountId, ready]);

  async function change(remove: boolean) {
    if (working.current || !ready || !accountId || !state.ready || state.accountId !== accountId)
      return;
    const epoch = generation.current;
    const current = () =>
      epoch === generation.current &&
      identity.current === accountId &&
      runtime.isCurrentAccount(accountId);
    if (!current()) return;
    working.current = true;
    setBusy(true);
    setState((previous) => ({ ...previous, error: null }));
    try {
      const image = remove ? null : await choosePhoto();
      if (image === undefined || !current()) return;
      await saveAccountPhoto(db, accountId, image, current);
      if (!current()) return;
      setState({ accountId, image, ready: true, error: null });
      // Saving locally succeeds offline. The existing sync status reports cloud failures.
      void runtime.synchronize();
    } catch (error) {
      if (current())
        setState((previous) => ({
          ...previous,
          error: userFacingErrorMessage(
            error,
            "Dein Profilbild konnte nicht gespeichert werden. Bitte versuche es erneut.",
          ),
        }));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  const visible = ready && state.accountId === accountId;
  return {
    uri: visible && state.image ? `data:image/jpeg;base64,${state.image}` : null,
    ready: visible && state.ready,
    busy,
    error: visible ? state.error : null,
    choose: () => change(false),
    remove: () => change(true),
  };
}
