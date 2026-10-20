import type { z } from "zod";

type IsExactly<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type MatchesInput<Schema extends z.ZodType, Input> =
	IsExactly<z.input<Schema>, Input> extends true
		? unknown
		: { "schema input must exactly match the config interface": z.input<Schema> };

/**
 * Binds a zod schema to its hand-written config interface. Typechecking fails unless the schema's
 * input type exactly matches `Input`, so the interface (which carries the JSDoc shown in editor
 * hovers) can't drift from what the schema accepts.
 *
 * @example
 * export const fooConfigSchema = configSchema<FooConfig>()(z.object({ ... }));
 */
export function configSchema<Input>() {
	return <Schema extends z.ZodType>(schema: Schema & MatchesInput<Schema, Input>): Schema => schema;
}
