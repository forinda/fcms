/**
 * The change tasks.
 *
 * ADR 0007 test 3: *"Give a model the schema and the spec, ask for twenty
 * changes of varying size. Measure parse-failure rate, schema-validation-failure
 * rate, and semantic correctness."*
 *
 * Two kinds. **Change** tasks are ordinary edits and are scored on whether the
 * result parses, validates, and actually did the thing. **Trap** tasks ask for
 * something A2 cannot express; the correct answer is to say so rather than
 * approximate — doc 04 makes that a hard product requirement, because *"the AI
 * builders that fail, fail by confidently producing something adjacent."*
 *
 * The traps matter more than the changes. A model that scores well on edits and
 * invents an expression when cornered is worse than one that scores slightly
 * lower and declines, because the first kind of failure reaches a customer.
 */
import type { SiteSpec } from "@forinda-cms/spec";

export interface CheckResult {
  readonly pass: boolean;
  readonly why?: string;
}

export interface Task {
  readonly id: string;
  readonly size: "small" | "medium" | "large";
  readonly kind: "change" | "trap";
  readonly instruction: string;
  /** Change tasks only: did the edit actually do what was asked? */
  readonly check?: (spec: SiteSpec) => CheckResult;
  /** Trap tasks only: why this cannot be expressed, for the report. */
  readonly why?: string;
}

const ok: CheckResult = { pass: true };
const no = (why: string): CheckResult => ({ pass: false, why });

const type = (spec: SiteSpec, key: string) => spec.content.find((t) => t.key === key);
const page = (spec: SiteSpec, key: string) => spec.pages.find((p) => p.key === key);
const field = (spec: SiteSpec, typeKey: string, name: string) =>
  type(spec, typeKey)?.fields.find((f) => f.name === name);

/** Walk every block on every page, including inside `item`, `children` and flows. */
function allBlocks(spec: SiteSpec): { type: string; attrs?: Record<string, unknown> }[] {
  const out: { type: string; attrs?: Record<string, unknown> }[] = [];
  const walk = (
    blocks: readonly {
      type: string;
      attrs?: Record<string, unknown>;
      item?: unknown[];
      children?: unknown[];
    }[],
  ) => {
    for (const b of blocks) {
      out.push(b);
      if (Array.isArray(b.item)) walk(b.item as never);
      if (Array.isArray(b.children)) walk(b.children as never);
    }
  };
  for (const p of spec.pages) {
    walk(p.blocks as never);
    for (const f of p.flows ?? []) for (const s of f.steps) walk(s.blocks as never);
  }
  walk((spec.layout?.header ?? []) as never);
  walk((spec.layout?.footer ?? []) as never);
  return out;
}

export const TASKS: readonly Task[] = [
  // ── small: targeted edits, the most common kind ──────────────────────────
  {
    id: "add-field",
    size: "small",
    kind: "change",
    instruction:
      'Add an optional "Notes" text field to the Booking type, for anything the customer wants us to know.',
    check: (s) => (field(s, "booking", "notes") ? ok : no("booking has no `notes` field")),
  },
  {
    id: "rename-label",
    size: "small",
    kind: "change",
    instruction:
      'The stylists want to be called "Stylist", not "Staff", everywhere a customer sees it. Update the labels.',
    check: (s) => {
      const t = type(s, "staff");
      if (!t) return no("the staff type is gone");
      return /stylist/i.test(t.label) ? ok : no(`label is still "${t.label}"`);
    },
  },
  {
    id: "mark-filterable",
    size: "small",
    kind: "change",
    instruction: "We filter services by price a lot. Make the price field filterable.",
    check: (s) => {
      const f = field(s, "service", "price");
      if (!f) return no("service has no price field");
      return "filterable" in f && f.filterable === true ? ok : no("price is not filterable");
    },
  },
  {
    id: "add-nav-link",
    size: "small",
    kind: "change",
    instruction: 'Add a "Contact" link to the site navigation, pointing at /contact.',
    check: (s) => {
      const nav = allBlocks(s).find((b) => b.type === "nav");
      if (!nav) return no("no nav block");
      const links = JSON.stringify(nav.attrs?.["links"] ?? []);
      return /contact/i.test(links) ? ok : no("no Contact link in the nav");
    },
  },
  {
    id: "change-limit",
    size: "small",
    kind: "change",
    instruction: "The homepage service list should show at most 6 services, not 12.",
    check: (s) => {
      const home = page(s, "home");
      if (!home) return no("no home page");
      const found = JSON.stringify(home.blocks).includes('"limit":6');
      return found ? ok : no("no query with limit 6 on the home page");
    },
  },
  {
    id: "set-noindex",
    size: "small",
    kind: "change",
    instruction:
      "The booking page should not appear in Google. Keep it reachable, just not indexed.",
    check: (s) =>
      page(s, "book")?.seo?.noindex === true ? ok : no("the book page is still indexable"),
  },

  // ── medium: a new page, a workflow, a state transition ───────────────────
  {
    id: "add-page",
    size: "medium",
    kind: "change",
    instruction:
      "Add a Contact page at /contact with a heading and our address: Riverside Salon, Kilimani, Nairobi.",
    check: (s) => {
      const p = s.pages.find((x) => x.path === "/contact");
      if (!p) return no("no page answers /contact");
      return /kilimani/i.test(JSON.stringify(p.blocks)) ? ok : no("the address is not on the page");
    },
  },
  {
    id: "add-workflow",
    size: "medium",
    kind: "change",
    instruction: "When a booking is cancelled, text the customer to let them know.",
    check: (s) => {
      const w = s.logic.find(
        (x) =>
          x.trigger.on === "entry.transitioned" &&
          "to" in x.trigger &&
          x.trigger.to === "cancelled",
      );
      if (!w) return no("no workflow triggers on a cancellation");
      return w.steps.some((st) => /sms/.test(st.action))
        ? ok
        : no("the workflow does not send an SMS");
    },
  },
  {
    id: "add-state",
    size: "medium",
    kind: "change",
    instruction:
      'We need a "rescheduled" status for bookings. A confirmed booking can become rescheduled, and a rescheduled one can be completed or cancelled.',
    check: (s) => {
      const f = field(s, "booking", "status");
      if (!f || f.type !== "state" || !("values" in f)) return no("booking has no state field");
      if (!f.values.includes("rescheduled")) return no('no "rescheduled" state');
      const from = f.transitions.find((t) => t.from === "rescheduled");
      return from && from.to.includes("completed") ? ok : no("rescheduled cannot become completed");
    },
  },
  {
    id: "add-block-with-style",
    size: "medium",
    kind: "change",
    instruction:
      "Put a testimonial quote on the homepage, centred, on the surface colour, with generous padding.",
    check: (s) => {
      const home = page(s, "home");
      if (!home) return no("no home page");
      const json = JSON.stringify(home.blocks);
      // Token-valued, not a literal — the tier-1/tier-2 boundary (ADR 0004).
      if (/#[0-9a-f]{6}/i.test(json)) return no("a raw colour was used instead of a token");
      return /token:color\.surface/.test(json) ? ok : no("no block uses the surface token");
    },
  },
  {
    id: "filter-collection",
    size: "medium",
    kind: "change",
    instruction: "Services that are not bookable should not have their own page at all.",
    check: (s) => {
      const p = s.pages.find((x) => x.collection !== undefined);
      if (!p) return no("no collection page");
      if (typeof p.collection === "string") return no("the collection is unfiltered");
      return (p.collection?.where?.length ?? 0) > 0 ? ok : no("the collection has no filter");
    },
  },
  {
    id: "add-integration",
    size: "medium",
    kind: "change",
    instruction:
      "We want to send booking confirmations by email as well. Wire up an email integration; the SMTP password is in the environment as SMTP_PASSWORD.",
    check: (s) => {
      const i = s.wiring.find((x) => x.kind === "email");
      if (!i) return no("no email integration");
      const secrets = JSON.stringify(i.secrets ?? {});
      // The credential must be a reference, never a value (ADR 0001).
      return /secret:SMTP_PASSWORD/.test(secrets)
        ? ok
        : no("the password is not a secret: reference");
    },
  },
  {
    id: "add-note",
    size: "medium",
    kind: "change",
    instruction:
      "Leave a note on the Booking type explaining that bookings are never deleted, only cancelled, for the accountant.",
    check: (s) => (type(s, "booking")?.note ? ok : no("no note on the booking type")),
  },

  // ── large: a whole feature ───────────────────────────────────────────────
  {
    id: "add-content-type",
    size: "large",
    kind: "change",
    instruction:
      "We want to start a blog. Add a Post type with a title, slug, body and publish date, a page listing the most recent 10 posts at /blog, and a page for reading one post. Mark posts up as BlogPosting for search engines.",
    check: (s) => {
      const t = type(s, "post");
      if (!t) return no("no post type");
      if (t.jsonld?.type !== "BlogPosting") return no("posts are not marked up as BlogPosting");
      const list = s.pages.find((p) => p.path === "/blog");
      if (!list) return no("no /blog page");
      const detail = s.pages.find((p) => p.collection !== undefined && p.key !== "service-detail");
      return detail ? ok : no("no page for reading a single post");
    },
  },
  {
    id: "add-flow-step",
    size: "large",
    kind: "change",
    instruction:
      "Add a step to the booking flow, after the details step, where the customer pays their deposit by M-Pesa. Only show it when the chosen service actually takes a deposit.",
    check: (s) => {
      const flow = page(s, "book")?.flows?.[0];
      if (!flow) return no("no booking flow");
      const pay = flow.steps.find((st) => /pay|deposit/i.test(st.key));
      if (!pay) return no("no payment step");
      return pay.when ? ok : no("the payment step is always shown");
    },
  },
  {
    id: "restructure-home",
    size: "large",
    kind: "change",
    instruction:
      "Rework the homepage: hero first, then the team, then services, then a call to action. Two columns on phones for the team, four on desktop.",
    check: (s) => {
      const home = page(s, "home");
      if (!home) return no("no home page");
      const json = JSON.stringify(home.blocks);
      if (!/"base":2/.test(json) || !/"md":4|"lg":4/.test(json))
        return no("the team grid is not 2-up on phones and 4-up on desktop");
      const team = json.indexOf("staff");
      const services = json.indexOf("service");
      return team > -1 && services > -1 && team < services
        ? ok
        : no("the team does not come before services");
    },
  },

  // ── traps: the ceiling, tested ───────────────────────────────────────────
  {
    id: "trap-computed-field",
    size: "small",
    kind: "trap",
    instruction:
      "Add a field to Service that automatically shows the price including 16% VAT, calculated from the price.",
    why: "A computed field needs arithmetic. Templates are property access plus one formatter (ADR 0001); the answer is a plugin-registered field type.",
  },
  {
    id: "trap-expression-filter",
    size: "small",
    kind: "trap",
    instruction:
      "On the homepage, only show services where the price is over 2000 AND the duration is under 90 minutes.",
    why: "Two conditions on one block. `when` takes exactly one triple and `where` is a top-level AND list, so a service list can do this but a `when` cannot — a model that writes an expression string has broken the ceiling.",
  },
  {
    id: "trap-loop",
    size: "medium",
    kind: "trap",
    instruction:
      "For each stylist on the homepage, loop over their services and print a row per service.",
    why: "Nested iteration. `data` + `item` is the only loop and nesting is capped at one level (ADR 0009), because a query inside a row template is an N+1 the author cannot see.",
  },
  {
    id: "trap-custom-code",
    size: "medium",
    kind: "trap",
    instruction:
      "Add a bit of JavaScript to the booking page that validates the phone number is a Kenyan mobile before submitting.",
    why: "Arbitrary code. ADR 0001 puts the escape hatch on rung 4 — a sandboxed, capability-manifested plugin — never inline in the owner spec.",
  },
];

export const CHANGE_TASKS = TASKS.filter((t) => t.kind === "change");
export const TRAP_TASKS = TASKS.filter((t) => t.kind === "trap");
