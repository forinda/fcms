/**
 * Release notes, from the commits.
 *
 * GitHub can generate notes on its own, but only as a flat list of pull request
 * titles. Commits here are conventional (`feat(cli): …`), which is a grouping
 * nobody has to maintain — so the notes are grouped, and a reader can see at a
 * glance whether a release is features, fixes or housekeeping.
 *
 *   node scripts/notes.mjs              # since the previous tag, to HEAD
 *   node scripts/notes.mjs 2026.4       # since the previous tag, to 2026.4
 */
import { execFileSync } from "node:child_process";

const git = (...argv) => execFileSync("git", argv, { encoding: "utf8" }).trim();

const to = process.argv[2] ?? "HEAD";

// The tag before this one, by version order rather than by date: tags are cut
// from `main` in sequence, and a re-cut tag would otherwise reorder history.
const tags = git("tag", "--list", "--sort=-v:refname").split("\n").filter(Boolean);
const from = tags.find((tag) => tag !== to);

const range = from ? `${from}..${to}` : to;
const commits = git("log", range, "--no-merges", "--pretty=format:%s\t%h")
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [subject, sha] = line.split("\t");
    const match = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(subject);
    if (!match) return { type: "other", scope: null, breaking: false, text: subject, sha };
    return { type: match[1], scope: match[2] ?? null, breaking: match[3] === "!", text: match[4], sha };
  });

// Ordered by what a reader cares about first. Anything not listed lands in
// "Other", rather than being dropped — a commit that fell out of the notes
// because its prefix was a typo is worse than an untidy heading.
const SECTIONS = [
  ["feat", "Features"],
  ["fix", "Fixes"],
  ["perf", "Performance"],
  ["refactor", "Refactoring"],
  ["docs", "Documentation"],
  ["test", "Tests"],
  ["build", "Build"],
  ["ci", "CI"],
  ["chore", "Housekeeping"],
];

const out = [];

const breaking = commits.filter((c) => c.breaking);
if (breaking.length > 0) {
  out.push("## Breaking", "");
  for (const c of breaking) out.push(line(c));
  out.push("");
}

for (const [type, heading] of SECTIONS) {
  const group = commits.filter((c) => c.type === type && !c.breaking);
  if (group.length === 0) continue;
  out.push(`## ${heading}`, "");
  for (const c of group) out.push(line(c));
  out.push("");
}

const rest = commits.filter(
  (c) => !c.breaking && !SECTIONS.some(([type]) => type === c.type),
);
if (rest.length > 0) {
  out.push("## Other", "");
  for (const c of rest) out.push(line(c));
  out.push("");
}

if (commits.length === 0) out.push("No changes.", "");

out.push("## Install", "");
out.push("```sh");
out.push(`docker pull ghcr.io/forinda/fcms:${to === "HEAD" ? "latest" : to}`);
out.push(`npm install -g @forinda/fcms-cli@${to === "HEAD" ? "latest" : to}`);
out.push("```");

if (from) {
  out.push("", `**Full diff:** https://github.com/forinda/fcms/compare/${from}...${to}`);
}

console.log(out.join("\n"));

function line(commit) {
  const scope = commit.scope ? `**${commit.scope}:** ` : "";
  return `- ${scope}${commit.text} (${commit.sha})`;
}
