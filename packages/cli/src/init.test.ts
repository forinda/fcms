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

import { init, packageManager } from "./init.js";
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

/**
 * Whichever package manager the reader is actually holding.
 *
 * Printing `npm install` to somebody who typed `bun x` is a small thing that
 * says the tool was not written for them. Every manager sets
 * `npm_config_user_agent` when it runs a binary, so this is a read and not a
 * guess.
 */
describe("the package manager", () => {
  it("is taken from the agent that ran the command", () => {
    expect(packageManager("pnpm/9.1.0 npm/? node/v22").install).toBe("pnpm install");
    expect(packageManager("bun/1.1.0").install).toBe("bun install");
    // Yarn installs with a bare `yarn`, and has since v1.
    expect(packageManager("yarn/4.1.0 npm/? node/v22").install).toBe("yarn");
    expect(packageManager("npm/10.5.0 node/v22").install).toBe("npm install");
  });

  it("falls back to npm when there is nothing to read", () => {
    // A bare `node` invocation sets nothing, and npm is what that machine most
    // likely has.
    expect(packageManager("").name).toBe("npm");
  });

  it("knows which ones need `run` and which do not", () => {
    expect(packageManager("yarn/4.1.0").run("dev")).toBe("yarn dev");
    expect(packageManager("pnpm/9.1.0").run("dev")).toBe("pnpm dev");
    expect(packageManager("bun/1.1.0").run("dev")).toBe("bun run dev");
    expect(packageManager("npm/10.5.0").run("dev")).toBe("npm run dev");
  });

  it("names the right way to run a binary without installing it", () => {
    expect(packageManager("bun/1.1.0").exec).toBe("bunx");
    expect(packageManager("pnpm/9.1.0").exec).toBe("pnpm");
    expect(packageManager("npm/10.5.0").exec).toBe("npx");
  });

  it("writes the generated README in the reader's own commands", () => {
    const dir = scratch();
    process.env["npm_config_user_agent"] = "bun/1.1.0";
    try {
      init(dir);
      const readme = readFileSync(join(dir, "README.md"), "utf8");
      expect(readme).toContain("bun install");
      expect(readme).toContain("bunx fcms validate");
      expect(readme).not.toContain("npm install");
    } finally {
      delete process.env["npm_config_user_agent"];
    }
  });
});
