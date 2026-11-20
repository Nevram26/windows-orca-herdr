import { mkdir, unlink } from "fs/promises";
import { appHome } from "herdr";
import { importFile } from "./operations.js";

// Native image() resolves assets under appHome, so workspace images need a disposable copy.
export async function prepareImage(file, on = null) {
  if (on) throw new Error("Image preview is available only for local files");
  const ext = file.split(".").pop().toLowerCase();
  const path = `mods/files-open-with/.cache/${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.${ext}`;
  const absolute = `${appHome()}/${path}`;
  await mkdir(`${appHome()}/mods/files-open-with/.cache`, { recursive: true });
  try { await importFile(file, absolute); }
  catch (error) { await releaseImage({ absolute }); throw error; }
  return { path, absolute };
}

export async function releaseImage(preview) {
  if (preview) await unlink(preview.absolute).catch(() => {});
}
