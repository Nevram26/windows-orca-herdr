// node mods/right-panel/data.check.mjs: which chats show for a project, and in what order.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("./data.js", import.meta.url)), "utf8");
const { norm, worktrees, claudeChats, codexChats, projectChats, claudeTranscript, ago, pushArgs, commitsOf, prDraft, prCreateArgs } = await import(`data:text/javascript;base64,${Buffer.from(src).toString("base64")}`);

const roots = worktrees("worktree C:/Users/Ven/Documents/Coding/TrackSort\nHEAD a\nbranch refs/heads/main\n\nworktree C:/Users/Ven/Documents/Coding/TrackSort-wt/auth\nHEAD b\nbranch refs/heads/auth\n");
assert.deepEqual(roots.map((r) => r.branch), ["main", "auth"]);

const claude = claudeChats([
  { display: "/clear", project: "C:\\USERS\\ven\\documents\\coding\\tracksort", sessionId: "c1", timestamp: 100 },
  { display: "fix   the\nbug", project: "C:\\USERS\\ven\\documents\\coding\\tracksort", sessionId: "c1", timestamp: 300 },
  { display: "later", project: "C:\\USERS\\ven\\documents\\coding\\tracksort", sessionId: "c1", timestamp: 200 },
  { display: "in worktree", project: "C:\\Users\\Ven\\Documents\\Coding\\TrackSort-wt\\auth\\src", sessionId: "c2", timestamp: 500 },
  { display: "deleted worktree", project: "C:\\Users\\Ven\\Documents\\Coding\\TrackSort-wt\\gone", sessionId: "c3", timestamp: 600 },
  { display: "other repo", project: "C:\\Users\\Ven\\Documents\\Coding\\Other", sessionId: "c4", timestamp: 700 },
  { display: "no transcript", project: "C:/Users/Ven/Documents/Coding/TrackSort", sessionId: "c5", timestamp: 50 },
  { display: "/only-command", project: "C:/Users/Ven/Documents/Coding/TrackSort", sessionId: "c6", timestamp: 40 },
].map((e) => JSON.stringify(e)).join("\n"));
assert.equal(claude.find((c) => c.id === "c1").title, "fix the bug");
assert.equal(claude.find((c) => c.id === "c1").at, 300);
assert.equal(claude.find((c) => c.id === "c6").title, "/only-command");

const id = (n) => `0000000${n}-0000-0000-0000-000000000000`;
// A rollout's first line: a nested "cwd" / "parent_thread_id" inside base_instructions must not count.
const meta = (cwd, extra = "") => `{"type":"session_meta","payload":{${extra}"cwd":${JSON.stringify(cwd)},"base_instructions":{"text":"\\"cwd\\":\\"C:\\\\Other\\",\\"parent_thread_id\\":\\"x\\"`;
const codex = codexChats({
  files: [
    { file: `r/rollout-2026-01-01T00-00-00-${id(1)}.jsonl`, mtime: 1000, head: meta("C:\\Users\\Ven\\Documents\\Coding\\TrackSort") },
    { file: `r/rollout-2026-01-01T00-00-00-${id(2)}.jsonl`, mtime: 2000, head: meta("C:\\Users\\Ven\\Documents\\Coding\\TrackSort", `"parent_thread_id":"${id(1)}",`) },
    { file: `r/rollout-2026-01-01T00-00-00-${id(3)}.jsonl`, mtime: 3000, head: meta("C:\\Users\\Ven\\Documents\\Coding\\TrackSort-wt\\auth") },
    { file: `r/rollout-2026-01-01T00-00-00-${id(4)}.jsonl`, mtime: 4000, head: meta("C:\\Users\\Ven\\Documents\\Coding\\TrackSort", `"parent_thread_id":null,`) },
  ],
  index: JSON.stringify({ id: id(1), thread_name: "Named chat", updated_at: new Date(9000).toISOString() }),
  history: JSON.stringify({ session_id: id(3), text: "from history" }),
});
assert.deepEqual(codex.map((c) => c.id), [id(1), id(3), id(4)], "sub-agent thread hidden, null parent kept");
assert.equal(codex[0].at, 9000, "index time wins");
assert.equal(codex[1].title, "from history");
assert.equal(codex[1].at, 3000, "file time without an index entry");

const home = "C:/Users/Ven";
const gone = new Set([norm("C:\\Users\\Ven\\Documents\\Coding\\TrackSort-wt\\gone"), norm(claudeTranscript(home, "C:/Users/Ven/Documents/Coding/TrackSort", "c5"))]);
const exists = async (p) => !gone.has(norm(p));
const out = await projectChats([...claude, ...codex], roots, { exists, home });
assert.deepEqual(out.map((c) => c.id), [id(1), id(4), id(3), "c2", "c1", "c6"], "newest first, both programs mixed");
assert.equal(out.find((c) => c.id === "c2").label, "auth");
assert.equal(out.find((c) => c.id === "c1").label, "main");
assert.equal(claudeTranscript(home, "C:\\Users\\Ven\\Documents\\Coding", "x"), "C:/Users/Ven/.claude/projects/C--Users-Ven-Documents-Coding/x.jsonl");
assert.equal(ago(0, 3 * 86400e3), "3d");

// Push and Create PR: the commands they would run (never run here).
assert.deepEqual(pushArgs("feat/x", true), ["push"]);
assert.deepEqual(pushArgs("feat/x", false), ["push", "-u", "origin", "feat/x"]);
const one = commitsOf("feat: a\x1fbody line\nmore\x1e");
assert.deepEqual(prDraft(one), { title: "feat: a", body: "body line\nmore" });
const two = commitsOf("feat: a\x1f\x1efix: b\x1fbody\x1e");
assert.deepEqual(prDraft(two), { title: "feat: a", body: "- feat: a\n- fix: b" });
assert.deepEqual(prCreateArgs({ title: "T", body: "B", base: "main", branch: "feat/x" }), ["pr", "create", "--title", "T", "--body", "B", "--base", "main", "--head", "feat/x"]);
console.log("right-panel data: ok");
