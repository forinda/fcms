/**
 * Theme tokens and the tier-2 props, compiled to CSS.
 *
 * Tier 1 becomes custom properties on `:root`, which is what makes "restyle the
 * brand" change everything at once (ADR 0004's second rule). Tier 2 props then
 * resolve to `var(--…)` rather than literal values, so a token change propagates
 * without touching a single block.
 *
 * If a tier-2 prop ever compiles to a literal colour or length, tier 1 has been
 * broken and the styling model with it.
 */
import type { SiteSpec, StyleProps, Theme } from "@forinda-cms/spec";

/** Fixed by the theme — there are no custom breakpoints below tier 3. */
export const BREAKPOINT_PX = { base: 0, sm: 480, md: 768, lg: 1024, xl: 1280 } as const;

/** `base` is phone (doc 14: ~90% mobile access). Themes are authored mobile-up. */
const SPACE_SCALE: Record<string, string> = {
  none: "0",
  xs: "0.25rem",
  sm: "0.5rem",
  md: "1rem",
  lg: "2rem",
  xl: "3rem",
  "2xl": "5rem",
};

const RADIUS_SCALE: Record<string, string> = {
  none: "0",
  xs: "2px",
  sm: "4px",
  md: "8px",
  lg: "16px",
  xl: "24px",
  "2xl": "9999px",
};

const WIDTHS: Record<string, string> = { full: "100%", container: "72rem", narrow: "42rem" };
const BORDERS: Record<string, string> = {
  none: "none",
  hairline: "1px solid var(--color-border, #e5e5e5)",
  strong: "2px solid var(--color-border, #d4d4d4)",
};
const SHADOWS: Record<string, string> = {
  none: "none",
  sm: "0 1px 3px rgb(0 0 0 / 0.08)",
  md: "0 4px 16px rgb(0 0 0 / 0.12)",
};
const WEIGHTS: Record<string, string> = { regular: "400", medium: "500", bold: "700" };

/** `token:color.brand` → `var(--color-brand)`. Never a literal. */
function tokenVar(ref: string): string {
  const path = ref.replace(/^token:/, "").replace(/\./g, "-");
  return `var(--${path})`;
}

export function themeCss(theme: Theme): string {
  const lines: string[] = [":root {"];
  for (const [name, value] of Object.entries(theme.colors))
    lines.push(`  --color-${name}: ${value};`);
  for (const [name, value] of Object.entries(theme.typeScale))
    lines.push(`  --type-${name}: ${value};`);
  for (const [name, value] of Object.entries(theme.radius ?? {}))
    lines.push(`  --radius-${name}: ${value};`);
  lines.push(`  --font-body: ${theme.fonts.body};`);
  if (theme.fonts.heading) lines.push(`  --font-heading: ${theme.fonts.heading};`);
  lines.push("}");
  return lines.join("\n");
}

type Declarations = Record<string, string>;

/** The breakpoint-invariant half of tier 2. */
function invariant(style: StyleProps): Declarations {
  const d: Declarations = {};
  const s = style as Record<string, unknown>;

  if (typeof s["background"] === "string") {
    d["background"] =
      s["background"] === "none"
        ? "transparent"
        : s["background"].startsWith("token:")
          ? tokenVar(s["background"])
          : `center / cover no-repeat url("${s["background"]}")`;
  }
  if (typeof s["textColor"] === "string") d["color"] = tokenVar(s["textColor"]);
  if (typeof s["radius"] === "string") d["border-radius"] = RADIUS_SCALE[s["radius"]] ?? "0";
  if (typeof s["border"] === "string") d["border"] = BORDERS[s["border"]] ?? "none";
  if (typeof s["shadow"] === "string") d["box-shadow"] = SHADOWS[s["shadow"]] ?? "none";
  if (typeof s["fontSize"] === "string") d["font-size"] = `var(--type-${s["fontSize"]})`;
  if (typeof s["fontWeight"] === "string") d["font-weight"] = WEIGHTS[s["fontWeight"]] ?? "400";
  if (typeof s["align"] === "string")
    d["align-items"] =
      s["align"] === "start" || s["align"] === "end" ? `flex-${s["align"]}` : String(s["align"]);
  if (typeof s["justify"] === "string") {
    d["justify-content"] =
      s["justify"] === "between"
        ? "space-between"
        : s["justify"] === "start" || s["justify"] === "end"
          ? `flex-${s["justify"]}`
          : String(s["justify"]);
  }
  return d;
}

/** Read a responsive value at one breakpoint, falling back to `base`. */
function at(value: unknown, bp: string): unknown {
  if (value === null || typeof value !== "object") return bp === "base" ? value : undefined;
  const map = value as Record<string, unknown>;
  // A `{x, y}` padding object is a value, not a breakpoint map.
  if ("x" in map || "y" in map) return bp === "base" ? value : undefined;
  return map[bp];
}

/** The six props that may vary by breakpoint (ADR 0004). */
function responsive(style: StyleProps, bp: string): Declarations {
  const d: Declarations = {};
  const s = style as Record<string, unknown>;

  const padding = at(s["padding"], bp);
  if (typeof padding === "string") d["padding"] = SPACE_SCALE[padding] ?? "0";
  else if (padding && typeof padding === "object") {
    const p = padding as { x?: string; y?: string };
    if (p.y) d["padding-block"] = SPACE_SCALE[p.y] ?? "0";
    if (p.x) d["padding-inline"] = SPACE_SCALE[p.x] ?? "0";
  }

  const gap = at(s["gap"], bp);
  if (typeof gap === "string") d["gap"] = SPACE_SCALE[gap] ?? "0";

  const width = at(s["width"], bp);
  if (typeof width === "string") {
    d["width"] = "100%";
    d["max-width"] = WIDTHS[width] ?? "100%";
    if (width !== "full") d["margin-inline"] = "auto";
  }

  const cols = at(s["cols"], bp);
  if (typeof cols === "number") d["grid-template-columns"] = `repeat(${cols}, minmax(0, 1fr))`;

  const textAlign = at(s["textAlign"], bp);
  if (typeof textAlign === "string") d["text-align"] = textAlign;

  return d;
}

function declarationsToCss(d: Declarations): string {
  return Object.entries(d)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

/**
 * Compile one block's style into scoped rules.
 *
 * The generated class is what makes tier-3 `css` safe: a block's custom CSS is
 * emitted under its own class, so it cannot reach an element the block does not
 * own (ADR 0004's second boundary rule). The author never writes a selector.
 */
export function blockCss(
  className: string,
  style: StyleProps | undefined,
  custom?: string,
): string {
  if (!style && !custom) return "";
  const rules: string[] = [];

  if (style) {
    const base = { ...invariant(style), ...responsive(style, "base") };
    if (Object.keys(base).length) rules.push(`.${className}{${declarationsToCss(base)}}`);

    for (const bp of ["sm", "md", "lg", "xl"] as const) {
      const d = responsive(style, bp);
      if (Object.keys(d).length) {
        rules.push(
          `@media (min-width:${BREAKPOINT_PX[bp]}px){.${className}{${declarationsToCss(d)}}}`,
        );
      }
    }

    for (const bp of (style as { hideOn?: string[] }).hideOn ?? []) {
      const min = BREAKPOINT_PX[bp as keyof typeof BREAKPOINT_PX] ?? 0;
      rules.push(
        min === 0
          ? `@media (max-width:${BREAKPOINT_PX.sm - 1}px){.${className}{display:none}}`
          : `@media (min-width:${min}px){.${className}{display:none}}`,
      );
    }
  }

  // Tier 3, scoped to this block instance. The AI reads this and never writes it.
  if (custom) rules.push(`.${className}{${custom}}`);

  return rules.join("");
}

/** A small, opinionated baseline. Mobile-first, no reset framework. */
export const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
body{margin:0;font-family:var(--font-body),system-ui,sans-serif;line-height:1.6;color:var(--color-text,#1a1a1a);background:var(--color-background,#fff)}
h1,h2,h3,h4{font-family:var(--font-heading,var(--font-body)),system-ui,sans-serif;line-height:1.2;margin:0 0 0.5em}
p{margin:0 0 1em}
img{max-width:100%;height:auto;display:block}
a{color:var(--color-brand,#06c)}
.fx-stack{display:flex;flex-direction:column}
.fx-row{display:flex;flex-direction:row;flex-wrap:wrap}
.fx-grid{display:grid}
.fx-section{display:block}
.fx-card-meta{color:var(--color-brand,#06c);font-weight:600;margin:0}
.fx-map iframe{width:100%;height:20rem;border:0;display:block;border-radius:var(--radius-md,8px)}
.fx-map-link{display:inline-block;margin-top:.4rem;font-size:.9rem}
`.trim();

export function siteCss(spec: SiteSpec): string {
  return [themeCss(spec.theme), BASE_CSS, spec.css ?? ""].filter(Boolean).join("\n");
}
