/**
 * Diagnostics.
 *
 * ADR 0006 accepted YAML knowing its parse errors are famously poor, and made
 * one thing non-negotiable in exchange: *"report failures at the node level with
 * path, line and column, against the schema — never a raw parser exception.
 * Budget for this; it is most of what 'good errors' means here."*
 *
 * This file and `locate()` in `parse.ts` are that budget being spent.
 */

export interface Diagnostic {
  /** Where in the spec, as a slash path: `/pages/1/blocks/0/data/limit`. */
  readonly path: string;
  readonly message: string;
  /** 1-based, so it matches what an editor shows. Absent if it could not be located. */
  readonly line?: number;
  readonly col?: number;
  /** Which file, once a multi-file layout is in play. */
  readonly file?: string;
  /** A concrete next action, when there is an obvious one. */
  readonly hint?: string;
}

export function formatDiagnostic(d: Diagnostic): string {
  const where = [d.file, d.line, d.col].filter((x) => x !== undefined).join(":");
  const head = where ? `${where}` : d.path;
  const lines = [`${head}  ${d.message}`];
  if (where && d.path !== "/") lines.push(`  at ${d.path}`);
  if (d.hint) lines.push(`  hint: ${d.hint}`);
  return lines.join("\n");
}

export function formatDiagnostics(ds: readonly Diagnostic[]): string {
  return ds.map(formatDiagnostic).join("\n\n");
}
