/**
 * The scorecard.
 *
 * Written to be read against ADR 0006's trigger, which is what the numbers are
 * for: *"if two of those four go bad, spike the bespoke grammar."*
 */
import type { Scorecard, TaskResult } from "./run.js";

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
const bar = (n: number) => "█".repeat(Math.round(n * 20)).padEnd(20, "░");

const SYMBOL: Record<string, string> = {
  correct: "✓",
  declined: "✓",
  wrong: "✗",
  invalid: "✗",
  "parse-failed": "✗",
  "no-output": "✗",
  approximated: "✗",
};

export function formatReport(
  results: readonly TaskResult[],
  s: Scorecard,
  provider: string,
): string {
  const lines: string[] = ["", `ADR 0007 test 3 — model output validity  ·  ${provider}`, ""];

  for (const kind of ["change", "trap"] as const) {
    const group = results.filter((r) => r.task.kind === kind);
    if (group.length === 0) continue;
    lines.push(kind === "change" ? "Changes" : "Traps — the ceiling, tested");
    for (const r of group) {
      const detail = r.detail ? `  ${r.detail}` : "";
      lines.push(
        `  ${SYMBOL[r.outcome] ?? "?"} ${r.task.id.padEnd(24)} ${r.outcome.padEnd(14)}${detail}`,
      );
    }
    lines.push("");
  }

  lines.push(
    "Rates",
    `  parses          ${bar(s.parseRate)}  ${pct(s.parseRate)}   of what it emitted`,
    `  validates       ${bar(s.validRate)}  ${pct(s.validRate)}   of what parsed`,
    `  correct         ${bar(s.correctRate)}  ${pct(s.correctRate)}   of what validated`,
    `  respects ceiling${bar(s.ceilingRate)}  ${pct(s.ceilingRate)}   of the traps`,
    "",
    `  ${s.changes.correct}/${s.changes.total} changes correct · ${s.traps.declined}/${s.traps.total} traps declined`,
    "",
  );

  // ADR 0006 said to instrument this and gave the trigger; saying so here means
  // whoever runs it does not have to go and look the criteria up.
  const concerns: string[] = [];
  if (s.parseRate < 0.9)
    concerns.push(
      "parse rate below 90% — the argument YAML was chosen on is in question (ADR 0006)",
    );
  if (s.validRate < 0.8)
    concerns.push("validation rate below 80% — the schema may be hard to learn from");
  if (s.correctRate < 0.8)
    concerns.push("correctness below 80% — the language may be expressible but not obvious");
  if (s.ceilingRate < 1)
    concerns.push(
      "a trap was approximated — the ceiling is not being respected, which is the failure that reaches customers",
    );

  if (concerns.length === 0) {
    lines.push("No ADR 0006 trigger conditions met.", "");
  } else {
    lines.push("Concerns:");
    for (const c of concerns) lines.push(`  · ${c}`);
    if (concerns.length >= 2)
      lines.push("", "  Two or more: ADR 0006 says spike the bespoke grammar.");
    lines.push("");
  }

  return lines.join("\n");
}
