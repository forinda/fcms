/**
 * What a brand-new install starts from (ADR 0036).
 *
 * Before this, the first screen after `docker compose up` said "No site yet."
 * and offered nothing — every other admin screen 404s without a spec, so the
 * only way forward was the CLI or the assistant, on a site with nothing to
 * describe yet. A self-hostable product whose first screen is a dead end is not
 * self-hostable in the way that matters.
 *
 * These are **specs, not fixtures**. Each one goes through `ApplySpecUseCase`
 * like every other change, so a starter is diffed, migrated, recorded in
 * history and undoable — and a starter that would not validate fails the test
 * in this directory rather than on somebody's first afternoon.
 */
export interface Starter {
  readonly key: string;
  readonly label: string;
  /** One line, in the words of someone choosing rather than building. */
  readonly summary: string;
  /** What they get, said plainly. */
  readonly gives: readonly string[];
  build(name: string): unknown;
}

/**
 * The palette every starter shares.
 *
 * These names are not arbitrary: the renderer's own stylesheet reads
 * `--color-brand`, `--color-text`, `--color-background`, `--color-muted`,
 * `--color-border` and `--radius-md` (ADR 0035), so a starter that omitted one
 * would hand somebody a site with a hard-coded fallback blue in it.
 */
const theme = {
  colors: {
    brand: "#1a7f5a",
    text: "#1c1917",
    muted: "#78716c",
    background: "#fafaf9",
    surface: "#ffffff",
    border: "#e7e5e4",
  },
  fonts: { body: "Inter" },
  typeScale: { sm: "0.875rem", md: "1rem", lg: "1.5rem", xl: "2.5rem" },
  radius: { sm: "4px", md: "8px", lg: "16px" },
};

/**
 * A header and a footer, so a starter looks like a site rather than a document.
 *
 * Every page wears these unless it opts out, which is what makes the second
 * page somebody adds feel like part of the same thing without them doing
 * anything.
 */
const layout = (name: string, links: { label: string; to: string }[]) => ({
  header: [
    {
      type: "nav",
      style: {
        padding: { y: "md", x: "lg" },
        background: "token:color.background",
        border: "hairline",
      },
      attrs: { links },
    },
  ],
  footer: [
    {
      type: "footer",
      style: {
        padding: { y: "lg", x: "lg" },
        background: "token:color.surface",
        textAlign: "center",
      },
      attrs: { text: name },
    },
  ],
});

const base = (name: string) => ({ specVersion: 2, name, theme, logic: [] });

const heading = (text: string, level = 1) => ({ type: "heading", attrs: { text, level } });
const words = (text: string) => ({ type: "text", attrs: { text } });

const section = (children: unknown[], style: Record<string, unknown> = {}) => ({
  type: "section",
  style: { padding: { y: "xl", x: "lg" }, width: "container", gap: "md", ...style },
  children,
});

const blank: Starter = {
  key: "blank",
  label: "Nothing yet",
  summary: "One page, and everything else added as you go.",
  gives: ["A home page you can edit on the canvas"],
  build: (name) => ({
    ...base(name),
    layout: layout(name, [{ label: "Home", to: "/" }]),
    content: [],
    pages: [
      {
        key: "home",
        path: "/",
        title: name,
        blocks: [
          section([
            heading(name),
            words("This page is yours to change. Open it on the canvas and start adding sections."),
          ]),
        ],
      },
    ],
  }),
};

/**
 * The shape most small businesses actually have: things you offer, and people
 * asking about them.
 */
const enquiries: Starter = {
  key: "enquiries",
  label: "A site that takes enquiries",
  summary: "Pages about what you do, and a form people can fill in.",
  gives: [
    "An Enquiries type, with a status that moves from new to answered",
    "A home page and a contact page with a working form",
  ],
  build: (name) => ({
    ...base(name),
    layout: layout(name, [
      { label: "Home", to: "/" },
      { label: "Contact", to: "/contact" },
    ]),
    content: [
      {
        key: "enquiry",
        label: "Enquiry",
        labelPlural: "Enquiries",
        titleField: "name",
        // The public may create one. Declared here rather than implied by the
        // form, so opening a type to the world is a spec change (ADR 0020 §3).
        submissions: "anyone",
        publishable: false,
        fields: [
          { name: "name", label: "Your name", type: "text", required: true },
          { name: "email", label: "Email", type: "email", required: true },
          { name: "message", label: "What can we help with?", type: "richtext", required: true },
          {
            name: "status",
            label: "Status",
            type: "state",
            initial: "new",
            values: ["new", "answered", "closed"],
            transitions: [
              { from: "new", to: ["answered", "closed"] },
              { from: "answered", to: ["closed"] },
            ],
          },
        ],
      },
    ],
    pages: [
      {
        key: "home",
        path: "/",
        title: name,
        blocks: [
          section([
            heading(name),
            words("Say what you do here."),
            { type: "button", attrs: { label: "Get in touch", to: "/contact" } },
          ]),
        ],
      },
      {
        key: "contact",
        path: "/contact",
        title: "Contact us",
        blocks: [
          section(
            [
              heading("Contact us", 1),
              words("Send us a message and we will come back to you."),
              // No children on purpose: a form with none generates its inputs
              // from the type's own declarations, so the labels are the ones
              // set in the admin and the two cannot drift apart.
              { type: "form", attrs: { for: "enquiry", submitLabel: "Send" } },
            ],
            { width: "narrow" },
          ),
        ],
      },
    ],
  }),
};

/** Appointments: what you offer, and what people book. */
const bookings: Starter = {
  key: "bookings",
  label: "A site that takes bookings",
  summary: "What you offer, and a form that books it.",
  gives: [
    "A Services type — name, price, how long it takes",
    "A Bookings type with a status that moves from pending to confirmed",
    "A home page listing your services, and a booking page",
  ],
  build: (name) => ({
    ...base(name),
    layout: layout(name, [
      { label: "Home", to: "/" },
      { label: "Book", to: "/book" },
    ]),
    content: [
      {
        key: "service",
        label: "Service",
        labelPlural: "Services",
        titleField: "name",
        permalink: "/services/{{ entry.slug }}",
        fields: [
          { name: "slug", label: "Slug", type: "text", required: true, unique: true },
          { name: "name", label: "Name", type: "text", required: true },
          { name: "blurb", label: "Short description", type: "text" },
          { name: "price", label: "Price", type: "number", filterable: true },
          { name: "minutes", label: "How long it takes", type: "number" },
          { name: "active", label: "Bookable", type: "boolean", filterable: true },
        ],
      },
      {
        key: "booking",
        label: "Booking",
        labelPlural: "Bookings",
        titleField: "customerName",
        submissions: "anyone",
        publishable: false,
        fields: [
          { name: "customerName", label: "Your name", type: "text", required: true },
          { name: "phone", label: "Phone", type: "phone", required: true },
          { name: "service", label: "Service", type: "reference", to: "service", required: true },
          { name: "startsAt", label: "When", type: "datetime", required: true, filterable: true },
          {
            name: "status",
            label: "Status",
            type: "state",
            initial: "pending",
            values: ["pending", "confirmed", "completed", "cancelled"],
            transitions: [
              { from: "pending", to: ["confirmed", "cancelled"] },
              { from: "confirmed", to: ["completed", "cancelled"] },
            ],
          },
        ],
      },
    ],
    pages: [
      {
        key: "home",
        path: "/",
        title: name,
        blocks: [
          section([
            heading(name),
            words("What you offer, and how to book it."),
            {
              type: "list",
              style: { cols: { base: 1, md: 3 }, gap: "md" },
              data: {
                from: "service",
                where: [{ field: "active", op: "eq", value: true }],
                limit: 12,
              },
              item: [
                {
                  type: "card",
                  style: { padding: "md", border: "hairline", radius: "md" },
                  attrs: {
                    heading: "{{ item.name }}",
                    body: "{{ item.blurb }}",
                    meta: "{{ item.price | currency }}",
                  },
                },
              ],
            },
            { type: "button", attrs: { label: "Book now", to: "/book" } },
          ]),
        ],
      },
      {
        key: "book",
        path: "/book",
        title: "Book an appointment",
        blocks: [
          section(
            [
              heading("Book an appointment"),
              { type: "form", attrs: { for: "booking", submitLabel: "Request this time" } },
            ],
            { width: "narrow" },
          ),
        ],
      },
    ],
  }),
};

export const STARTERS: readonly Starter[] = [bookings, enquiries, blank];

export const starterFor = (key: string): Starter | undefined => STARTERS.find((s) => s.key === key);
