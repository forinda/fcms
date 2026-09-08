/**
 * The dashboard.
 *
 * It used to be a directory: the types, their counts, the pages. Everything on
 * it was true and none of it was a reason to open it — you already know what
 * types your site has.
 *
 * So it answers a different question: what wants me. Anything that needs a
 * person is at the top with the number on it, everything that has happened is
 * under it, and the directory is where it always was, further down. When
 * nothing needs anyone, the top of the screen says so and takes one line.
 */
import type { ContentType, SiteSpec } from "@forinda-cms/spec";
import type { PaymentRow, WorkflowRunRow } from "@forinda-cms/db";

import type { HistoryEntry } from "../use-cases/site-history.usecase";
import { esc } from "./view";

export interface DashboardOptions {
  readonly spec: SiteSpec;
  readonly counts: Record<string, number>;
  readonly drafts: Record<string, number>;
  readonly runs: readonly WorkflowRunRow[];
  readonly payments: readonly PaymentRow[];
  readonly history: readonly HistoryEntry[];
}

/** One thing that wants a person, and where they go to deal with it. */
interface Attention {
  readonly count: number;
  readonly text: string;
  readonly href: string;
  readonly bad?: boolean;
}

export function dashboard(options: DashboardOptions): string {
  const { spec, counts, drafts, runs, payments, history } = options;
  const stored = spec.content.filter((t) => !t.derived);
  const derived = spec.content.filter((t) => t.derived);

  const failed = runs.filter((r) => r.status === "failed");
  const unfinished = payments.filter((p) => p.status === "pending");
  const off = spec.logic.filter((w) => w.enabled === false);

  const attention: Attention[] = [
    ...(failed.length > 0
      ? [
          {
            count: failed.length,
            text: `${failed.length === 1 ? "automation run" : "automation runs"} failed`,
            href: "/admin/automations",
            bad: true,
          },
        ]
      : []),
    ...stored
      .filter((t) => (drafts[t.key] ?? 0) > 0)
      .map((t) => ({
        count: drafts[t.key]!,
        text: `${plural(t, drafts[t.key]!)} not published`,
        // Straight to the drafts, not to the list they are buried in.
        href: `/admin/content/${t.key}?status=draft`,
      })),
    ...(unfinished.length > 0
      ? [
          {
            count: unfinished.length,
            // "Started and never finished" rather than "pending": the row is a
            // customer who opened a payment and walked away, and that is what
            // an owner needs to hear to know whether to chase it.
            text: `${unfinished.length === 1 ? "payment was" : "payments were"} started and never finished`,
            href: `/admin/content/${esc(unfinished[0]!.typeKey)}`,
          },
        ]
      : []),
    ...(off.length > 0
      ? [
          {
            count: off.length,
            text: `${off.length === 1 ? "automation is" : "automations are"} turned off`,
            href: "/admin/automations",
          },
        ]
      : []),
  ];

  const card = (t: ContentType) => {
    const total = counts[t.key] ?? 0;
    const waiting = drafts[t.key] ?? 0;
    return `<div class="card">
  <h3><a href="/admin/content/${esc(t.key)}">${esc(t.labelPlural ?? t.label)}</a></h3>
  <p class="muted">${total} ${total === 1 ? "entry" : "entries"}${
    waiting > 0 ? ` · <strong>${waiting}</strong> not published` : ""
  }</p>
  <p class="card-actions"><a href="/admin/content/${esc(t.key)}/new">Add one</a>
    <span class="sep">·</span> <a href="/admin/types/${esc(t.key)}">Change what it holds</a></p>
</div>`;
  };

  return `<h1>${esc(spec.name)}</h1>
<p class="muted"><a href="/">View the site</a> <span class="sep">·</span>
  ${spec.pages.length} ${spec.pages.length === 1 ? "page" : "pages"} <span class="sep">·</span>
  <a href="/admin/types">content types</a> <span class="sep">·</span>
  <a href="/admin/history">history</a></p>

<section aria-labelledby="attention-heading" class="attention">
  <h2 id="attention-heading">Needs you</h2>
  ${
    attention.length === 0
      ? `<p class="muted">Nothing is waiting. Every entry is published, every automation ran.</p>`
      : `<ul class="waiting">${attention
          .map(
            (a) => `<li${a.bad ? ' class="destructive-change"' : ""}>
    <a href="${esc(a.href)}"><strong>${a.count}</strong> ${esc(a.text)}</a>
  </li>`,
          )
          .join("")}</ul>`
  }
</section>

<h2>Content</h2>
<div class="cards">${stored.map(card).join("")}</div>
${
  derived.length > 0
    ? `<h3 class="quiet">Worked out, not stored</h3>
<p class="muted">${derived
        .map((t) => esc(t.labelPlural ?? t.label))
        .join(", ")} — computed from other content, so there is nothing to edit.</p>`
    : ""
}

<div class="two-up">
  <section aria-labelledby="runs-heading">
    <h2 id="runs-heading">Latest runs</h2>
    ${
      runs.length === 0
        ? `<p class="muted">No automation has run yet.
           <a href="/admin/automations">Try one</a> to see what it would do.</p>`
        : `<table>
      <caption class="sr-only">The five most recent automation runs</caption>
      <tbody>${runs
        .slice(0, 5)
        .map(
          (run) => `<tr${run.status === "failed" ? ' class="destructive"' : ""}>
        <td><a href="/admin/automations/${esc(run.workflowKey)}">${esc(run.workflowKey)}</a></td>
        <td class="muted">${esc(run.status)}</td>
        <td class="muted">${when(run.createdAt)}</td>
      </tr>`,
        )
        .join("")}</tbody></table>`
    }
  </section>

  <section aria-labelledby="changes-heading">
    <h2 id="changes-heading">Latest changes</h2>
    ${
      history.length === 0
        ? `<p class="muted">Nothing has changed since this site was created.</p>`
        : `<table>
      <caption class="sr-only">The five most recent changes to the site</caption>
      <tbody>${history
        .slice(0, 5)
        .map(
          (entry) => `<tr>
        <td>${esc(entry.summary)}${entry.revertedAt ? ' <span class="pill">undone</span>' : ""}</td>
        <td class="muted">${esc(entry.source)}</td>
        <td class="muted">${when(entry.appliedAt)}</td>
      </tr>`,
        )
        .join("")}</tbody></table>`
    }
  </section>
</div>

<h2>Pages</h2>
<p class="muted">A page is a tree of blocks, edited on the canvas — where the page you
are changing is the page you are looking at.</p>
<table>
  <caption class="sr-only">Pages on this site</caption>
  <thead><tr><th scope="col">Page</th><th scope="col">Address</th><th scope="col">
    <span class="sr-only">Actions</span></th></tr></thead>
  <tbody>${spec.pages
    .map(
      (p) => `<tr>
    <td>${esc(p.title)}</td>
    <td class="muted"><code>${esc(p.path)}</code></td>
    <td><a href="/admin/pages/${esc(p.key)}">Edit</a> <span class="sep">·</span>
        <a href="${esc(p.path)}">View</a></td>
  </tr>`,
    )
    .join("")}</tbody>
</table>`;
}

const plural = (type: ContentType, n: number): string =>
  n === 1 ? type.label.toLowerCase() : (type.labelPlural ?? `${type.label}s`).toLowerCase();

/**
 * A timestamp somebody can read at a glance.
 *
 * Relative up to a week, because "2 hours ago" is the question being asked —
 * and an absolute date after that, because "23 days ago" is not.
 */
function when(at: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - at.getTime()) / 1000));
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return at.toISOString().slice(0, 10);
}
