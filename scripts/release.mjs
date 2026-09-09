/**
 * Cut a release.
 *
 * A release here is one tag: pushing it builds the image and publishes both npm
 * packages, all carrying the number the tag names. There is nothing to commit
 * and no version to bump by hand — which is exactly why the tag has to be
 * right, because an npm version is permanent and cannot be republished.
 *
 * So this refuses more than it does: wrong branch, dirty tree, behind the
 * remote, a tag that already exists. Each of those has a way of producing a
 * release that does not match what anybody reviewed.
 *
 *   pnpm release              # the next number for this year
 *   pnpm release 2026.4.0     # that one
 *   pnpm release --dry-run    # say what would happen, change nothing
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipVerify = args.includes("--skip-verify");
const explicit = args.find((a) => !a.startsWith("-"));

const git = (...argv) => execFileSync("git", argv, { encoding: "utf8" }).trim();
const dim = (text) => `\x1b[2m${text}\x1b[0m`;
const die = (message, hint) => {
  console.error(`\x1b[31mrefusing\x1b[0m ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
};

// Tags are cut from `main`, because the tag is the release and the release is
// what was reviewed. A tag on a branch publishes code nobody merged.
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "main") die(`on \`${branch}\`, not \`main\`.`, "git checkout main");

if (git("status", "--porcelain") !== "") {
  die("the working tree has changes.", "Commit or stash them; the tag names a commit, not a directory.");
}

// Fetched, not assumed: a tag pushed from a stale checkout points at a commit
// that is not the head of the branch it claims to release.
git("fetch", "--tags", "--quiet", "origin");
const local = git("rev-parse", "HEAD");
const remote = git("rev-parse", "origin/main");
if (local !== remote) {
  die("`main` and `origin/main` disagree.", "git pull --ff-only, then look at what came in.");
}

/**
 * Every package a tag would publish, read rather than listed.
 *
 * This printed two names while the release workflow published three, because
 * the list was written out by hand and a package was added to one and not the
 * other. The preview exists to say what is about to go out, so it has to be
 * derived from the same thing that decides: a manifest that is not private and
 * asks for public access.
 */
function publishable() {
  return readdirSync("packages", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const directory = join("packages", entry.name);
      const manifest = join(directory, "package.json");
      if (!existsSync(manifest)) return [];
      const pkg = JSON.parse(readFileSync(manifest, "utf8"));
      if (pkg.private === true || pkg.publishConfig?.access !== "public") return [];
      return [{ name: pkg.name, directory }];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The next number for this year (ADR 0012: the deployable is CalVer).
 *
 * `YYYY.N.P` — the year, a release counting from 1 within it, and a patch. The
 * third number is not decoration: npm rejects anything that is not full semver
 * (`Invalid version: 2026.1`), and a release that publishes an image and then
 * fails at the registry is the worst half of a release to have.
 *
 * The count restarts each year, so the first release of 2027 is `2027.1.0`
 * rather than continuing 2026's.
 */
function nextVersion() {
  const year = new Date().getFullYear();
  const used = git("tag", "--list", `${year}.*`)
    .split("\n")
    .filter(Boolean)
    .map((tag) => Number(tag.split(".")[1]))
    .filter((n) => Number.isInteger(n));
  return `${year}.${Math.max(0, ...used) + 1}.0`;
}

const version = explicit ?? nextVersion();
if (!/^\d{4}\.\d+\.\d+$/.test(version)) {
  die(
    `\`${version}\` is not a CalVer tag.`,
    "It is YYYY.N.P with no `v` — 2026.4.0, not v2026.4 or 2026.4. npm rejects anything that is not full semver.",
  );
}
if (git("tag", "--list", version) !== "") {
  die(`\`${version}\` already exists.`, "A published version is permanent. Pick the next number.");
}

console.log(`\x1b[1m${version}\x1b[0m \x1b[2m— ${local.slice(0, 7)} on main\x1b[0m`);
const [year, minor] = version.split(".");
console.log(
  `\x1b[2m  ghcr.io/forinda/fcms       ${version}, ${year}.${minor}, ${year}, latest\x1b[0m`,
);
for (const pkg of publishable()) {
  console.log(`\x1b[2m  ${pkg.name.padEnd(26)}${version}\x1b[0m`);
}

const previous = git("tag", "--list", "--sort=-v:refname").split("\n").filter(Boolean)[0];
if (previous) {
  const log = git("log", "--oneline", "--no-merges", `${previous}..HEAD`);
  const lines = log ? log.split("\n") : [];
  console.log(`\n\x1b[1m${lines.length} commit(s)\x1b[0m \x1b[2msince ${previous}\x1b[0m`);
  for (const line of lines.slice(0, 15)) console.log(`  ${line}`);
  if (lines.length > 15) console.log(`  \x1b[2m… and ${lines.length - 15} more\x1b[0m`);
  if (lines.length === 0) die("nothing has changed since the last release.");
} else {
  console.log("\n\x1b[2mfirst release — nothing to compare against.\x1b[0m");
}

if (dryRun) {
  console.log("\n\x1b[2mdry run: no tag written.\x1b[0m");
  process.exit(0);
}

// Locally, before the tag exists. CI runs this too, but CI runs it *after* the
// push, and by then the only way to unpublish is to ask npm nicely.
if (!skipVerify) {
  console.log("\n\x1b[2mpnpm verify …\x1b[0m");
  try {
    execFileSync("pnpm", ["verify"], { stdio: "inherit" });
  } catch {
    die("`pnpm verify` failed.", "Fix it, or pass --skip-verify if you know why it is failing.");
  }
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question(`\nTag and push \x1b[1m${version}\x1b[0m? [y/N] `)).trim().toLowerCase();
rl.close();
if (answer !== "y" && answer !== "yes") {
  console.log("nothing done.");
  process.exit(1);
}

/**
 * The number, written where somebody can read it.
 *
 * It used to live only in the tag: CI wrote it into each manifest at publish
 * time and `main` stayed at `0.0.0` forever. That kept releases to one command
 * and made the repository misreport itself — every local `pnpm pack` produced a
 * `0.0.0` tarball, `fcms --version` needed a bundler trick to avoid printing a
 * lie, and answering "what version is this?" meant leaving the checkout.
 *
 * So the manifests are bumped and committed, and the tag points at that commit.
 * CI still runs `npm version` with `--allow-same-version`, where it is now a
 * no-op that keeps a hand-pushed tag publishing the right number.
 */
const manifests = ["package.json", ...publishable().map((pkg) => join(pkg.directory, "package.json"))];
for (const pkg of publishable()) {
  execFileSync("npm", ["version", version, "--no-git-tag-version", "--allow-same-version"], {
    cwd: pkg.directory,
    stdio: "ignore",
  });
}
execFileSync("npm", ["version", version, "--no-git-tag-version", "--allow-same-version"], {
  stdio: "ignore",
});

git("add", ...manifests);
git("commit", "-m", `chore(release): ${version}`);

// Tagged after the commit, so the tag names a tree whose manifests say what the
// tag says. Pushed in that order too: a tag on a commit nobody else has is a
// release nobody can check out.
git("tag", "-a", version, "-m", `Release ${version}`);
git("push", "origin", "main");
git("push", "origin", version);

console.log(`\n\x1b[32mpushed\x1b[0m ${version} ${dim("— manifests bumped, tagged, both pushed")}`);
console.log("\x1b[2m  gh run watch — the image, then every package, then the release notes.\x1b[0m");
