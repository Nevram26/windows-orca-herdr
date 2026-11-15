// Open issues assigned to you on GitHub, in every repo. The nav is always loaded, so it
// fetches them (one `gh search`), shares them as "issues.assigned" for the Issues popup's
// Assigned tab, and writes data/issues/assigned.{md,json} for agents to read instead of
// asking GitHub. The popup asks for a fresh list with shared "issues.assignedWant".
import * as fs from "fs/promises";
import { exec, appHome } from "herdr";

export const EVERY = 5 * 60000;
const FIELDS = "repository,number,title,labels,assignees,author,state,updatedAt,url";
const rank = (i) => Number(i.labels.map((l) => /^priority:P(\d)$/i.exec(l.name)?.[1]).find(Boolean) ?? 9);

// Grouped by repo (most issues first), then by priority label (P0 first), then newest.
export function sortAssigned(items) {
  const count = new Map();
  for (const i of items) count.set(i.repo, (count.get(i.repo) ?? 0) + 1);
  return [...items].sort((a, b) => count.get(b.repo) - count.get(a.repo) || a.repo.localeCompare(b.repo)
    || rank(a) - rank(b) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function fetchAssigned() {
  const r = await exec("gh", ["search", "issues", "--assignee", "@me", "--state", "open", "--limit", "200", "--json", FIELDS]);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `gh exited with ${r.code}`);
  return sortAssigned(JSON.parse(r.stdout).map((i) => ({
    repo: i.repository.nameWithOwner, number: i.number, title: i.title, url: i.url, updatedAt: i.updatedAt,
    state: String(i.state).toUpperCase(), author: i.author, assignees: i.assignees ?? [],
    labels: (i.labels ?? []).map((l) => ({ name: l.name, color: l.color })),
  })));
}

export function markdown(items, at) {
  const out = [
    "# Issues assigned to me on GitHub (open)", "",
    `Updated ${new Date(at).toISOString()} by Herdr, every 5 minutes (Issues → Assigned → ↻ refreshes now).`,
    "Source: `gh search issues --assignee @me --state open`. Read this instead of asking GitHub for the list;",
    "use `gh issue view <number> -R <repo>` only for one issue's full text or comments.", "",
  ];
  if (!items.length) out.push("Nothing is assigned to me.");
  let repo = null;
  for (const i of items) {
    if (i.repo !== repo) {
      repo = i.repo;
      out.push(`## ${repo} (${items.filter((x) => x.repo === repo).length})`, "");
    }
    const labels = i.labels.length ? ` [${i.labels.map((l) => l.name).join(", ")}]` : "";
    out.push(`- #${i.number} ${i.title}${labels} — ${i.url}`);
  }
  return out.join("\n") + "\n";
}

export async function writeAssigned(items, at) {
  const dir = `${appHome()}/data/issues`;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(`${dir}/assigned.json`, JSON.stringify({ at, items }, null, 1));
  await fs.writeFile(`${dir}/assigned.md`, markdown(items, at));
}

export async function readAssigned() {
  try { return JSON.parse(await fs.readFile(`${appHome()}/data/issues/assigned.json`, "utf8")); } catch { return null; }
}
