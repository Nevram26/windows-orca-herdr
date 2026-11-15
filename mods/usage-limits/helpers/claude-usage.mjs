// Windows twin of claude-usage.sh (run with Node, see ask.mjs): the same `get_usage`
// control request, same output and exits.
//
// Exit: 0 = printed the reply, 127 = claude CLI not found, 1 = no reply in 15 s.
// Override the binary with HERDR_USAGE_CLAUDE_BIN.
import { ask, found } from "./ask.mjs";

const bin = found(process.env.HERDR_USAGE_CLAUDE_BIN || "claude");
if (!bin) process.exit(127);

const reply = await ask(bin,
  ["-p", "--safe-mode", "--no-session-persistence", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"],
  ['{"type":"control_request","request_id":"herdr-usage-limits","request":{"subtype":"get_usage","skip_behaviors":true}}'],
  (l) => l.includes('"control_response"'));
if (reply) console.log(reply);
process.exit(reply ? 0 : 1);
