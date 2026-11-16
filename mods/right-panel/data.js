// Pure parts of the right panel (no Herdr calls): which chats show for a project, and the git/gh commands behind Push and Create PR.

// Windows paths mix \ and / and differ in case.
export const norm = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const under = (dir, root) => dir === root || dir.startsWith(`${root}/`);
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const rows = (text) => String(text ?? "").split("\n").flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });
const UUID = /([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/i;

// `git worktree list --porcelain` -> [{ path, branch }], the main checkout first.
export function worktrees(porcelain) {
  return String(porcelain ?? "").split(/\r?\n\r?\n/).flatMap((block) => {
    const path = /^worktree (.+?)\r?$/m.exec(block)?.[1];
    return path ? [{ path, branch: /^branch refs\/heads\/(.+?)\r?$/m.exec(block)?.[1] ?? "" }] : [];
  });
}

// ~/.claude/history.jsonl: one line per prompt. Title = the first prompt (not a /command, if there is another).
export function claudeChats(history) {
  const by = new Map();
  for (const e of rows(history)) {
    if (!e.sessionId || !e.project) continue;
    const c = by.get(e.sessionId) ?? { program: "claude", id: e.sessionId, folder: e.project, first: "", title: "", at: 0 };
    const text = clean(e.display);
    c.first ||= text;
    if (!c.title && text && !text.startsWith("/")) c.title = text;
    c.at = Math.max(c.at, Number(e.timestamp) || 0);
    by.set(e.sessionId, c);
  }
  return [...by.values()].map(({ first, ...c }) => ({ ...c, title: c.title || first }));
}

// The slug Claude Code files a project's transcripts under.
export const claudeTranscript = (home, folder, id) => `${home}/.claude/projects/${folder.replace(/[^A-Za-z0-9]/g, "-")}/${id}.jsonl`;

// files: [{ file, mtime, head }] (head: the start of a rollout's first line). Sub-agent threads are left out.
export function codexChats({ files, index, history }) {
  const names = new Map(rows(index).map((e) => [e.id, e]));
  const said = new Map();
  for (const e of rows(history)) if (e.session_id && !said.has(e.session_id)) said.set(e.session_id, clean(e.text));
  return files.flatMap(({ file, mtime, head }) => {
    const id = UUID.exec(file)?.[1];
    // Only the session_meta fields before the long base_instructions text count.
    const meta = String(head ?? "").split('"base_instructions"')[0];
    if (!id || /"parent_thread_id"\s*:\s*"/.test(meta)) return [];
    const cwd = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(meta)?.[1];
    if (!cwd) return [];
    const n = names.get(id);
    return [{ program: "codex", id, folder: JSON.parse(`"${cwd}"`), title: clean(n?.thread_name) || said.get(id) || "Codex chat", at: Date.parse(n?.updated_at) || Number(mtime) || 0 }];
  });
}

// The chats of this repo and its live worktrees that can still be resumed, newest first.
// roots: [{ path, branch }]; exists(path) -> Promise<boolean>.
export async function projectChats(chats, roots, { exists, home }) {
  const mine = chats.flatMap((c) => {
    const dir = norm(c.folder);
    const root = roots.filter((r) => under(dir, norm(r.path))).sort((a, b) => b.path.length - a.path.length)[0];
    return root ? [{ ...c, root }] : [];
  });
  const ok = await Promise.all(mine.map(async (c) => (await exists(c.folder)) && (c.program !== "claude" || (await exists(claudeTranscript(home, c.folder, c.id))))));
  return mine.filter((_, i) => ok[i]).sort((a, b) => b.at - a.at)
    .map(({ root, ...c }) => ({ ...c, label: root.branch || root.path.split(/[\\/]/).pop() }));
}

export function ago(at, now = Date.now()) {
  const s = Math.max(0, (now - at) / 1000);
  for (const [n, u] of [[604800, "w"], [86400, "d"], [3600, "h"], [60, "m"]]) if (s >= n) return `${Math.floor(s / n)}${u}`;
  return "now";
}

// ---- Push and Create PR ----

// Push the current branch; the first push sets its upstream.
export const pushArgs = (branch, hasUpstream) => (hasUpstream ? ["push"] : ["push", "-u", "origin", branch]);

// `git log --reverse --format=%s%x1f%b%x1e base..HEAD` -> [{ subject, body }].
export const commitsOf = (log) => String(log ?? "").split("\x1e").map((c) => c.trim()).filter(Boolean)
  .map((c) => { const [subject, body = ""] = c.split("\x1f"); return { subject: subject.trim(), body: body.trim() }; });

// One commit: its subject and body. Several: the first subject, and the subjects as a bullet list.
export const prDraft = (commits) => commits.length === 1
  ? { title: commits[0].subject, body: commits[0].body }
  : { title: commits[0]?.subject ?? "", body: commits.map((c) => `- ${c.subject}`).join("\n") };

export const prCreateArgs = ({ title, body, base, branch }) => ["pr", "create", "--title", title, "--body", body, "--base", base, "--head", branch];
