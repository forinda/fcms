/**
 * The reference documents everything, and stays that way.
 *
 * A command added to the CLI and not to `REFERENCE.md` is a command nobody
 * finds; an environment variable added to the engine and not to the reference
 * is a setting somebody has to read the source to discover. Both happen by
 * omission rather than by decision, which is what a test is for.
 *
 * It reads the real definitions — commander's own tree, and the engine's env
 * schema — rather than a list kept beside them, because a list kept beside them
 * is the thing that goes stale.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildProgram } from "./program.js";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const reference = readFileSync(join(root, "REFERENCE.md"), "utf8");

describe("REFERENCE.md", () => {
  it("documents every command", () => {
    const commands = buildProgram()
      .commands.map((c) => c.name())
      .filter((name) => name !== "help");

    expect(commands.filter((name) => !reference.includes(`fcms ${name}`))).toEqual([]);
  });

  it("documents every option of every command", () => {
    const missing: string[] = [];

    for (const command of buildProgram().commands) {
      for (const option of command.options) {
        // The long flag is the one a reader looks for; `-p` is a convenience.
        if (option.long && !reference.includes(option.long)) {
          missing.push(`${command.name()} ${option.long}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it("documents every setting the server reads", () => {
    // Read out of the engine's schema rather than listed here, so a new
    // variable fails this the moment it is added.
    const config = readFileSync(join(root, "apps/engine/src/config/index.ts"), "utf8");
    const declared = [...config.matchAll(/^\s{4}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]!);

    expect(declared.length).toBeGreaterThan(5);
    expect(declared.filter((name) => !reference.includes(name))).toEqual([]);
  });

  it("documents every tool an agent can call", () => {
    const mcp = readFileSync(join(root, "packages/mcp/src/index.ts"), "utf8");
    const tools = [...mcp.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]!);

    expect(tools.length).toBeGreaterThan(5);
    expect(tools.filter((tool) => !reference.includes(tool))).toEqual([]);
  });
});
