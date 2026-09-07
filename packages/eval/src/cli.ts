#!/usr/bin/env node
/**
 * `pnpm eval` — replay recorded responses (no key, no cost).
 * `pnpm eval:record` — call the model for real and save the responses.
 *
 * The default is replay so the suite runs in CI. Recording is a deliberate act,
 * because it spends money and changes what the numbers mean.
 */
import { printSpec } from "@forinda-cms/lang";

import { chooseProvider } from "./providers.js";
import { formatReport } from "./report.js";
import { runSuite, score } from "./run.js";
import { TASKS } from "./tasks.js";
import { loadSalonSpec } from "./fixture.js";

const argv = process.argv.slice(2);
const only = argv.indexOf("--only");
const filter = only === -1 ? undefined : argv[only + 1];

const tasks = filter ? TASKS.filter((t) => t.id.includes(filter)) : TASKS;
if (tasks.length === 0) {
  console.error(`no task matches "${filter}"`);
  process.exit(1);
}

const provider = chooseProvider(argv);
const baseSpecYaml = printSpec(loadSalonSpec());

console.log(`running ${tasks.length} task(s) against ${provider.name}…`);

const results = await runSuite({
  provider,
  baseSpecYaml,
  tasks,
  onResult: (r) =>
    console.log(
      `  ${r.outcome === "correct" || r.outcome === "declined" ? "✓" : "✗"} ${r.task.id}`,
    ),
});

console.log(formatReport(results, score(results), provider.name));

// Non-zero when the ceiling was breached, since that is the failure that would
// reach a customer. A wrong-but-valid edit is visible in a diff; an approximated
// one looks correct.
const breached = results.some((r) => r.outcome === "approximated");
process.exit(breached ? 1 : 0);
