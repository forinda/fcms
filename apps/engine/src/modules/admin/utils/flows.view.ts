/**
 * A customer's journey, as a list of steps (ADR 0040).
 *
 * The same shape the automation builder has, over steps a *customer* takes
 * rather than steps the platform takes: the steps on the left, the selected
 * one's settings on the right, and the page it lives on one click away.
 *
 * What this screen deliberately does not edit is the blocks inside a step —
 * those are the canvas's job, and a second block editor here would be the drift
 * ADR 0004 exists to prevent. It shows what each step offers and what the
 * choice fills, which is what makes a journey a journey.
 */
import type { ContentType, Page, SiteSpec } from "@forinda-cms/spec";

import { esc } from "./view";

type Flow = NonNullable<Page["flows"]>[number];

export interface FlowListOptions {
  readonly spec: SiteSpec;
  readonly page: Page;
  readonly error?: string | undefined;
}

export function flowList({ spec, page, error }: FlowListOptions): string {
  const flows = page.flows ?? [];
  // Only types the public may write to: a journey ends in a form, and a form
  // over a type that accepts nothing is a journey that cannot finish.
  const writable = spec.content.filter((t) => !t.derived && t.submissions);
  const choosable = spec.content.filter((t) => !t.derived);

  return `${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
<h1>Journeys on ${esc(page.title)}</h1>
<p class="muted">A journey is what somebody goes through on this page — choose a service,
pick a time, confirm. Each step's answer is kept until they finish, so the last step writes
one entry with all of it.</p>

${
  flows.length === 0
    ? `<p class="muted">This page has none.</p>`
    : `<table>
  <caption class="sr-only">Journeys on this page</caption>
  <thead><tr><th scope="col">Journey</th><th scope="col">Steps</th><th scope="col">Creates</th></tr></thead>
  <tbody>${flows
    .map(
      (flow) => `<tr>
    <td><a href="/admin/pages/${esc(page.key)}/flows/${esc(flow.key)}">${esc(flow.key)}</a></td>
    <td class="muted">${flow.steps.length}</td>
    <td class="muted">${esc(creates(flow, spec)?.label ?? "—")}</td>
  </tr>`,
    )
    .join("")}</tbody>
</table>`
}

${
  writable.length === 0
    ? `<p class="warn">No content type accepts entries from the public yet, so a journey
       would have nothing to finish into. Open one for submissions under
       <a href="/admin/types">Types</a> first.</p>`
    : `<form method="post" action="/admin/pages/${esc(page.key)}/flows" class="new-type">
  <h2>Add a journey</h2>
  <div class="field">
    <label for="f-key">Key</label>
    <input id="f-key" name="key" required pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*"
      aria-describedby="f-key-help" value="booking">
    <p class="help" id="f-key-help">Lowercase words joined by hyphens. It appears in the
      address while somebody is part-way through.</p>
  </div>
  <div class="field">
    <label for="f-creates">It ends by creating</label>
    <select id="f-creates" name="creates">
      ${writable.map((t) => `<option value="${esc(t.key)}">${esc(t.label)}</option>`).join("")}
    </select>
  </div>
  <div class="field">
    <label for="f-choose">The first thing they choose</label>
    <select id="f-choose" name="choose">
      ${choosable.map((t) => `<option value="${esc(t.key)}">${esc(t.labelPlural ?? t.label)}</option>`).join("")}
    </select>
  </div>
  <div class="actions"><button type="submit">Add it</button></div>
</form>`
}`;
}

export interface FlowBuilderOptions {
  readonly spec: SiteSpec;
  readonly page: Page;
  readonly flow: Flow;
  readonly selected: string | null;
  readonly error?: string | undefined;
}

export function flowBuilder(options: FlowBuilderOptions): string {
  const { spec, page, flow, selected, error } = options;
  const step = flow.steps.find((s) => s.key === selected);
  const target = creates(flow, spec);
  const choosable = spec.content.filter((t) => !t.derived);

  const list = flow.steps
    .map(
      (s, i) => `<li>
  <div class="node${s.key === selected ? " selected" : ""}">
    <a href="?step=${encodeURIComponent(s.key)}"${s.key === selected ? ' aria-current="true"' : ""}>
      ${esc(s.label ?? s.key)}
      <span class="pill">${esc(s.selects ? `picks a ${s.selects.from}` : "confirms")}</span>
    </a>
    <span class="node-actions">
      <button form="step-ops" name="op" value="up:${i}" aria-label="Move ${esc(s.label ?? s.key)} up">
        <span aria-hidden="true">↑</span></button>
      <button form="step-ops" name="op" value="down:${i}" aria-label="Move ${esc(s.label ?? s.key)} down">
        <span aria-hidden="true">↓</span></button>
      <button form="step-ops" name="op" value="del:${esc(s.key)}" class="destructive"
        aria-label="Remove ${esc(s.label ?? s.key)}"><span aria-hidden="true">✕</span></button>
    </span>
  </div>
</li>`,
    )
    .join("");

  return `${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
<h1>${esc(flow.key)}</h1>
<p class="muted">On <a href="/admin/pages/${esc(page.key)}">${esc(page.title)}</a>
  <span class="sep">·</span> creates ${esc(target?.label ?? "nothing yet")}
  <span class="sep">·</span> <a href="${esc(page.path)}">try it on the site</a></p>

<div class="builder">
  <section class="tree" aria-labelledby="steps-heading">
    <h2 id="steps-heading">Steps</h2>
    <ol class="blocks">${list}</ol>

    <form method="post" action="/admin/pages/${esc(page.key)}/flows/${esc(flow.key)}/steps"
      id="step-ops" class="add">
      <h3>Add a step</h3>
      <div class="field">
        <label for="add-from">They choose from</label>
        <select id="add-from" name="from">
          ${choosable
            .map((t) => `<option value="${esc(t.key)}">${esc(t.labelPlural ?? t.label)}</option>`)
            .join("")}
        </select>
      </div>
      <button name="op" value="add" type="submit">Add this step</button>
      <p class="help">It goes before the last step, which is the one that confirms.</p>
    </form>
  </section>

  <section class="panel" aria-labelledby="step-heading">
    ${
      step
        ? stepForm(page, flow, step, target, choosable)
        : `<h2 id="step-heading">Edit a step</h2>
           <p class="help">Choose one on the left, and its settings appear here.</p>`
    }
  </section>
</div>

<form method="post" action="/admin/pages/${esc(page.key)}/flows/${esc(flow.key)}/delete"
  class="danger">
  <h2>Remove this journey</h2>
  <p class="help">The page keeps its own sections. Anyone part-way through loses where they
    were.</p>
  <button type="submit" class="destructive">Remove ${esc(flow.key)}</button>
</form>`;
}

function stepForm(
  page: Page,
  flow: Flow,
  step: Flow["steps"][number],
  target: ContentType | undefined,
  choosable: readonly ContentType[],
): string {
  const source = step.selects?.from ?? "";

  return `<h2 id="step-heading">${esc(step.label ?? step.key)}</h2>
<p class="help"><code>${esc(step.key)}</code>${
    step.requires?.length ? ` · after ${step.requires.map((r) => esc(r)).join(", ")}` : " · first"
  }</p>

<form method="post" action="/admin/pages/${esc(page.key)}/flows/${esc(flow.key)}/step"
  class="inspector">
  <input type="hidden" name="step" value="${esc(step.key)}">
  <div class="field">
    <label for="s-label">What this step asks</label>
    <input id="s-label" name="label" value="${esc(step.label ?? "")}" required>
  </div>

  ${
    step.selects
      ? `<div class="field">
    <label for="s-from">They choose from</label>
    <select id="s-from" name="from">
      ${choosable
        .map(
          (t) =>
            `<option value="${esc(t.key)}"${t.key === source ? " selected" : ""}>${esc(t.labelPlural ?? t.label)}</option>`,
        )
        .join("")}
    </select>
    <p class="help">Changing this replaces the list of choices shown on the step.</p>
  </div>
  <div class="field">
    <label for="s-as">Their choice fills</label>
    <select id="s-as" name="as" aria-describedby="s-as-help">
      ${(target?.fields ?? [])
        .map(
          (f) =>
            `<option value="${esc(f.name)}"${f.name === step.selects?.as ? " selected" : ""}>${esc(f.label)}</option>`,
        )
        .join("")}
    </select>
    <p class="help" id="s-as-help">The field on the ${esc(
      target?.label.toLowerCase() ?? "entry",
    )} this journey creates. A choice that fills nothing is collected and lost.</p>
  </div>`
      : `<p class="help">This is the step that confirms. It holds the form that writes the
         ${esc(target?.label.toLowerCase() ?? "entry")}, and what is on it is edited on the
         <a href="/admin/pages/${esc(page.key)}">canvas</a>.</p>`
  }

  <div class="actions"><button type="submit">Save this step</button></div>
</form>`;
}

/** What the journey creates — read from the form in its last step. */
function creates(flow: Flow, spec: SiteSpec): ContentType | undefined {
  for (const step of [...flow.steps].reverse()) {
    for (const block of step.blocks) {
      const key = target(
        block as {
          type: string;
          attrs?: Record<string, unknown>;
          children?: unknown[];
          item?: unknown[];
        },
      );
      if (key) return spec.content.find((t) => t.key === key);
    }
  }
  return undefined;
}

function target(block: {
  type: string;
  attrs?: Record<string, unknown>;
  children?: unknown[];
  item?: unknown[];
}): string | undefined {
  if (block.type === "form" && typeof block.attrs?.["for"] === "string") return block.attrs["for"];
  for (const child of [...(block.children ?? []), ...(block.item ?? [])]) {
    const found = target(child as Parameters<typeof target>[0]);
    if (found) return found;
  }
  return undefined;
}
