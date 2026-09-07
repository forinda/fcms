/**
 * The connection, as a binding.
 *
 * A leaf on purpose: this file imports nothing from the app. The token used to
 * be declared in the adapter that opens the pool, which reads better right up
 * until the adapter imports the classes that inject it — then the repositories
 * import the adapter, the adapter imports them back, and whichever side loads
 * second sees `DB` as `undefined`.
 *
 * A parameter decorator makes that failure quiet: `@Inject(undefined)` records
 * no token, the container falls back to the parameter's reflected type, and an
 * interface reflects as `Object` — so every request dies on
 * `No provider for Object`, naming neither the class nor the token. Tokens
 * therefore live in modules that import nothing.
 */
import { createToken, type InjectionToken } from "@forinda/kickjs";
import type { Db } from "@forinda-cms/db";

export const DB: InjectionToken<Db> = createToken("app/Db/connection");
