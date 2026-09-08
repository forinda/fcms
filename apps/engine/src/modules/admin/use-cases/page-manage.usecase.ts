/**
 * Adding, describing and removing a page (ADR 0035).
 *
 * The canvas edits what is *on* a page. Nothing edited the page itself — its
 * address, its title, whether it is a draft — and nothing could make one, so a
 * site's set of pages was fixed at whatever the CLI or the assistant last
 * wrote.
 *
 * A new page arrives empty, which is valid: the canvas is where blocks are
 * added, and a page that had to be born with a block would be this screen
 * guessing at the content.
 */
import { Inject, Scope as Lifetime, Service } from "@forinda/kickjs";
import { SiteSpec, type Page } from "@forinda-cms/spec";

import { ApplySpecUseCase } from "./apply-spec.usecase";

export interface EditInput {
  readonly actor: string;
  readonly allowDestructive?: boolean;
}

export type EditResult = { ok: true; seq: number } | { ok: false; error: string };

export interface PageSettings {
  readonly title: string;
  readonly path: string;
  readonly draft: boolean;
  /** Bound to one entry of a content type — a detail page. */
  readonly collection?: string | undefined;
  readonly seoTitle?: string | undefined;
  readonly seoDescription?: string | undefined;
  readonly noindex?: boolean;
  /** `none` opts out of the site's header and footer. */
  readonly bare?: boolean;
}

@Service({ scope: Lifetime.REQUEST })
export class PageManageUseCase {
  constructor(@Inject(ApplySpecUseCase) private readonly applySpec: ApplySpecUseCase) {}

  create(spec: SiteSpec, key: string, title: string, path: string, input: EditInput) {
    return this.edit(spec, input, (pages) => {
      if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(key)) return "Use lowercase words joined by -.";
      if (pages.some((p) => p.key === key)) return `There is already a page called "${key}".`;
      if (!title.trim()) return "Give it a title.";

      const address = normalise(path);
      if (typeof address !== "string") return address.error;
      if (pages.some((p) => p.path === address)) return `Something already answers ${address}.`;

      // Empty on purpose. The canvas is where blocks go, and a page invented
      // with a heading nobody asked for is content this screen made up.
      pages.push({ key, title: title.trim(), path: address, blocks: [], draft: false } as Page);
      return null;
    });
  }

  update(spec: SiteSpec, key: string, settings: PageSettings, input: EditInput) {
    return this.edit(spec, input, (pages) => {
      const page = pages.find((p) => p.key === key);
      if (!page) return "That page no longer exists.";
      if (!settings.title.trim()) return "Give it a title.";

      const address = normalise(settings.path);
      if (typeof address !== "string") return address.error;
      if (pages.some((p) => p.key !== key && p.path === address)) {
        return `Something already answers ${address}.`;
      }
      if (settings.collection && !spec.content.some((t) => t.key === settings.collection)) {
        return `There is no type called "${settings.collection}".`;
      }

      const next = page as Page & Record<string, unknown>;
      next["title"] = settings.title.trim();
      next["path"] = address;
      next["draft"] = settings.draft;

      if (settings.collection) next["collection"] = settings.collection;
      else delete next["collection"];

      if (settings.bare) next["layout"] = "none";
      else delete next["layout"];

      // SEO is absent rather than empty: `seo: {}` is a key that says nothing,
      // and the renderer already falls back to the page's own title.
      const seo: Record<string, unknown> = {};
      if (settings.seoTitle?.trim()) seo["title"] = settings.seoTitle.trim();
      if (settings.seoDescription?.trim()) seo["description"] = settings.seoDescription.trim();
      if (settings.noindex) seo["noindex"] = true;
      // An image is set on the canvas, where the media library is; keeping it
      // means this form cannot silently drop one.
      const image = (page.seo as { image?: string } | undefined)?.image;

      if (image) seo["image"] = image;
      // `noindex` has a default, so the parse fills it in — writing it here
      // would mean this form deciding the shape rather than the schema.
      if (Object.keys(seo).length > 0) next["seo"] = seo as Page["seo"];
      else delete next["seo"];

      return null;
    });
  }

  /** Removing a page. Destructive: its blocks go with it. */
  remove(spec: SiteSpec, key: string, input: EditInput) {
    return this.edit(spec, input, (pages) => {
      const at = pages.findIndex((p) => p.key === key);
      if (at < 0) return "That page no longer exists.";
      pages.splice(at, 1);
      return null;
    });
  }

  private async edit(
    spec: SiteSpec,
    input: EditInput,
    mutate: (pages: Page[]) => string | null,
  ): Promise<EditResult> {
    const draft = structuredClone(spec) as SiteSpec & { pages: Page[] };
    const refusal = mutate(draft.pages);
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
        source: "pages",
        allowDestructive: input.allowDestructive === true,
      });
      return { ok: true, seq };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/**
 * An address, as the schema wants it: absolute, lowercase, no trailing slash.
 *
 * Fixed rather than refused where the fix is obvious — someone typing
 * `services/` means `/services`, and a form that says "absolute lowercase path"
 * at them is a form written for the schema rather than for the person.
 */
function normalise(path: string): string | { error: string } {
  const trimmed = path.trim().toLowerCase();
  if (trimmed === "" || trimmed === "/") return "/";

  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withoutTrailing = withSlash.replace(/\/+$/, "");
  if (!/^\/([a-z0-9\-/]*[a-z0-9])?$/.test(withoutTrailing) || withoutTrailing.includes("//")) {
    return {
      error: `“${path.trim()}” is not an address. Use lowercase words and hyphens, like /about or /our-services.`,
    };
  }
  return withoutTrailing;
}
