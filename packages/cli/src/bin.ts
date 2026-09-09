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
 * Two groups, and the split is real rather than cosmetic: `validate`, `fmt`,
 * `diff` and `dev` work on a directory and need nothing else, while `link`,
 * `login`, `status`, `pull`, `plan` and `apply` talk to a server through
 * `@forinda-cms/sdk` — never to a database. That is ADR 0002 seam 4, and it is
 * what makes Phase 1's MCP server a second consumer instead of a rewrite.
 */
import { resolve } from "node:path";
import { Command, InvalidArgumentError, Option } from "commander";

import { dev, diff, fmt, validate } from "./commands.js";
import { init, type InitOptions } from "./init.js";
import { STARTERS } from "@forinda-cms/spec";
import { apply, link, login, logout, plan, pull, status } from "./remote.js";
import { dim } from "./report.js";

/**
 * Replaced by the bundler with the published version.
 *
 * Declared rather than imported because there is no manifest beside the bundle
 * at runtime, and `0.0.0-dev` is the honest answer when running from source —
 * a source checkout has no released version to report.
 */
declare const __FCMS_VERSION__: string | undefined;
const VERSION = typeof __FCMS_VERSION__ === "string" ? __FCMS_VERSION__ : "0.0.0-dev";

function port(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new InvalidArgumentError("must be a port between 1 and 65535.");
  }
  return n;
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("fcms")
    .description("forinda-cms — build and run a site from a spec")
    .version(VERSION, "-v, --version")
    .showHelpAfterError()
    .configureHelp({ sortSubcommands: false });

  program
    .command("init")
    .argument("[dir]", "where to put it", ".")
    .option("--starter <key>", `what to start from — ${STARTERS.map((s) => s.key).join(", ")}`)
    .option("--name <name>", "the site's name, if not the directory's")
    .option("--force", "scaffold into a directory that already has files in it")
    .description("create a site you can already run")
    .action((dir: string, options: InitOptions) => process.exit(init(resolve(dir), options)));

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
    .command("diff")
    .argument("<before>", "spec directory as it is now")
    .argument("<after>", "spec directory with the change applied")
    .description("describe what changed, in plain language")
    .action((before: string, after: string) => process.exit(diff(resolve(before), resolve(after))));

  program
    .command("dev")
    .argument("[dir]", "spec directory", ".")
    .addOption(new Option("-p, --port <number>", "port to listen on").default(4321).argParser(port))
    .description("serve the site locally, reloading on save")
    .action((dir: string, options: { port: number }) => {
      // Long-running: no exit, the server holds the process open.
      dev(resolve(dir), options.port);
    });

  program
    .command("link")
    .argument("<url>", "base URL of the forinda-cms server")
    .argument("[dir]", "spec directory", ".")
    .description("link this directory to a site")
    .action((url: string, dir: string) => process.exit(link(resolve(dir), url)));

  program
    .command("login")
    .argument("[dir]", "spec directory", ".")
    .option("--url <url>", "server to sign in to, if this directory is not linked")
    .option("--email <email>", "owner email, prompted for when absent")
    .description("authenticate against a forinda-cms server")
    .action(async (dir: string, options: { url?: string; email?: string }) => {
      // The password is never an option: an argument is visible in `ps` and in
      // shell history. `FCMS_PASSWORD` covers CI, a prompt covers a person.
      process.exit(await login(resolve(dir), options));
    });

  program
    .command("logout")
    .argument("[dir]", "spec directory", ".")
    .option("--url <url>", "server to forget, if this directory is not linked")
    .description("forget the stored token for a server")
    .action((dir: string, options: { url?: string }) =>
      process.exit(logout(resolve(dir), options.url)),
    );

  program
    .command("status")
    .argument("[dir]", "spec directory", ".")
    .description("what the linked site looks like right now")
    .action(async (dir: string) => process.exit(await status(resolve(dir))));

  program
    .command("pull")
    .argument("[dir]", "spec directory", ".")
    .option("--content", "also write every entry to data/<type>.yaml")
    .description("render the remote spec back to canonical files")
    .action(async (dir: string, options: { content?: boolean }) =>
      process.exit(await pull(resolve(dir), options)),
    );

  program
    .command("plan")
    .argument("[dir]", "spec directory", ".")
    .description("diff local files against the remote spec — exits 2 if destructive")
    .action(async (dir: string) => process.exit(await plan(resolve(dir))));

  program
    .command("apply")
    .argument("[dir]", "spec directory", ".")
    .option("-y, --yes", "confirm destructive changes")
    .option("--content", "also send every row in data/<type>.yaml")
    .description("apply local files to the linked site, gating destructive changes")
    .action(async (dir: string, options: { yes?: boolean; content?: boolean }) =>
      process.exit(await apply(resolve(dir), options)),
    );

  program.addHelpText(
    "after",
    `\n${dim("Local, no server needed:")}\n` +
      `${dim("  fcms dev ./examples/salon")}\n` +
      `\n${dim("Against a server:")}\n` +
      `${dim("  fcms link https://example.com && fcms login && fcms plan")}\n`,
  );

  return program;
}

buildProgram().parse();
