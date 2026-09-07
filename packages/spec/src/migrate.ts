/**
 * Bringing a stored spec forward (ADR 0003 §3).
 *
 * `specVersion` versions the *shape of the document*, and a bump is a data
 * migration — the record said so from the first release and this is the first
 * time it has been needed. It is exercised now rather than written the day an
 * upgrade takes somebody's site down.
 *
 * Rules this follows, and they are the ones that make an automatic migration
 * safe to run unattended on every boot:
 *
 *   - **Deterministic.** No clock, no randomness, no network. The same document
 *     migrates to the same document on every install.
 *   - **Idempotent.** Running it twice changes nothing the second time.
 *   - **It never drops what it does not understand.** A step it cannot convert
 *     is left as it is, so the failure is a validation error naming the step
 *     rather than an automation that quietly disappeared.
 */

/** Each step takes the document from `from` to `from + 1`. */
const STEPS: Record<number, (document: Record<string, unknown>) => Record<string, unknown>> = {
  /**
   * 1 → 2: action names are `namespace.verb`, not kebab-case.
   *
   * `Step.action` was typed as a `Key`, which has no dots, while every action
   * ever written down — in ADR 0005, ADR 0009 and the example site — is
   * `email.send` or `entry.transition`. Nothing had run one, so nothing had
   * noticed (ADR 0024, consequences).
   *
   * `sms-send` becomes `sms.send`: the last hyphen becomes the dot, which is
   * how every one of those names was built. A name that already has a dot is
   * left alone, and one with no hyphen has no conversion and stays — it will be
   * reported as an unknown action, which is the truth.
   */
  1: (document) => {
    const dotted = (action: unknown): unknown => {
      if (typeof action !== "string" || action.includes(".")) return action;
      const at = action.lastIndexOf("-");
      return at > 0 ? `${action.slice(0, at)}.${action.slice(at + 1)}` : action;
    };

    const steps = (list: unknown): unknown =>
      Array.isArray(list)
        ? list.map((step) =>
            step && typeof step === "object"
              ? {
                  ...(step as Record<string, unknown>),
                  action: dotted((step as Record<string, unknown>)["action"]),
                }
              : step,
          )
        : list;

    const logic = Array.isArray(document["logic"])
      ? document["logic"].map((workflow) =>
          workflow && typeof workflow === "object"
            ? {
                ...(workflow as Record<string, unknown>),
                steps: steps((workflow as Record<string, unknown>)["steps"]),
              }
            : workflow,
        )
      : document["logic"];

    // A flow's `onComplete` hands to the same registry, so it carries the same
    // names and the same fix.
    const pages = Array.isArray(document["pages"])
      ? document["pages"].map((page) => {
          if (!page || typeof page !== "object") return page;
          const flows = (page as Record<string, unknown>)["flows"];
          if (!Array.isArray(flows)) return page;
          return {
            ...(page as Record<string, unknown>),
            flows: flows.map((flow) =>
              flow && typeof flow === "object" && "onComplete" in flow
                ? {
                    ...(flow as Record<string, unknown>),
                    onComplete: steps((flow as Record<string, unknown>)["onComplete"]),
                  }
                : flow,
            ),
          };
        })
      : document["pages"];

    return { ...document, specVersion: 2, logic, pages };
  },
};

/**
 * Migrate a stored document up to the current version.
 *
 * Anything that is not an object, or is already current, comes back untouched —
 * the caller's parse is what reports a document this cannot help.
 */
export function migrateSpec(input: unknown, target: number): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;

  let document = input as Record<string, unknown>;
  let version =
    typeof document["specVersion"] === "number" ? (document["specVersion"] as number) : 1;

  while (version < target) {
    const step = STEPS[version];
    // A version with no step forward is a document from a *newer* release, or a
    // gap in this table. Either way, guessing is worse than refusing.
    if (!step) break;
    document = step(document);
    version =
      typeof document["specVersion"] === "number"
        ? (document["specVersion"] as number)
        : version + 1;
  }

  return document;
}
