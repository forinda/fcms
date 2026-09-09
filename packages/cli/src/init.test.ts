/**
 * `fcms init` (ADR 0036's starters, as files).
 *
 * The shape every other command assumes was documented and never generated, so
 * a first afternoon began by typing out a layout from prose. What matters about
 * the output is not that files appear: it is that the tools in the same package
 * accept them without being asked to fix anything first.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { init } from "./init.js";
import { fmt, validate } from "./commands.js";

const dirs: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "fcms-init-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("init", () => {
  it("writes a project its own tools already accept", () => {
    const dir = scratch();
    expect(init(dir)).toBe(0);

    // Valid, and canonical: a scaffold that `fmt` immediately rewrites teaches
    // the wrong thing on the very first command.
    expect(validate(dir)).toBe(0);
    expect(fmt(dir, true)).toBe(0);
  });

  it("writes the files the rest of the layout expects", () => {
    const dir = scratch();
    init(dir);

    for (const path of ["site.yaml", "package.json", ".gitignore", ".mcp.json", "README.md"]) {
      expect(existsSync(join(dir, path)), path).toBe(true);
    }
    // The database is data, not source. Committing 40 MB of Postgres is a
    // mistake somebody makes exactly once.
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain(".fcms/");
    // No path in the MCP configuration, so it is the same on every machine.
    expect(readFileSync(join(dir, ".mcp.json"), "utf8")).toContain("@forinda/fcms-mcp");
  });

  it("names the site after the directory, in title case", () => {
    const dir = scratch();
    const nested = join(dir, "riverside-rooms");
    mkdirSync(nested);
    init(nested);

    expect(readFileSync(join(nested, "site.yaml"), "utf8")).toContain("Riverside Rooms");
  });

  it("takes a name when the directory is not one", () => {
    const dir = scratch();
    init(dir, { name: "The Harbour" });
    expect(readFileSync(join(dir, "site.yaml"), "utf8")).toContain("The Harbour");
  });

  it("refuses a directory with work in it, and says so", () => {
    const dir = scratch();
    writeFileSync(join(dir, "site.yaml"), "mine\n", "utf8");

    expect(init(dir)).toBe(1);
    expect(readFileSync(join(dir, "site.yaml"), "utf8")).toBe("mine\n");
    // Meant, and said out loud.
    expect(init(dir, { force: true })).toBe(0);
  });

  it("ignores node_modules and .git when deciding that", () => {
    // Scaffolding into a freshly cloned or npm-installed directory is the
    // normal case, not the dangerous one.
    const dir = scratch();
    mkdirSync(join(dir, "node_modules"));
    mkdirSync(join(dir, ".git"));

    expect(init(dir)).toBe(0);
  });

  it("refuses a starter that does not exist, and lists the ones that do", () => {
    const dir = scratch();
    expect(init(dir, { starter: "nonsense" })).toBe(1);
    expect(existsSync(join(dir, "site.yaml"))).toBe(false);
  });
});
