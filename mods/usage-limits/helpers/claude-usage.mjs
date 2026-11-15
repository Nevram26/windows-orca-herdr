// Windows twin of claude-usage.sh: the same `get_usage` control request, same output and exits.
// Git's sh polling with `sleep` could hang when Herdr runs it (no console); Herdr then
// stopped sh at 30 s and every claude it had started stayed running. Node waits on the
// pipe itself and ends the CLI's whole process tree, answer or not.
//
// Exit: 0 = printed the reply, 127 = claude CLI not found, 1 = no reply in 15 s.
// Override the binary with HERDR_USAGE_CLAUDE_BIN.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const bin = process.env.HERDR_USAGE_CLAUDE_BIN || "claude";
// A path is checked as a file; a bare name is looked up on PATH (claude.cmd, claude.exe…).
if (/[\\/]/.test(bin) ? !existsSync(bin) : spawnSync("where", [bin], { windowsHide: true }).status !== 0) process.exit(127);

const REQUEST = '{"type":"control_request","request_id":"herdr-usage-limits","request":{"subtype":"get_usage","skip_behaviors":true}}\n';
const child = spawn(bin, ["-p", "--safe-mode", "--no-session-persistence", "--input-format", "stream-json",
  "--output-format", "stream-json", "--verbose"], { shell: true, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });

let buffered = "", done = false;
const finish = (line) => {
  if (done) return;
  done = true;
  clearTimeout(timer);
  spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
  if (line) process.stdout.write(`${line}\n`);
  process.exit(line ? 0 : 1);
};
const timer = setTimeout(() => finish(null), 15000);
child.stdout.on("data", (chunk) => {
  buffered += chunk;
  const lines = buffered.split("\n");
  buffered = lines.pop();
  const reply = lines.find((l) => l.includes('"control_response"'));
  if (reply) finish(reply.trim());
});
child.on("error", () => finish(null));
child.on("exit", () => finish(buffered.includes('"control_response"') ? buffered.trim() : null));
child.stdin.on("error", () => {});
child.stdin.write(REQUEST);
