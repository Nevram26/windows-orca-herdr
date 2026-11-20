import { exec, writeTextFile, window } from "herdr";

const DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const psQuote = value => `'${String(value).replaceAll("'", "''")}'`;

export function validateName(value) {
  const name = String(value ?? "");
  if (!name.trim()) return "Enter a file name";
  if (name === "." || name === ".." || /[\\/]/.test(name)) return "Use a file name without path separators";
  if (/[<>:\"|?*\x00-\x1f]/.test(name) || /[ .]$/.test(name) || DEVICE.test(name)) return "This name is not supported on Windows";
  return null;
}

export function targetPath(root, folder, name, on = null) {
  if (validateName(name)) throw new Error(validateName(name));
  const parts = String(folder ?? "").split("/").filter(Boolean);
  if (parts.some(part => part === "." || part === "..")) throw new Error("Invalid target folder");
  const separator = !on && window()?.platform === "windows" ? "\\" : "/";
  return [String(root).replace(/[\\/]+$/, ""), ...parts, name].join(separator);
}

export async function createFile(path, text, on = null) {
  if (on) throw new Error("File creation is available only for local files");
  return writeTextFile(path, text, null);
}

export async function saveText(path, text, expected, on = null) {
  if (on) throw new Error("Saving is available only for local files");
  return writeTextFile(path, text, expected);
}

export async function importFile(source, destination, on = null, platform = window()?.platform) {
  if (on) throw new Error("Import is available only for local files");
  let command, args;
  if (platform === "windows") {
    command = "powershell";
    args = ["-NoProfile", "-NonInteractive", "-Command", `[IO.File]::Copy(${psQuote(source)},${psQuote(destination)},$false)`];
  } else if (platform === "macos") {
    command = "/bin/sh";
    args = ["-c", 'set -eu; src=$1; dest=$2; dir=${dest%/*}; tmp=$(mktemp "$dir/.herdr-import.XXXXXXXX"); trap \'rm -f "$tmp"\' EXIT HUP INT TERM; cp -p -- "$src" "$tmp"; ln "$tmp" "$dest"', "files-import", source, destination];
  } else throw new Error("Import is unavailable on this platform");
  const result = await exec(command, args);
  if (result.code !== 0) throw new Error(result.stderr?.trim() || `Import exited with ${result.code}`);
}

export async function openExternal(path, on = null, platform = window()?.platform) {
  if (on) throw new Error("Opening files in local applications is unavailable for remote files");
  const command = platform === "windows" ? "powershell" : platform === "macos" ? "open" : null;
  if (!command) throw new Error("Opening files in a local application is unavailable on this platform");
  const args = platform === "windows"
    ? ["-NoProfile", "-NonInteractive", "-Command", `Invoke-Item -LiteralPath ${psQuote(path)}`]
    : [path];
  const result = await exec(command, args);
  if (result.code !== 0) throw new Error(result.stderr?.trim() || `Open exited with ${result.code}`);
}

export async function moveToTrash(path, on = null, platform = window()?.platform) {
  if (on) throw new Error("Delete is unavailable for remote files");
  let command, args;
  if (platform === "windows") {
    command = "powershell";
    const script = `$ErrorActionPreference = 'Stop'; $p = ${psQuote(path)}; $item = Get-Item -LiteralPath $p -Force; if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Refusing to delete a directory or symbolic link' }; Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')`;
    args = ["-NoProfile", "-NonInteractive", "-Command", script];
  } else if (platform === "macos") {
    command = "/bin/sh";
    args = ["-c", 'test -f "$1" && [ ! -L "$1" ] || { echo "Refusing to delete a directory or symbolic link" >&2; exit 1; }; exec osascript -e "on run argv" -e \'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)\' -e "end run" "$1"', "files-delete", path];
  } else throw new Error("Delete is unavailable on this platform");
  const result = await exec(command, args);
  if (result.code !== 0) throw new Error(result.stderr?.trim() || `Delete exited with ${result.code}`);
}

export async function replaceFile(source, destination, on = null, platform = window()?.platform) {
  if (on) throw new Error("Replace is unavailable for remote files");
  let command, args;
  if (platform === "windows") {
    command = "powershell";
    const script = `$ErrorActionPreference = 'Stop'; $src = ${psQuote(source)}; $dest = ${psQuote(destination)}; $item = Get-Item -LiteralPath $dest -Force -ErrorAction SilentlyContinue; if ($item -and ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint))) { throw 'Refusing to replace a directory or symbolic link' }; $dir = [IO.Path]::GetDirectoryName($dest); $tmp = [IO.Path]::Combine($dir, [IO.Path]::GetRandomFileName()); $backup = [IO.Path]::Combine($dir, [IO.Path]::GetRandomFileName()); try { [IO.File]::Copy($src,$tmp,$false); if ([IO.File]::Exists($dest)) { [IO.File]::Replace($tmp,$dest,$backup) } else { [IO.File]::Move($tmp,$dest) } } finally { if ([IO.File]::Exists($tmp)) { Remove-Item -LiteralPath $tmp -Force }; if ([IO.File]::Exists($backup)) { Remove-Item -LiteralPath $backup -Force } }`;
    args = ["-NoProfile", "-NonInteractive", "-Command", script];
  } else if (platform === "macos") {
    command = "/bin/sh";
    args = ["-c", 'set -eu; src=$1; dest=$2; dir=${dest%/*}; tmp=$(mktemp "$dir/.herdr-replace.XXXXXXXX"); trap \'rm -f "$tmp"\' EXIT HUP INT TERM; cp -p -- "$src" "$tmp"; if [ -e "$dest" ] || [ -L "$dest" ]; then [ -f "$dest" ] && [ ! -L "$dest" ] || { echo "Refusing to replace a directory or symbolic link" >&2; exit 1; }; fi; mv -f -- "$tmp" "$dest"', "files-replace", source, destination];
  } else throw new Error("Replace is unavailable on this platform");
  const result = await exec(command, args);
  if (result.code !== 0) throw new Error(result.stderr?.trim() || `Replace exited with ${result.code}`);
}
