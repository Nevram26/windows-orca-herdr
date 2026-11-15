// The right-click menu, top to bottom. Edit this list to make it yours.
//
//   label  what the menu shows
//   icon   menu-<icon>.svg in this folder: square-pen, file-text, search, folder, files, bot, trash
//   os     "macos" or "windows": shown only there
//   app    a macOS app name: runs `open -a <app> <path>`; hidden when the app isn't installed
//   argv   or your own command: (path) => [program, ...args], run on this computer without a shell
//   when   "file" or "dir" to show it for only one kind (default: both)
//   local  true: hidden for files on another machine (the command needs the file here).
//          App items are always local.
//   agent  true: after argv puts the file on the clipboard, it is pasted into this space's
//          agent as if dropped there. Hidden when the space has no agent.
//
// More apps, for example:
//   { label: "Open in Zed", icon: "square-pen", app: "Zed", os: "macos" },
//   { label: "Open in Cursor", icon: "square-pen", app: "Cursor", os: "macos" },
//   { label: "Open in Xcode", icon: "square-pen", app: "Xcode", when: "file", os: "macos" },
//   { label: "Open in Terminal", icon: "folder", app: "Terminal", when: "dir", os: "macos" },

import { exec, window } from "herdr";

// Windows: the path reaches PowerShell as a quoted argument, never as script text.
const ps = script => p => ["powershell", "-NoProfile", "-Command", `& { param($p) ${script} } '${p.replaceAll("'", "''")}'`];
// macOS: the same through AppleScript's `on run argv`.
const osa = line => p => ["osascript", "-e", "on run argv", "-e", line, "-e", "end run", p];
const RECYCLE = "Add-Type -AssemblyName Microsoft.VisualBasic; $fs = [Microsoft.VisualBasic.FileIO.FileSystem]; " +
  "if (Test-Path -LiteralPath $p -PathType Container) { $fs::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') } " +
  "else { $fs::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }";

export const ITEMS = [
  { label: "Add to agent", icon: "bot", agent: true, local: true, os: "macos", argv: osa("set the clipboard to (POSIX file (item 1 of argv))") },
  { label: "Add to agent", icon: "bot", agent: true, local: true, os: "windows", argv: ps("Set-Clipboard -LiteralPath $p") },
  { label: "Open in VS Code", icon: "square-pen", app: "Visual Studio Code", os: "macos" },
  { label: "Open in Preview", icon: "file-text", app: "Preview", when: "file", os: "macos" },
  { label: "Quick Look", icon: "search", argv: p => ["qlmanage", "-p", p], when: "file", local: true, os: "macos" },
  { label: "Open with default app", icon: "file-text", argv: p => ["open", p], local: true, os: "macos" },
  { label: "Open with default app", icon: "file-text", argv: ps("Invoke-Item -LiteralPath $p"), when: "file", local: true, os: "windows" },
  { label: "Reveal in Finder", icon: "folder", argv: p => ["open", "-R", p], local: true, os: "macos" },
  { label: "Show in File Explorer", icon: "folder", argv: ps("Start-Process explorer.exe -ArgumentList ('/select,' + [char]34 + $p + [char]34)"), local: true, os: "windows" },
  { label: "Copy path", icon: "files", argv: p => ["sh", "-c", 'printf %s "$1" | pbcopy', "copy-path", p], os: "macos" },
  { label: "Copy path", icon: "files", argv: ps("Set-Clipboard -Value $p"), os: "windows" },
  { label: "Move to Trash", icon: "trash", argv: osa('tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)'), local: true, os: "macos" },
  { label: "Move to Recycle Bin", icon: "trash", argv: ps(RECYCLE), local: true, os: "windows" },
];

export function argvOf(item, path) {
  return item.app ? ["open", "-a", item.app, path] : item.argv(path);
}

// Popup height for n items: padding, the file name line, 31px rows.
export function menuHeight(n) {
  return 10 + 26 + n * 31 + 4;
}

// Which apps are installed, asked at most once a minute.
const APP_DIRS = ["/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities", "~/Applications", "/Applications/Setapp"];
const FIND = `for a in "$@"; do
  for d in ${APP_DIRS.map(d => (d.startsWith("~") ? `"$HOME${d.slice(1)}"` : `"${d}"`)).join(" ")}; do
    if [ -d "$d/$a.app" ]; then echo "$a"; continue 2; fi
  done
  q="kMDItemContentType == 'com.apple.application-bundle' && kMDItemFSName == '$a.app'"
  [ -n "$(mdfind "$q" 2>/dev/null | head -n 1)" ] && echo "$a"
done; true`;
let installed = null, checked = 0;

async function installedApps(apps) {
  if (installed && Date.now() - checked < 60000) return installed;
  const r = await exec("sh", ["-c", FIND, "find-apps", ...apps]).catch(() => null);
  installed = new Set((r?.stdout ?? "").split("\n").filter(Boolean));
  checked = Date.now();
  return installed;
}

// Indexes into ITEMS that apply to this target ({ path, dir, on, agent }).
export async function available(target) {
  const os = window()?.platform;
  const fits = ITEMS.map((it, i) => [it, i])
    .filter(([it]) => it.os === os)
    .filter(([it]) => !it.when || it.when === (target.dir ? "dir" : "file"))
    .filter(([it]) => !(target.on && (it.local || it.app)))
    .filter(([it]) => !it.agent || target.agent);
  const apps = fits.some(([it]) => it.app) ? await installedApps([...new Set(fits.filter(([it]) => it.app).map(([it]) => it.app))]) : null;
  return fits.filter(([it]) => !it.app || apps.has(it.app)).map(([, i]) => i);
}
