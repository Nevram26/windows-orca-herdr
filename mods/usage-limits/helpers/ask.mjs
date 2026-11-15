// Windows: ask a CLI one question over its stdin/stdout, the way the *.sh helpers do,
// without Git's sh. Under Herdr (no console) that sh's polling `sleep` could hang; Herdr
// stopped sh at 30 s and the CLI it had started stayed running. Node waits on the pipe
// itself and always ends the CLI's whole process tree, answer or not.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

// The CLI's path, or null when it isn't installed: a path is checked as a file, a bare
// name is looked up on PATH (claude.cmd, codex.exe…).
export function found(bin) {
  return (/[\\/]/.test(bin) ? existsSync(bin) : spawnSync("where", [bin], { windowsHide: true }).status === 0) ? bin : null;
}

// Writes `lines` to `bin args`, keeps stdin open, and resolves with the first output line
// `isAnswer` accepts, or null after `ms`.
export function ask(bin, args, lines, isAnswer, ms = 15000) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { shell: true, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    let buffered = "", done = false;
    const finish = (line) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
      resolve(line);
    };
    const timer = setTimeout(() => finish(null), ms);
    const scan = (text) => text.split("\n").map((l) => l.trim()).find(isAnswer) ?? null;
    child.stdout.on("data", (chunk) => {
      const lines = (buffered + chunk).split("\n");
      buffered = lines.pop();
      const answer = scan(lines.join("\n"));
      if (answer) finish(answer);
    });
    child.on("error", () => finish(null));
    child.on("exit", () => finish(scan(buffered)));
    child.stdin.on("error", () => {});
    child.stdin.write(lines.map((l) => `${l}\n`).join(""));
  });
}
