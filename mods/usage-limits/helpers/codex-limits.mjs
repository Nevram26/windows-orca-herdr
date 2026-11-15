// Windows twin of codex-limits.sh (run with Node, see ask.mjs): `codex app-server`
// account/rateLimits/read, else the newest rate-limit snapshot Codex logged in its sessions
// (last 14 days) as {"snapshot": <line>}. Same output and exits.
//
// Exit: 0 = printed something, 127 = codex CLI not found, 1 = no reply and no snapshot.
// Override the binary with HERDR_USAGE_CODEX_BIN; sessions follow CODEX_HOME.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ask, found } from "./ask.mjs";

// Not installed: say so, even if old session logs exist (they'd look like a reading).
const bin = found(process.env.HERDR_USAGE_CODEX_BIN || "codex");
if (!bin) process.exit(127);

const reply = await ask(bin, ["app-server"], [
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"herdr-usage-limits","version":"1.0"}}}',
  '{"jsonrpc":"2.0","method":"initialized"}',
  '{"jsonrpc":"2.0","id":2,"method":"account/rateLimits/read","params":{}}',
], (l) => /^\{"id":2[,}]/.test(l));
if (reply) { console.log(reply); process.exit(0); }

// No answer: the newest logged snapshot, from the 30 most recent session files.
const sessions = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "sessions");
const since = Date.now() - 14 * 86400000;
let files = [];
try {
  files = readdirSync(sessions, { recursive: true }).filter((f) => String(f).endsWith(".jsonl"))
    .map((f) => { const path = join(sessions, String(f)); return { path, at: statSync(path).mtimeMs }; })
    .filter((f) => f.at >= since).sort((a, b) => b.at - a.at).slice(0, 30);
} catch {}
for (const { path } of files) {
  const line = readFileSync(path, "utf8").split("\n").filter((l) => l.includes('"rate_limits":{')).pop();
  if (line) { console.log(`{"snapshot":${line.trim()}}`); process.exit(0); }
}
process.exit(1);
