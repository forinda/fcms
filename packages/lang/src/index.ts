/**
 * @forinda-cms/lang — the YAML surface syntax.
 *
 * ADR 0006 picks a strict YAML 1.2 profile, chosen primarily because **the model
 * is a first-class author of this language** and YAML has more training data
 * behind it than any alternative. The spec JSON is the AST; this package is a
 * parser and a printer against it — which is what keeps the syntax *swappable*.
 * If the escape hatch in ADR 0006 ever triggers, only this package changes.
 *
 * Kept separate from `@forinda-cms/spec` so the admin app can validate a spec
 * in the browser without shipping a YAML parser.
 */
export * from "./errors.js";
export * from "./parse.js";
export * from "./print.js";
export * from "./layout.js";
// `checkUnquotedTemplates` is exported beside the options because the CLI
// applies both to data files too: a sentence with a comma in it, unquoted, is
// how a service description once became a key.
export { checkUnquotedTemplates, STRICT_PARSE_OPTIONS } from "./profile.js";
