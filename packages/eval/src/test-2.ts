#!/usr/bin/env node
/**
 * ADR 0007 test 2, prepared.
 *
 * The protocol (docs/running-test-2.md) needs five copies of a spec, one change
 * each, and the five diffs printed. Doing that by hand is twenty minutes of
 * fiddling before the twenty minutes that matter — and the fiddling is where a
 * change ends up subtly different from the one the protocol specifies, which
 * quietly changes what is being measured.
 *
 * So this makes them. It takes a spec directory — ideally one already edited to
 * resemble the owner's own business, because reviewing a change to a fictional
 * salon is a puzzle and reviewing one to your own is a decision — and prints
 * the five diffs in the order to show them.
 *
 * It does not score anything. The transcript of what the owner *said* is the
 * artifact worth having (doc 13), and no script can take that down.
 */
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { diffSpecs, SiteSpec, summarise } from "@forinda-cms/spec";
import { splitFiles } from "@forinda-cms/lang";
import { loadProject } from "@forinda/fcms-cli";

interface Variant {
  readonly id: string;
  readonly title: string;
  readonly expect: "additive" | "destructive" | "subtle";
  /** Returns the changed spec, or a reason this spec cannot host the change. */
  readonly change: (spec: SiteSpec) => unknown;
}

/**
 * The five from the protocol, in its order and with its expectations.
 *
 * Two destructive and one subtle, deliberately: doc 13's argument is that a
 * wrong "yes" is cheap and a wrong "no" is visible, so the test has to include
 * the changes where being wrong is expensive.
 */
const VARIANTS: Variant[] = [
  {
    id: "1-add-field",
    title: 'Add an optional "Notes" field to Booking',
    expect: "additive",
    change: (spec) => {
      const type = spec.content.find((t) => t.key === "booking");
      if (!type) return "no `booking` content type in this spec";
      return replaceType(spec, {
        ...type,
        fields: [...type.fields, { name: "notes", label: "Notes", type: "text" as const }],
      });
    },
  },
  {
    id: "2-remove-field",
    title: "Remove a field that holds data",
    expect: "destructive",
    change: (spec) => {
      const type = spec.content.find((t) => t.key === "service" && t.fields.length > 2);
      if (!type) return "no `service` type with a spare field";
      const victim = type.fields.find((f) => f.name !== "slug" && f.name !== "name");
      if (!victim) return "nothing safe to remove";
      return replaceType(spec, {
        ...type,
        fields: type.fields.filter((f) => f.name !== victim.name),
      });
    },
  },
  {
    id: "3-move-page",
    title: "Move the booking page to a new address",
    expect: "destructive",
    change: (spec) => {
      const page = spec.pages.find((p) => p.path === "/book");
      if (!page) return "no page at /book";
      return {
        ...spec,
        pages: spec.pages.map((p) => (p.key === page.key ? { ...p, path: "/appointments" } : p)),
      };
    },
  },
  {
    id: "4-reorder",
    title: "Reorder two sections on the homepage",
    expect: "subtle",
    change: (spec) => {
      const page = spec.pages.find((p) => p.path === "/");
      if (!page || page.blocks.length < 3) return "homepage has too few sections to reorder";
      const blocks = [...page.blocks];
      const [second] = blocks.splice(1, 1);
      blocks.splice(2, 0, second!);
      return { ...spec, pages: spec.pages.map((p) => (p.key === page.key ? { ...p, blocks } : p)) };
    },
  },
  {
    id: "5-add-automation",
    title: "Add an automation that texts a reminder before the appointment",
    expect: "additive",
    change: (spec) => {
      if (spec.logic.some((f) => f.key === "remind-before")) return "already present";

      // The salon already texts on confirmation, so this adds the *other* one an
      // owner asks for. Same shape; a duplicate would diff as no change and
      // measure nothing.
      const existing = spec.logic[0];
      if (!existing) return "no automation to model this one on";

      return {
        ...spec,
        logic: [
          ...spec.logic,
          {
            key: "remind-before",
            label: "Text a reminder the day before the appointment",
            trigger: { on: "schedule", cron: "0 9 * * *" },
            steps: existing.steps,
          },
        ],
      };
    },
  },
];

function replaceType(spec: SiteSpec, type: { key: string } & Record<string, unknown>): unknown {
  return { ...spec, content: spec.content.map((t) => (t.key === type.key ? type : t)) };
}

function main(): number {
  const root = process.argv[2];
  if (!root || !existsSync(root)) {
    console.error("usage: test-2 <spec-directory>   (a copy of the owner's site)");
    console.error("  see docs/running-test-2.md — edit it to look like their business first.");
    return 1;
  }

  const loaded = loadProject(root);
  if (!loaded.ok) {
    console.error(loaded.diagnostics.map((d) => `${d.path} ${d.message}`).join("\n"));
    return 1;
  }

  const base = loaded.project.spec;
  const counts = Object.fromEntries(base.content.map((t) => [t.key, 12]));
  const outDir = `${root}-variants`;

  console.log(`Base: ${base.name}\nVariants: ${outDir}\n`);

  for (const variant of VARIANTS) {
    const proposed = variant.change(base);
    if (typeof proposed === "string") {
      console.log(`${variant.id}  SKIPPED — ${proposed}\n`);
      continue;
    }

    // Parsed, not trusted: a variant that does not validate would produce a
    // diff of something the product would refuse, which is not the thing being
    // measured.
    const validated = SiteSpec.safeParse(proposed);
    if (!validated.success) {
      console.log(`${variant.id}  SKIPPED — ${validated.error.issues[0]?.message ?? "invalid"}\n`);
      continue;
    }
    const changed = validated.data;

    const dir = join(outDir, variant.id);
    mkdirSync(dir, { recursive: true });
    cpSync(root, dir, { recursive: true });
    for (const [name, text] of Object.entries(splitFiles(changed))) {
      writeFileSync(join(dir, name), text, "utf8");
    }

    const changes = diffSpecs(base, changed, counts);
    const { destructive } = summarise(changes);

    console.log(`── ${variant.id}: ${variant.title}`);
    // Printed exactly as the owner will see it, and nothing else — the protocol
    // says show one diff and ask one question, so anything extra here is a
    // rehearsal of the explaining that invalidates the test.
    for (const change of changes) {
      console.log(
        `   ${change.classification === "destructive" ? "!" : " "} ${change.summary}` +
          (change.impact ? `\n     ${change.impact}` : ""),
      );
    }

    // A mismatch is a finding about the classifier, before anyone is in the room.
    const actual = destructive > 0 ? "destructive" : "additive";
    if (variant.expect !== "subtle" && actual !== variant.expect) {
      console.log(`   ⚠ expected ${variant.expect}, classified ${actual}`);
    }
    console.log();
  }

  console.log("Show them one at a time, beside the running site. Ask:");
  console.log('  "What would this do to your business?"');
  console.log("Then stop talking. Write down their words, not your verdict.");
  return 0;
}

process.exit(main());
