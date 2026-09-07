#!/usr/bin/env node
/**
 * `fcms` — the entry point.
 *
 * ADR 0002 scopes this to a *management* surface, Netlify-shaped rather than
 * WP-CLI-shaped: authenticate, link a directory to a site, preview, inspect. The
 * scriptable half — bulk content verbs, JSON-first automation — is deliberately
 * absent and stays absent, because doc 11 §2 argues a scriptable CLI *and* an
 * MCP server means two machine doors to keep in sync for one audience. MCP is
 * the machine door.
 *
 * Phase 0a ships the three commands that need no server. The rest are declared
 * here as stubs rather than hidden, so `fcms --help` tells the truth about what
 * the tool will become instead of pretending the surface is finished.
 */
import { resolve } from "node:path";
import { Command, InvalidArgumentError, Option } from "commander";

import { dev, fmt, validate } from "./commands.js";
import { dim, yellow } from "./report.js";

function port(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new InvalidArgumentError("must be a port between 1 and 65535.");
  }
  return n;
}

/** Not yet implemented, and honest about why rather than silently missing. */
function comingInPhase0b(name: string, what: string): Command {
  return new Command(name)
    .description(`${what} ${dim("(Phase 0b)")}`)
    .allowUnknownOption()
    .action(() => {
      console.error(
        `${yellow("not yet")} \`fcms ${name}\` needs a server to talk to — it arrives with Phase 0b.`,
      );
      console.error(dim("  Phase 0a is local only: validate, fmt, dev."));
      process.exit(2);
    });
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("fcms")
    .description("forinda-cms — build and run a site from a spec")
    .version("0.0.0", "-v, --version")
    .showHelpAfterError()
    .configureHelp({ sortSubcommands: false });

  program
    .command("validate", { isDefault: false })
    .argument("[dir]", "spec directory", ".")
    .description("check the spec and report problems with file, line and column")
    .action((dir: string) => process.exit(validate(resolve(dir))));

  program
    .command("fmt")
    .argument("[dir]", "spec directory", ".")
    .option("--check", "exit non-zero if any file is not canonical, and write nothing")
    .description("rewrite every file in canonical form")
    .action((dir: string, options: { check?: boolean }) =>
      process.exit(fmt(resolve(dir), options.check === true)),
    );

  program
    .command("dev")
    .argument("[dir]", "spec directory", ".")
    .addOption(new Option("-p, --port <number>", "port to listen on").default(4321).argParser(port))
    .description("serve the site locally, reloading on save")
    .action((dir: string, options: { port: number }) => {
      // Long-running: no exit, the server holds the process open.
      dev(resolve(dir), options.port);
    });

  for (const [name, what] of [
    ["login", "authenticate against a forinda-cms server"],
    ["link", "link this directory to a remote site"],
    ["pull", "render the remote spec back to canonical files"],
    ["plan", "diff local files against the remote spec"],
    ["apply", "apply a plan, gating destructive changes"],
  ] as const) {
    program.addCommand(comingInPhase0b(name, what));
  }

  program.addHelpText(
    "after",
    `\n${dim("Phase 0a is local: a spec directory, no database, no account.")}\n` +
      `${dim("  fcms dev ./examples/salon")}\n`,
  );

  return program;
}

buildProgram().parse();
