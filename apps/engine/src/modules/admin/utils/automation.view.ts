/**
 * The automation canvas (ADR 0030).
 *
 * The page canvas's shape, over steps: the pipeline on the left, an inspector
 * generated from what the action declares in the middle, and the last run on
 * the right — because an automation has no page to preview, only what it would
 * do (ADR 0030 §3).
 *
 * There is no per-action form anywhere in this file. The panel is built from
 * `Action.params`, which is the same list the runner reads.
 */
import type { SiteSpec, Workflow } from "@forinda-cms/spec";
import type { WorkflowRunRow } from "@forinda-cms/db";

import type { ActionParam } from "@/shared/workflows/actions";
import { esc } from "./view";

export interface AutomationOptions {
  readonly spec: SiteSpec;
  readonly workflow: Workflow;
  readonly actions: Record<string, { summary: string; params: readonly ActionParam[] }>;
  readonly selected: number | null;
  readonly runs: readonly WorkflowRunRow[];
  readonly error?: string | undefined;
}

/** What a step is, in one line: its key if it has one, its action otherwise. */
function summarise(step: Workflow["steps"][number]): string {
  const to = step.params?.["to"];
  return `${step.action}${typeof to === "string" && to ? ` → ${to}` : ""}`;
}

/**
 * One control, from one declared parameter.
 *
 * A closed `kind` is what lets this offer the right choices instead of a text
 * box: the integrations this site declares, the states the watched type
 * declares, or a template with a hint about what is in scope.
 */
function control(param: ActionParam, value: unknown, spec: SiteSpec, workflow: Workflow): string {
  const current = value === undefined || value === null ? "" : String(value);
  const id = `p-${param.name}`;
  const label = `<label for="${id}">${esc(param.label)}${
    param.required ? ' <span class="req">required</span>' : ""
  }</label>`;

  const options = (values: readonly { value: string; label: string }[]) =>
    `<select id="${id}" name="param__${esc(param.name)}">
      <option value="">—</option>
      ${values
        .map(
          (o) =>
            `<option value="${esc(o.value)}"${o.value === current ? " selected" : ""}>${esc(o.label)}</option>`,
        )
        .join("")}
    </select>`;

  let field: string;
  if (param.kind === "integration") {
    // Only the integrations that can do this job, so a panel cannot offer a
    // webhook that does not exist.
    field = options(
      spec.wiring
        .filter((i) => !param.of || i.kind === param.of)
        .map((i) => ({ value: i.key, label: `${i.label ?? i.key} (${i.kind})` })),
    );
  } else if (param.kind === "state") {
    const typeKey = "type" in workflow.trigger ? workflow.trigger.type : undefined;
    const state = spec.content
      .find((t) => t.key === typeKey)
      ?.fields.find((f) => f.type === "state");
    const values = state && "values" in state ? state.values : [];
    field = options(values.map((v) => ({ value: v, label: v })));
  } else {
    field = `<input id="${id}" name="param__${esc(param.name)}" value="${esc(current)}">`;
  }

  const help = param.help ? `<p class="help">${esc(param.help)}</p>` : "";
  return `<div class="field">${label}${field}${help}</div>`;
}

export function automation(options: AutomationOptions): string {
  const { spec, workflow, actions, selected, runs, error } = options;
  const step = selected === null ? undefined : workflow.steps[selected];
  const declared = step ? actions[step.action] : undefined;

  const list = workflow.steps
    .map(
      (s, i) => `<li>
  <div class="node${i === selected ? " selected" : ""}">
    <a href="?step=${i}">${esc(s.key ? `${s.key}: ${summarise(s)}` : summarise(s))}</a>
    <span class="node-actions">
      <button form="act" name="op" value="up:${i}" title="Move up">↑</button>
      <button form="act" name="op" value="down:${i}" title="Move down">↓</button>
      <button form="act" name="op" value="del:${i}" title="Remove" class="destructive">✕</button>
    </span>
  </div>
</li>`,
    )
    .join("");

  const palette = Object.entries(actions)
    .map(([name, a]) => `<option value="${esc(name)}">${esc(name)} — ${esc(a.summary)}</option>`)
    .join("");

  const panel =
    step && declared
      ? `<form method="post" action="./${esc(workflow.key)}/step" class="inspector">
  <input type="hidden" name="step" value="${selected}">
  <h3>${esc(step.action)}</h3>
  <p class="help">${esc(declared.summary)}</p>
  <div class="field">
    <label for="p-key">Name this step</label>
    <input id="p-key" name="stepKey" value="${esc(step.key ?? "")}">
    <p class="help">Optional. A later step reads it as <code>{{ steps.${esc(step.key || "name")}.… }}</code>.</p>
  </div>
  ${declared.params.map((p) => control(p, step.params?.[p.name], spec, workflow)).join("")}
  <button type="submit">Save this step</button>
</form>`
      : '<p class="help">Choose a step to edit it.</p>';

  const history =
    runs.length === 0
      ? '<p class="help">It has not run yet. Try it and see what it would do.</p>'
      : runs
          .map(
            (run) => `<div class="run${run.status === "failed" ? " destructive" : ""}">
  <p><strong>${esc(run.status)}</strong>${
    (run.detail as { test?: boolean } | null)?.test ? ' <span class="pill">test</span>' : ""
  } <span class="muted">${esc(run.createdAt.toISOString().replace("T", " ").slice(0, 16))}</span></p>
  <ol>${((run.detail as { steps?: string[] } | null)?.steps ?? [])
    .map((line) => `<li>${esc(line)}</li>`)
    .join("")}</ol>
  ${run.lastError ? `<p class="error">${esc(run.lastError)}</p>` : ""}
</div>`,
          )
          .join("");

  return `${error ? `<p class="error">${esc(error)}</p>` : ""}
<div class="canvas">
  <aside class="tree">
    <h2>${esc(workflow.label ?? workflow.key)}</h2>
    <p class="help">Runs ${esc(triggerWords(workflow))}</p>
    <ul class="blocks">${list}</ul>

    <form method="post" action="./${esc(workflow.key)}/steps" id="act" class="add">
      <label for="add-action">Add a step</label>
      <div class="row">
        <select id="add-action" name="action">${palette}</select>
        <button name="op" value="add" type="submit">Add</button>
      </div>
    </form>

    <form method="post" action="./${esc(workflow.key)}/enabled" class="add">
      <input type="hidden" name="enabled" value="${workflow.enabled === false ? "true" : "false"}">
      <button type="submit">${workflow.enabled === false ? "Turn on" : "Turn off"}</button>
    </form>
  </aside>

  <div class="stage">
    <div class="viewport-bar">
      <span class="muted">What it would do</span>
      <span class="stage-actions">
        <form method="post" action="/admin/automations/${esc(workflow.key)}/test" class="inline">
          <button type="submit" class="publish">Try it</button>
        </form>
      </span>
    </div>
    ${history}
  </div>

  <aside class="panel">${panel}</aside>
</div>`;
}

/** The trigger, as an owner would say it. */
function triggerWords(workflow: Workflow): string {
  const t = workflow.trigger;
  switch (t.on) {
    case "entry.created":
      return `when a ${t.type} is created`;
    case "entry.updated":
      return `when a ${t.type} changes`;
    case "entry.transitioned":
      return t.to ? `when a ${t.type} becomes ${t.to}` : `when a ${t.type} changes status`;
    case "payment.succeeded":
      return t.type ? `when a ${t.type} is paid for` : "when a payment succeeds";
    case "form.submitted":
      return `when the ${t.form} form is submitted`;
    case "flow.completed":
      return `when someone finishes the ${t.flow} journey`;
    case "schedule":
      return `on a schedule (${t.cron})`;
  }
}
