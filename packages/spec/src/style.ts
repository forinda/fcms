/**
 * Theme tokens (tier 1) and the tier-2 style props.
 *
 * ADR 0004 fixed the list at sixteen and gave the rule that generates it: a prop
 * belongs here only if an owner asks for it in plain English, its value is a
 * token reference or a small closed enum, and it cannot break responsiveness or
 * reach outside its own block.
 *
 * The closed-enum part is load-bearing. A free value would defeat tier 1 —
 * restyling the brand has to change everything at once — so every scale below is
 * an enum, never a number or a colour string.
 */
import { z } from "zod";

import { Key, Label, TokenRef } from "./primitives.js";

/** Fixed by the theme. There are no custom breakpoints below tier 3 (ADR 0004). */
export const BREAKPOINTS = ["base", "sm", "md", "lg", "xl"] as const;
export const Breakpoint = z.enum(BREAKPOINTS);

/**
 * `base` means **phone**, not "desktop squeezed down" (doc 14: ~90% of the target
 * market's access is mobile). Themes are authored mobile-up.
 */
export const Responsive = <T extends z.ZodTypeAny>(inner: T) =>
  z.union([
    inner,
    z.object({
      base: inner,
      sm: inner.optional(),
      md: inner.optional(),
      lg: inner.optional(),
      xl: inner.optional(),
    }),
  ]);

const SCALE = ["none", "xs", "sm", "md", "lg", "xl", "2xl"] as const;
export const Scale = z.enum(SCALE);

// ── Tier 1: the theme ────────────────────────────────────────────────────────

export const Theme = z.object({
  /** Named colours. Everything colour-valued elsewhere is a `token:` into this. */
  colors: z.record(Key, z.string().regex(/^#[0-9a-fA-F]{6}$/)),
  fonts: z.object({
    body: z.string(),
    heading: z.string().optional(),
    mono: z.string().optional(),
  }),
  /** Type scale steps, smallest first. `fontSize` indexes into this by name. */
  typeScale: z.record(Key, z.string()),
  radius: z.record(Key, z.string()).optional(),
});
export type Theme = z.infer<typeof Theme>;

// ── Tier 2: the sixteen props ────────────────────────────────────────────────

/** A colour must come from the theme. "This blue specifically" is a request to add a token. */
const ColorValue = TokenRef;

export const StyleProps = z
  .object({
    // Box — the highest-demand group. Omitting these guarantees tier-3 leakage.
    padding: Responsive(
      z.union([Scale, z.object({ x: Scale.optional(), y: Scale.optional() })]),
    ).optional(),
    /** Spacing *between* children — what people mean when they say "margin". Layout blocks only. */
    gap: Responsive(Scale).optional(),
    width: Responsive(z.enum(["full", "container", "narrow"])).optional(),
    align: z.enum(["start", "center", "end", "stretch"]).optional(),
    justify: z.enum(["start", "center", "end", "between"]).optional(),

    // Surface
    background: z.union([ColorValue, z.literal("none"), z.string().regex(/^asset:/)]).optional(),
    textColor: ColorValue.optional(),
    radius: Scale.optional(),
    /** An enum, not width + style + colour: three props collapsed into one intent. */
    border: z.enum(["none", "hairline", "strong"]).optional(),
    /** Elevation as intent, never a box-shadow string. */
    shadow: z.enum(["none", "sm", "md"]).optional(),

    // Type
    textAlign: Responsive(z.enum(["left", "center", "right"])).optional(),
    /** A step on the tier-1 type scale. Steps, not px — the scale stays the scale. */
    fontSize: Key.optional(),
    fontWeight: z.enum(["regular", "medium", "bold"]).optional(),

    // Structure & visibility
    /** The one layout number worth exposing, and responsive by construction. Grid only. */
    cols: Responsive(z.number().int().min(1).max(6)).optional(),
    hideOn: z.array(Breakpoint).optional(),
    /** The pressure valve: block-declared, so new demand lands here or in tier 1. */
    variant: Key.optional(),
  })
  .strict();

export type StyleProps = z.infer<typeof StyleProps>;

/**
 * Tier 3. Custom CSS is a *field in the spec*, never a sidecar file — so it
 * patches, versions and undoes like everything else (doc 07).
 *
 * Block-level CSS is auto-scoped to that block instance by the renderer; the
 * author does not write selectors. Site-level CSS is the single explicit escape
 * hatch and is gated to the `developer` role (ADR 0008).
 *
 * The leaf rule holds: the AI reads this and never writes it, and deleting every
 * tier-3 rule must leave a working, plainer site.
 */
export const CustomCss = z.string().max(20_000);

/** Layout primitives. No coordinates anywhere — that is what stops content being trapped. */
export const Layout = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("stack") }),
  z.object({ kind: z.literal("row"), wrap: z.boolean().optional() }),
  z.object({ kind: z.literal("grid"), cols: Responsive(z.number().int().min(1).max(6)) }),
  z.object({ kind: z.literal("section") }),
]);
export type Layout = z.infer<typeof Layout>;

export const ThemeTokens = z.object({ theme: Theme, css: CustomCss.optional() });
export const StyleLabel = Label;
