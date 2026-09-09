/**
 * The commands that need a server.
 *
 * Every one of them goes through `@forinda-cms/sdk` — ADR 0002 seam 4 — so this
 * file contains no HTTP, no SQL and no knowledge of either. What it does own is
 * the human half: which errors are worth a sentence, what a plan reads like
 * before you agree to it, and the refusal that makes a destructive change a
 * decision rather than an accident.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { splitFiles } from "@forinda-cms/lang";

import { pullContent, pushContent } from "./content.js";
import {
  ApiError,
  Client,
  forgetToken,
  normalize,
  readLink,
  readToken,
  UnreachableError,
  writeLink,
  writeToken,
} from "@forinda-cms/sdk";
import type { SpecChange } from "@forinda-cms/spec";

import { loadProject } from "./project.js";
import { bold, dim, green, printDiagnostics, red, yellow } from "./report.js";

/** `fcms link <url>` — name the server this directory publishes to. */
export function link(root: string, url: string): number {
  const path = writeLink(root, { url: normalize(url) });
  console.log(`${green("linked")} ${bold(normalize(url))}`);
  console.log(dim(`  wrote ${path} — safe to commit, it holds no secret.`));
  console.log(dim(`  next: fcms login`));
  return 0;
}

export async function login(
  root: string,
  options: { url?: string; email?: string; password?: string },
): Promise<number> {
  const url = options.url ? normalize(options.url) : readLink(root)?.url;
  if (!url) return notLinked();

  const email = options.email ?? (await ask("email: "));
  // Read from the environment when given, so CI never puts a password in a
  // process list where every other user on the box can read it.
  const password =
    options.password ?? process.env["FCMS_PASSWORD"] ?? (await ask("password: ", true));

  try {
    const session = await new Client({ url, source: "cli" }).login(email, password);
    const path = writeToken(url, {
      token: session.token,
      expiresAt: session.expiresAt,
      email: session.owner.email,
    });
    console.log(`${green("signed in")} ${bold(session.owner.email)} at ${url}`);
    console.log(dim(`  token stored in ${path} (0600), expires ${session.expiresAt}`));
    return 0;
  } catch (error) {
    return reportApiError(error);
  }
}

/** `fcms logout` — drop the token for this server. */
export function logout(root: string, url?: string): number {
  const target = url ? normalize(url) : readLink(root)?.url;
  if (!target) return notLinked();
  forgetToken(target);
  console.log(`${green("signed out")} ${dim(target)}`);
  return 0;
}

export async function status(root: string): Promise<number> {
  const client = connect(root);
  if (!client) return 1;

  try {
    const { site, counts, lastChange } = await client.status();
    if (!site) {
      console.log(
        `${yellow("empty")} that server has no spec yet — ${dim("fcms apply")} publishes one.`,
      );
      return 0;
    }

    console.log(`${bold(site.name)} ${dim(`— ${site.types} content types, ${site.pages} pages`)}`);
    const rows = Object.entries(counts);
    if (rows.length > 0) {
      console.log(dim(`  ${rows.map(([key, n]) => `${key} ${n}`).join(", ")}`));
    }
    if (lastChange) {
      console.log(
        `  ${dim(`#${lastChange.seq}`)} ${lastChange.summary} ` +
          dim(`— ${lastChange.actor} via ${lastChange.source}, ${lastChange.at}`),
      );
    }
    return 0;
  } catch (error) {
    return reportApiError(error);
  }
}

/**
 * `fcms pull` — the remote spec, written as canonical files.
 *
 * Printed through the same `splitFiles` that `fmt` uses, so a `pull` followed by
 * a `fmt --check` is silent. Two printers would make "pull then commit" produce
 * a diff nobody wrote.
 */
export async function pull(root: string, options: { content?: boolean } = {}): Promise<number> {
  const client = connect(root);
  if (!client) return 1;

  try {
    const spec = await client.spec();
    const files = splitFiles(spec);

    for (const [name, text] of Object.entries(files)) {
      const path = join(root, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text, "utf8");
    }

    console.log(
      `${green("pulled")} ${bold(spec.name)} ${dim(`— ${Object.keys(files).length} files`)}`,
    );
    console.log(dim("  files not in the remote spec are left alone; delete them yourself."));

    // The rows, when asked for. Off by default because a spec is small and a
    // site's content is not, and `pull` is run in a loop by people iterating on
    // the shape (ADR 0043).
    if (options.content) return pullContent(root, client, spec);
    return 0;
  } catch (error) {
    return reportApiError(error);
  }
}

export async function plan(root: string): Promise<number> {
  const client = connect(root);
  if (!client) return 1;

  const loaded = loadProject(root);
  if (!loaded.ok) {
    printDiagnostics(root, loaded.diagnostics);
    return 1;
  }

  try {
    const result = await client.plan(loaded.project.spec);
    printPlan(result.initial, result.changes, result.migration.length);
    // Non-zero when confirmation would be needed, so CI can gate on it without
    // parsing the output.
    return result.destructive > 0 ? 2 : 0;
  } catch (error) {
    return reportApiError(error);
  }
}

export async function apply(
  root: string,
  options: { yes?: boolean; content?: boolean },
): Promise<number> {
  const client = connect(root);
  if (!client) return 1;

  const loaded = loadProject(root);
  if (!loaded.ok) {
    printDiagnostics(root, loaded.diagnostics);
    return 1;
  }

  const spec = loaded.project.spec;

  try {
    // Planned first, always. `apply` printing what it is about to do — before it
    // does it — is what makes `--yes` an informed default rather than a blind
    // one, and it costs one request.
    const planned = await client.plan(spec);
    printPlan(planned.initial, planned.changes, planned.migration.length);

    if (planned.changes.length === 0 && !planned.initial) {
      console.log(dim("  nothing to apply."));
      // The shape is already right; the rows may not be, and that is exactly
      // the case where somebody is restoring content onto a site that already
      // has its spec (ADR 0043).
      return options.content ? pushContent(root, client, spec) : 0;
    }

    if (planned.destructive > 0 && options.yes !== true) {
      console.error(
        `${red("refusing")} ${planned.destructive} destructive change(s). ` +
          `Re-run with ${bold("--yes")} if that is what you mean.`,
      );
      return 2;
    }

    const result = await client.apply(spec, { allowDestructive: options.yes === true });
    console.log(
      `${green("applied")} ${dim(`patch #${result.seq}`)}` +
        (result.migration.length > 0 ? dim(` — ${result.migration.length} migration step(s)`) : ""),
    );
    console.log(dim("  undo it from the admin's history screen."));

    // After the spec, never before: a row cannot be written against a type the
    // site does not have yet.
    if (options.content) return pushContent(root, client, spec);
    return 0;
  } catch (error) {
    return reportApiError(error);
  }
}

/** The client for this directory, or a message saying what is missing. */
function connect(root: string): Client | null {
  // A file with a port in it and no URL is a project that has not been linked
  // yet, which is the same situation as no file at all.
  const url = readLink(root)?.url;
  if (!url) {
    notLinked();
    return null;
  }

  const token = readToken(url);
  if (!token) {
    console.error(
      `${yellow("not signed in")} run ${bold("fcms login")} — no live token for ${url}.`,
    );
    return null;
  }

  return new Client({ url, token, source: "cli" });
}

function notLinked(): number {
  console.error(`${yellow("not linked")} run ${bold("fcms link <url>")} first.`);
  return 1;
}

function printPlan(initial: boolean, changes: readonly SpecChange[], steps: number): void {
  if (initial) {
    console.log(`${bold("first publish")} ${dim("— nothing to compare against.")}`);
  } else if (changes.length === 0) {
    console.log(`${green("no changes")} ${dim("— the remote spec already matches these files.")}`);
    return;
  }

  for (const change of changes) {
    const destructive = change.classification === "destructive";
    const mark = destructive ? red("destructive") : dim(change.classification);
    console.log(`  ${mark} ${change.summary}`);
    if (destructive && change.impact) console.log(`    ${yellow(change.impact)}`);
  }

  if (steps > 0) console.log(dim(`  ${steps} migration step(s)`));
}

/**
 * One place that turns a failed request into a sentence.
 *
 * The two statuses worth distinguishing are the two a caller can act on: 401
 * means sign in again, 409 means the server refused a destructive change and
 * `--yes` is the answer.
 */
function reportApiError(error: unknown): number {
  // A server that is not running was the most common failure at a terminal and
  // the one with no handling: it escaped as a Node stack trace ending in
  // `ECONNREFUSED`, which says everything except which server, and reads as a
  // crash in the tool rather than an answer about the site.
  if (error instanceof UnreachableError) {
    console.error(`${red("cannot reach")} ${bold(error.url)}`);
    console.error(dim("  is it running? `fcms link <url>` points this directory somewhere else."));
    return 1;
  }

  if (!(error instanceof ApiError)) throw error;

  if (error.unauthorized) {
    console.error(`${yellow("session expired")} run ${bold("fcms login")} again.`);
    return 1;
  }

  console.error(`${red("error")} ${error.message}`);
  for (const issue of error.issues) console.error(`  ${dim(issue.path)} ${issue.message}`);
  return error.needsConfirmation ? 2 : 1;
}

/** A prompt, with echo off for anything secret. */
async function ask(prompt: string, secret = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    if (!secret) return (await rl.question(prompt)).trim();

    // `readline` has no password mode: mute the output stream while the answer
    // is typed, so a shoulder and a scrollback both see nothing.
    const output = rl as unknown as { output: { write(chunk: string): void } };
    const write = output.output.write.bind(output.output);
    output.output.write = (chunk: string) => {
      if (!chunk.includes("\n")) return;
      write(chunk);
    };
    const answer = await rl.question(prompt);
    output.output.write = write;
    process.stdout.write("\n");
    return answer.trim();
  } finally {
    rl.close();
  }
}
