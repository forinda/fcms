/**
 * No document may tell a reader to run a package we do not publish.
 *
 * `fcms`, `forinda-cms`, `fcms-cli`, `fcms-core` and `fcms-mcp` are *binary*
 * names. The packages are `@forinda/…`, and the difference disappears only
 * inside a project that has one installed, where the local binary wins.
 * Outside one, `npx <binary>` is a request to npm for whatever that name
 * happens to be — and `fcms` is already somebody else's package.
 *
 * The rest are unclaimed today, which is the reason this is a test rather than
 * a note: the day one of them is claimed, every reader who typed it runs a
 * stranger's code, and the mistake that gets them there is a single word in a
 * markdown file.
 *
 * In-project usage is exempt, because there the local binary is what runs — but
 * it has to be visibly in a project, which is what the fences below check.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

const documents = execFileSync("git", ["ls-files", "*.md", "*.astro", "*.mdx"], {
  encoding: "utf8",
  cwd: root,
})
  .split("\n")
  .filter(Boolean);

/** `npx fcms …`, and the same in every other runner. */
const RUNNERS = String.raw`npx|pnpm dlx|yarn dlx|bunx`;
const BINARIES = String.raw`fcms|forinda-cms|fcms-cli|fcms-core|fcms-mcp`;
const bare = new RegExp(String.raw`(?:${RUNNERS})\s+(?:-y\s+)?(?:${BINARIES})\b`, "g");

describe("documentation", () => {
  it("never runs one of our binaries by its bare name", () => {
    const offenders: string[] = [];

    for (const file of documents) {
      const text = readFileSync(join(root, file), "utf8");
      for (const line of text.split("\n")) {
        // A line that is plainly inside a project — it installed it first, or
        // it is running a script — is running the local binary.
        if (/npm install|--save-dev|install -g|node_modules/.test(line)) continue;
        for (const match of line.matchAll(bare)) offenders.push(`${file}: ${match[0]}`);
      }
    }

    // Every one of these should name the package: `npx @forinda/fcms-cli …`.
    expect(offenders).toEqual([]);
  });
});
