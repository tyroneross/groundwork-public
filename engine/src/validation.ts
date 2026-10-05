// SPDX-License-Identifier: Apache-2.0
// Groundwork's source-owned, synchronous JSON contract validator.
// Written for the operations used by this engine; no library implementation is vendored.

export type IssuePath = Array<string | number>;
export interface ValidationIssue { code: string; path: IssuePath; message: string }
export interface RefinementContext {
  addIssue(issue: { code: string; path?: IssuePath; message: string }): void;
}
export class ValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(JSON.stringify(issues, null, 2));
    this.name = "ValidationError";
  }
}

type Context = { issues: ValidationIssue[]; path: IssuePath; ancestors: Set<object> };
// A usable result has the declared type, even if bounds/refinements rejected it.
// Never run an object refinement on structurally invalid children.
type Result<T> = { value: T; usable: boolean };
type Reader<T> = (input: unknown, context: Context) => Result<T>;
export type Output<S extends Schema<any>> = S["outputType"];
export type Input<S extends Schema<any>> = S["inputType"];
export type Infer<S extends Schema<any>> = Output<S>;
export type ParseOutcome<T> = { success: true; data: T } | { success: false; error: ValidationError };

function issue(context: Context, code: string, message: string): void {
  context.issues.push({ code, path: [...context.path], message });
}
function invalid<T>(context: Context, expected: string, input: unknown): Result<T> {
  issue(context, "invalid_type", input === undefined ? "Required" : `Expected ${expected}`);
  return { value: undefined as T, usable: false };
}
function child(context: Context, key: string | number): Context {
  return { ...context, path: [...context.path, key] };
}
function isObject(input: unknown): input is Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  // Data keys such as __proto__ must never invoke Object.prototype setters.
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}
function container<T>(input: object, context: Context, read: () => Result<T>): Result<T> {
  if (context.ancestors.has(input)) {
    issue(context, "invalid_type", "Cyclic values are not JSON contract data");
    return { value: undefined as T, usable: false };
  }
  context.ancestors.add(input);
  try { return read(); } finally { context.ancestors.delete(input); }
}

export class Schema<T, I = T> {
  declare readonly outputType: T;
  declare readonly inputType: I;
  constructor(readonly read: Reader<T>) {}

  safeParse(input: unknown): ParseOutcome<T> {
    const context: Context = { issues: [], path: [], ancestors: new Set() };
    const result = this.read(input, context);
    return result.usable && context.issues.length === 0
      ? { success: true, data: result.value }
      : { success: false, error: new ValidationError(context.issues) };
  }
  parse(input: unknown): T {
    const result = this.safeParse(input);
    if (!result.success) throw result.error;
    return result.data;
  }
  optional(): Schema<T | undefined, I | undefined> {
    return new Schema((input, context) => input === undefined
      ? { value: undefined, usable: true } : this.read(input, context));
  }
  default(value: Exclude<I, undefined>): Schema<Exclude<T, undefined>, I | undefined> {
    // Parse defaults through the underlying schema to create fresh arrays/objects.
    return new Schema((input, context) => this.read(input === undefined ? value : input, context) as Result<Exclude<T, undefined>>);
  }
  superRefine(check: (value: T, context: RefinementContext) => void): Schema<T, I> {
    return new Schema((input, context) => {
      const result = this.read(input, context);
      if (result.usable) check(result.value, {
        addIssue: (item) => context.issues.push({ ...item, path: [...context.path, ...(item.path ?? [])] }),
      });
      return result;
    });
  }
  refine(check: (value: T) => boolean, details: string | { message: string; path?: IssuePath }): Schema<T, I> {
    const item = typeof details === "string" ? { message: details } : details;
    return this.superRefine((value, context) => {
      if (!check(value)) context.addIssue({ code: "custom", ...item });
    });
  }
}

type Boundable = string | number | unknown[];
class BoundedSchema<T extends Boundable, I = T> extends Schema<T, I> {
  private bound(limit: number, lower: boolean, message?: string): BoundedSchema<T, I> {
    return new BoundedSchema((input, context) => {
      const result = this.read(input, context);
      if (result.usable) {
        const measure = typeof result.value === "number" ? result.value : result.value.length;
        if (lower ? measure < limit : measure > limit) {
          issue(context, lower ? "too_small" : "too_big", message ?? `Expected ${lower ? "at least" : "at most"} ${limit}${typeof result.value === "number" ? "" : " items/characters"}`);
        }
      }
      return result;
    });
  }
  min(limit: number, message?: string): BoundedSchema<T, I> { return this.bound(limit, true, message); }
  max(limit: number, message?: string): BoundedSchema<T, I> { return this.bound(limit, false, message); }
}

class StringSchema extends BoundedSchema<string> {
  override min(limit: number, message?: string): StringSchema { return new StringSchema(super.min(limit, message).read); }
  override max(limit: number, message?: string): StringSchema { return new StringSchema(super.max(limit, message).read); }
  private match(check: (value: string) => boolean, message: string): StringSchema {
    return new StringSchema((input, context) => {
      const result = this.read(input, context);
      if (result.usable && !check(result.value)) issue(context, "invalid_string", message);
      return result;
    });
  }
  regex(pattern: RegExp): StringSchema {
    // A global/sticky expression must not make repeated parses state dependent.
    return this.match((value) => new RegExp(pattern.source, pattern.flags).test(value), "Invalid string");
  }
  url(): StringSchema {
    return this.match((value) => { try { new URL(value); return true; } catch { return false; } }, "Invalid url");
  }
  datetime(options: { offset?: boolean } = {}): StringSchema {
    return this.match((value) => isDateTime(value, options.offset === true), "Invalid datetime");
  }
}
class NumberSchema extends BoundedSchema<number> {
  override min(limit: number, message?: string): NumberSchema { return new NumberSchema(super.min(limit, message).read); }
  override max(limit: number, message?: string): NumberSchema { return new NumberSchema(super.max(limit, message).read); }
  int(): NumberSchema {
    return new NumberSchema((input, context) => {
      const result = this.read(input, context);
      if (result.usable && !Number.isInteger(result.value)) issue(context, "invalid_type", "Expected integer");
      return result;
    });
  }
}

function isDateTime(value: string, offset: boolean): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.exec(value);
  if (!parts || (!offset && parts[7] !== "Z")) return false;
  const [, year, month, day, hour, minute, second, zone] = parts;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1] || Number(hour) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59) return false;
  if (zone !== "Z") {
    const digits = zone.slice(1).replace(":", "");
    if (Number(digits.slice(0, 2)) > 23 || Number(digits.slice(2)) > 59) return false;
  }
  return true;
}

type Shape = Record<string, Schema<any>>;
type OptionalKeys<S extends Shape> = { [K in keyof S]: undefined extends Output<S[K]> ? K : never }[keyof S];
type ObjectOutput<S extends Shape> = { [K in Exclude<keyof S, OptionalKeys<S>>]: Output<S[K]> }
  & { [K in OptionalKeys<S>]?: Output<S[K]> };
type OptionalInputKeys<S extends Shape> = { [K in keyof S]: undefined extends Input<S[K]> ? K : never }[keyof S];
type ObjectInput<S extends Shape> = { [K in Exclude<keyof S, OptionalInputKeys<S>>]: Input<S[K]> }
  & { [K in OptionalInputKeys<S>]?: Input<S[K]> };

class ObjectSchema<S extends Shape> extends Schema<ObjectOutput<S>, ObjectInput<S>> {
  constructor(readonly shape: S, private readonly strictKeys = false) {
    super((input, context) => {
      if (!isObject(input)) return invalid(context, "object", input);
      return container(input, context, () => {
        const value: Record<string, unknown> = {};
        let usable = true;
        for (const [key, schema] of Object.entries(shape)) {
          const present = Object.hasOwn(input, key);
          const result = schema.read(present ? input[key] : undefined, child(context, key));
          usable = usable && result.usable;
          if (present || result.value !== undefined) setOwn(value, key, result.value);
        }
        if (strictKeys) {
          const extras = Object.keys(input).filter((key) => !Object.hasOwn(shape, key));
          if (extras.length) issue(context, "unrecognized_keys", `Unrecognized key(s) in object: ${extras.map((key) => JSON.stringify(key)).join(", ")}`);
        }
        return { value: value as ObjectOutput<S>, usable };
      });
    });
  }
  strict(): ObjectSchema<S> { return new ObjectSchema(this.shape, true); }
  omit<const K extends keyof S>(keys: Record<K, true>): ObjectSchema<Omit<S, K>> {
    const shape: Record<string, Schema<any>> = {};
    for (const [key, schema] of Object.entries(this.shape)) {
      if (!Object.hasOwn(keys, key)) setOwn(shape, key, schema);
    }
    return new ObjectSchema(shape as Omit<S, K>, this.strictKeys);
  }
}

export function string(): StringSchema {
  return new StringSchema((input, context) => typeof input === "string" ? { value: input, usable: true } : invalid(context, "string", input));
}
export function number(): NumberSchema {
  return new NumberSchema((input, context) => typeof input === "number" && Number.isFinite(input)
    ? { value: input, usable: true } : invalid(context, "finite number", input));
}
export function boolean(): Schema<boolean> {
  return new Schema((input, context) => typeof input === "boolean" ? { value: input, usable: true } : invalid(context, "boolean", input));
}
export function literal<const T extends string | number | boolean | null>(expected: T): Schema<T> {
  return new Schema((input, context) => {
    if (input === expected) return { value: expected, usable: true };
    issue(context, "invalid_literal", `Invalid literal value, expected ${JSON.stringify(expected)}`);
    return { value: undefined as unknown as T, usable: false };
  });
}
class EnumSchema<T extends readonly [string, ...string[]]> extends Schema<T[number]> {
  constructor(readonly options: T) {
    super((input, context) => {
      if (typeof input !== "string") return invalid(context, "string", input);
      if (options.includes(input)) return { value: input, usable: true };
      issue(context, "invalid_enum_value", `Invalid enum value. Expected ${options.join(" | ")}`);
      return { value: undefined as unknown as T[number], usable: false };
    });
  }
}
function enumeration<const T extends readonly [string, ...string[]]>(values: T): EnumSchema<T> { return new EnumSchema(values); }
export { enumeration as enum };
export function object<S extends Shape>(shape: S): ObjectSchema<S> { return new ObjectSchema(shape); }
export function array<S extends Schema<any>>(schema: S): BoundedSchema<Output<S>[], Input<S>[]> {
  return new BoundedSchema((input, context) => {
    if (!Array.isArray(input)) return invalid(context, "array", input);
    return container(input, context, () => {
      const value: Output<S>[] = [];
      let usable = true;
      // Read sparse positions too: a hole is not a valid required value.
      for (let i = 0; i < input.length; i++) {
        const result = schema.read(Object.hasOwn(input, i) ? input[i] : undefined, child(context, i));
        value.push(result.value);
        usable = usable && result.usable;
      }
      return { value, usable };
    });
  });
}
export function record<S extends Schema<any>>(keySchema: Schema<string>, valueSchema: S): Schema<Record<string, Output<S>>> {
  return new Schema((input, context) => {
    if (!isObject(input)) return invalid(context, "object", input);
    return container(input, context, () => {
      const value: Record<string, Output<S>> = {};
      let usable = true;
      for (const key of Object.keys(input)) {
        const fieldContext = child(context, key);
        const parsedKey = keySchema.read(key, fieldContext);
        const result = valueSchema.read(input[key], fieldContext);
        usable = usable && parsedKey.usable && result.usable;
        if (parsedKey.usable) setOwn(value, parsedKey.value, result.value);
      }
      return { value, usable };
    });
  });
}
export function union<const S extends readonly Schema<any>[]>(schemas: S): Schema<Output<S[number]>> {
  return new Schema((input, context) => {
    let rejected: { result: Result<Output<S[number]>>; issues: ValidationIssue[] } | undefined;
    for (const schema of schemas) {
      const branch: Context = { ...context, issues: [] };
      const result = schema.read(input, branch);
      if (result.usable && branch.issues.length === 0) return result;
      if (result.usable && !rejected) rejected = { result, issues: branch.issues };
    }
    if (rejected) { context.issues.push(...rejected.issues); return rejected.result; }
    issue(context, "invalid_union", "Invalid input: no union option matched");
    return { value: undefined, usable: false };
  });
}
export function discriminatedUnion<const S extends readonly ObjectSchema<Shape>[]>(key: string, schemas: S): Schema<Output<S[number]>> {
  return new Schema<Output<S[number]>>((input, context) => {
    if (!isObject(input)) return invalid(context, "object", input);
    if (Object.hasOwn(input, key)) {
      for (const schema of schemas) {
        if (schema.shape[key].safeParse(input[key]).success) return schema.read(input, context) as Result<Output<S[number]>>;
      }
    }
    issue(child(context, key), "invalid_union_discriminator", `Invalid ${key}: no declared option matched`);
    return { value: undefined as unknown as Output<S[number]>, usable: false };
  });
}
export function lazy<T>(getSchema: () => Schema<T>): Schema<T> {
  return new Schema((input, context) => getSchema().read(input, context));
}
export function preprocess<S extends Schema<any>>(prepare: (input: unknown) => unknown, schema: S): Schema<Output<S>> {
  return new Schema((input, context) => schema.read(prepare(input), context));
}
function nullValue(): Schema<null> { return literal(null); }
function unknownValue(): Schema<unknown> { return new Schema((input) => ({ value: input, usable: true })); }
function anyValue(): Schema<any> { return unknownValue(); }
export { nullValue as null, unknownValue as unknown, anyValue as any };
