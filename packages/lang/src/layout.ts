/**
 * The derived multi-file layout (ADR 0006).
 *
 * A real site in one file is unreviewable and a merge-conflict generator, so
 * `pull` emits a directory:
 *
 *     site.yaml            theme tokens, wiring, access
 *     content/<key>.yaml   one file per content type
 *     pages/<key>.yaml     one file per page
 *     logic/<key>.yaml     one file per workflow
 *
 * **The layout is derived deterministically from the AST**, not authored. That
 * is what makes `pull` a pure function and means no file provenance has to be
 * stored anywhere. The cost is the gofmt bargain: `fcms fmt` may move a node
 * into its canonical file. That trade is what keeps round-tripping honest
 * rather than approximate.
 */
import { LineCounter, isNode, parseAllDocuments } from "yaml";
import { siteFileOf, type SiteSpec } from "@forinda-cms/spec";

import type { Diagnostic } from "./errors.js";
import { parseSpec } from "./parse.js";
import { printSpec } from "./print.js";
import { STRICT_PARSE_OPTIONS, checkProfile, checkUnquotedTemplates } from "./profile.js";

export const SITE_FILE = "site.yaml";

export interface SpecFiles {
  readonly [path: string]: string;
}

/** Split a spec into its canonical files. The inverse of `joinFiles`. */
export function splitFiles(spec: SiteSpec): SpecFiles {
  // Parsed through `SiteFile` rather than assembled by hand. Hand-picking is
  // what dropped `layout` and `note` when ADR 0014 added them — `fmt` deleted a
  // site's header and footer and nothing complained. Omission cannot forget.
  const files: Record<string, string> = { [SITE_FILE]: printSpec(siteFileOf(spec)) };
  for (const type of spec.content) files[`content/${type.key}.yaml`] = printSpec(type);
  for (const page of spec.pages) files[`pages/${page.key}.yaml`] = printSpec(page);
  for (const flow of spec.logic) files[`logic/${flow.key}.yaml`] = printSpec(flow);
  return files;
}

/**
 * Reassemble a directory into one document, then validate it as a whole.
 *
 * Validation deliberately happens **after** the join, never per file: a page
 * querying a content type is only checkable once both are present, and those
 * cross-file references are exactly the errors that would otherwise reach a
 * customer as a blank section (`checkReferences` in @forinda-cms/spec).
 */
export function joinFiles(
  files: SpecFiles,
): { ok: true; spec: SiteSpec } | { ok: false; diagnostics: readonly Diagnostic[] } {
  const site = files[SITE_FILE];
  if (site === undefined) {
    return {
      ok: false,
      diagnostics: [
        {
          path: "/",
          message: `missing ${SITE_FILE}`,
          hint: `run \`fcms pull\` to generate the canonical layout.`,
        },
      ],
    };
  }

  const collect = (prefix: string) =>
    Object.keys(files)
      .filter((p) => p.startsWith(`${prefix}/`) && p.endsWith(".yaml"))
      .sort()
      .map((p) => ({ path: p, text: files[p]! }));

  // Parsed as YAML only — a fragment is a piece of a spec, so it cannot be
  // validated against the whole-document schema until it is assembled.
  const fragments: Record<string, unknown[]> = { content: [], pages: [], logic: [] };
  /** Section index → the file it came from, so a diagnostic can be sent home. */
  const origin: Record<string, { file: string; text: string }[]> = {
    content: [],
    pages: [],
    logic: [],
  };
  const diagnostics: Diagnostic[] = [];

  for (const section of ["content", "pages", "logic"] as const) {
    for (const { path, text } of collect(section)) {
      const parsed = parseFragment(text, path);
      if (parsed.ok) {
        fragments[section]!.push(parsed.value);
        origin[section]!.push({ file: path, text });
      } else {
        diagnostics.push(...parsed.diagnostics);
      }
    }
  }

  const root = parseFragment(site, SITE_FILE);
  if (!root.ok) diagnostics.push(...root.diagnostics);
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const merged = {
    ...(root.ok ? (root.value as Record<string, unknown>) : {}),
    content: fragments["content"],
    pages: fragments["pages"],
    logic: fragments["logic"],
  };

  const whole = parseSpec(printSpec(merged));
  if (whole.ok) return { ok: true, spec: whole.spec };

  // Send each diagnostic back to the file the author actually edits.
  //
  // Without this the position is measured against the *re-printed merged
  // document* — a line number that points at nothing on disk, which is worse
  // than no line number at all because it looks authoritative.
  return { ok: false, diagnostics: whole.diagnostics.map((d) => relocate(d, origin, site)) };
}

/**
 * Rewrite `/content/0/fields/3/name` as `content/service.yaml` at the position
 * of `/fields/3/name` inside that file.
 */
function relocate(
  d: Diagnostic,
  origin: Record<string, { file: string; text: string }[]>,
  siteText: string,
): Diagnostic {
  const segments = d.path.split("/").filter(Boolean);
  const section = segments[0];
  const index = Number(segments[1]);

  const source =
    section && section in origin && Number.isInteger(index)
      ? origin[section]![index]
      : { file: SITE_FILE, text: siteText };

  if (!source) return d;

  const inner =
    section && section in origin && Number.isInteger(index) ? segments.slice(2) : segments;
  const lineCounter = new LineCounter();
  const doc = parseAllDocuments(source.text, { ...STRICT_PARSE_OPTIONS, lineCounter })[0];
  if (!doc) return { ...d, file: source.file };

  // Walk up until a node exists, exactly as `parse.ts` does for a missing key.
  for (let end = inner.length; end >= 0; end--) {
    const path = inner.slice(0, end).map((sgmt) => (/^\d+$/.test(sgmt) ? Number(sgmt) : sgmt));
    const node = end === 0 ? doc.contents : doc.getIn(path, true);
    const offset = isNode(node) ? node.range?.[0] : undefined;
    if (offset !== undefined) {
      return {
        ...d,
        file: source.file,
        path: `/${inner.join("/")}`,
        ...lineCounter.linePos(offset),
      };
    }
  }
  return { ...d, file: source.file };
}

/**
 * One file's YAML, under the strict profile, with no schema validation.
 *
 * Kept separate from `parseSpec` because a fragment is not a spec — running the
 * whole-document schema against `content/service.yaml` would report every other
 * section as missing, which is noise rather than an error.
 */
function parseFragment(
  text: string,
  file: string,
): { ok: true; value: unknown } | { ok: false; diagnostics: readonly Diagnostic[] } {
  const lineCounter = new LineCounter();
  const docs = parseAllDocuments(text, { ...STRICT_PARSE_OPTIONS, lineCounter });
  const doc = docs[0];

  if (docs.length > 1)
    return {
      ok: false,
      diagnostics: [{ path: "/", message: "multiple YAML documents in one file", file }],
    };
  if (!doc || doc.contents === null)
    return { ok: false, diagnostics: [{ path: "/", message: "the file is empty", file }] };
  if (doc.errors.length > 0) {
    return {
      ok: false,
      diagnostics: doc.errors.map((e) => ({
        path: "/",
        message: e.message,
        file,
        ...lineCounter.linePos(e.pos[0]),
      })),
    };
  }
  const profile = [
    ...checkUnquotedTemplates(text),
    ...checkProfile(doc, (offset) => (offset === undefined ? {} : lineCounter.linePos(offset))),
  ];
  if (profile.length > 0) return { ok: false, diagnostics: profile.map((d) => ({ ...d, file })) };

  return { ok: true, value: doc.toJS() };
}
