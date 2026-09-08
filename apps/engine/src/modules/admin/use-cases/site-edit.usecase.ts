/**
 * The site itself: its name, and its theme (ADR 0035).
 *
 * Tier 1 (ADR 0004) is the whole reason this screen is small and worth having:
 * every colour in the site is a `token:` into `theme.colors`, so changing a
 * brand colour here changes every heading, button and border at once. A screen
 * that let someone type a colour into a block would defeat that, which is why
 * there is no such screen anywhere.
 *
 * Same shape as the other builders: produce a whole spec, send it through
 * `ApplySpecUseCase`, inherit the diff, the history and the undo.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";
import { SiteSpec, type Block, type Page, type Theme } from "@forinda-cms/spec";
import { baseStylesheetTokens } from "@forinda-cms/render";

import { ApplySpecUseCase } from "./apply-spec.usecase";

export interface EditInput {
  readonly actor: string;
}

export type EditResult = { ok: true; seq: number } | { ok: false; error: string };

/** The three groups a theme token can belong to. */
export type TokenGroup = "colors" | "typeScale" | "radius";

export interface SiteSettings {
  readonly name: string;
  readonly fonts: { body: string; heading?: string | undefined; mono?: string | undefined };
  /** Every token's current value, by group and name. */
  readonly tokens: Readonly<Record<TokenGroup, Readonly<Record<string, string>>>>;
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
const TOKEN_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

@Service({ scope: Lifetime.REQUEST })
export class SiteEditUseCase {
  constructor(@Inject(ApplySpecUseCase) private readonly applySpec: ApplySpecUseCase) {}

  /** The name and every token value, in one save. */
  update(spec: SiteSpec, settings: SiteSettings, input: EditInput) {
    return this.edit(spec, input, (draft) => {
      if (!settings.name.trim()) return "The site needs a name.";
      draft.name = settings.name.trim();

      if (!settings.fonts.body.trim()) return "The site needs a body font.";
      const fonts: Theme["fonts"] = { body: settings.fonts.body.trim() };
      if (settings.fonts.heading?.trim()) fonts.heading = settings.fonts.heading.trim();
      if (settings.fonts.mono?.trim()) fonts.mono = settings.fonts.mono.trim();
      draft.theme.fonts = fonts;

      for (const group of ["colors", "typeScale", "radius"] as const) {
        const values = settings.tokens[group];
        const existing = draft.theme[group];
        if (!existing) continue;

        for (const [name, value] of Object.entries(values)) {
          if (!(name in existing)) continue;
          const trimmed = value.trim();
          if (trimmed === "") return `${labelOf(group)} “${name}” needs a value.`;
          if (group === "colors" && !COLOR.test(trimmed)) {
            return `“${name}” has to be a colour like #1a7f5a.`;
          }
          existing[name] = trimmed;
        }
      }
      return null;
    });
  }

  addToken(spec: SiteSpec, group: TokenGroup, name: string, value: string, input: EditInput) {
    return this.edit(spec, input, (draft) => {
      const trimmedName = name.trim();
      const trimmedValue = value.trim();
      if (!TOKEN_NAME.test(trimmedName)) return "Use lowercase words joined by -.";
      if (group === "colors" && !COLOR.test(trimmedValue)) {
        return "A colour looks like #1a7f5a.";
      }
      if (trimmedValue === "") return "Give it a value.";

      const existing = draft.theme[group] ?? {};
      if (trimmedName in existing)
        return `There is already a ${single(group)} called "${trimmedName}".`;
      draft.theme[group] = { ...existing, [trimmedName]: trimmedValue };
      return null;
    });
  }

  /**
   * Removing a token.
   *
   * Refused while anything still points at it. A block whose colour is
   * `token:color.brand` renders nothing recognisable once `brand` is gone, and
   * the failure would be a page that looks wrong rather than a message.
   */
  removeToken(spec: SiteSpec, group: TokenGroup, name: string, input: EditInput) {
    return this.edit(spec, input, (draft) => {
      const existing = draft.theme[group];
      if (!existing || !(name in existing)) return "That one is already gone.";
      if (group === "colors" && Object.keys(existing).length === 1) {
        return "A theme needs at least one colour.";
      }
      if (group === "typeScale" && Object.keys(existing).length === 1) {
        return "A theme needs at least one size.";
      }

      const used = tokenUsage(spec, group, name);
      if (used.base) {
        return `The site's own styles use “${name}” — links, borders and the rest are drawn with it, so it cannot be removed.`;
      }
      if (used.count > 0) {
        return `${used.count} ${used.count === 1 ? "place still uses" : "places still use"} “${name}”. Change ${used.count === 1 ? "it" : "them"} first.`;
      }

      delete existing[name];
      return null;
    });
  }

  private async edit(
    spec: SiteSpec,
    input: EditInput,
    mutate: (draft: SiteSpec) => string | null,
  ): Promise<EditResult> {
    const draft = structuredClone(spec) as SiteSpec;
    const refusal = mutate(draft);
    if (refusal) return { ok: false, error: refusal };

    const validated = SiteSpec.safeParse(draft);
    if (!validated.success) {
      return {
        ok: false,
        error: validated.error.issues[0]?.message ?? "That change is not valid.",
      };
    }

    try {
      const { seq } = await this.applySpec.execute(validated.data, {
        actor: input.actor,
        source: "settings",
      });
      return { ok: true, seq };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/**
 * How many places name this token.
 *
 * A colour is always a `token:` reference, so counting them is a search over
 * everything except the theme itself. A size or a radius is a style prop
 * holding the token's *name*, so those are counted by walking the blocks —
 * a text search for "md" would match half the document.
 */
export function tokenUsage(
  spec: SiteSpec,
  group: TokenGroup,
  name: string,
): { count: number; base: boolean } {
  return {
    count: usesToken(spec, group, name),
    // The site's own stylesheet counts as a user. `BASE_CSS` reads
    // `var(--color-brand, #06c)`, so a `brand` that looks unused is one whose
    // removal turns every link on the site the fallback blue — silently.
    base: baseStylesheetTokens().some((t) => t.group === group && t.name === name),
  };
}

function usesToken(spec: SiteSpec, group: TokenGroup, name: string): number {
  if (group === "colors") {
    const { theme: _theme, ...rest } = spec;
    return JSON.stringify(rest).split(`token:color.${name}`).length - 1;
  }

  // A text size is named by `style.fontSize`, which holds the step's name — so
  // it is counted by walking the blocks. A text search for "md" would match the
  // radius scale, a field called "md", and the theme itself.
  if (group === "typeScale") {
    let count = 0;
    for (const block of everyBlock(spec)) {
      if ((block as { style?: { fontSize?: string } }).style?.fontSize === name) count += 1;
    }
    return count;
  }

  // Nothing in a spec can name a radius token. `style.radius` is the tier-2
  // scale (`sm`, `md`, `lg`), which the renderer maps to fixed lengths — the
  // theme's own radius values are read by the stylesheet alone, which
  // `tokenUsage` reports separately.
  return 0;
}

/** Every block in the site — pages, components and the layout's own chrome. */
function* everyBlock(spec: SiteSpec): Generator<Block> {
  const roots: Block[] = [
    ...spec.pages.flatMap((p: Page) => p.blocks as Block[]),
    ...spec.components.flatMap((c) => c.blocks as Block[]),
    ...((spec.layout?.header ?? []) as Block[]),
    ...((spec.layout?.footer ?? []) as Block[]),
  ];

  const stack = [...roots];
  while (stack.length > 0) {
    const block = stack.pop()!;
    yield block;
    stack.push(...(block.children ?? []), ...(block.item ?? []));
  }
}

const labelOf = (group: TokenGroup): string =>
  group === "colors" ? "Colour" : group === "typeScale" ? "Size" : "Corner";

const single = (group: TokenGroup): string =>
  group === "colors" ? "colour" : group === "typeScale" ? "size" : "corner";
