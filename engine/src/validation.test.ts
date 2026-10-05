import assert from "node:assert/strict";
import test from "node:test";
import * as v from "./validation.js";
import { JsonValueSchema, TradeoffWeightsSchema } from "./spec.js";
import { ObservationSourceRefSchema } from "./observations.js";

test("validation collects nested paths and exposes one owned error type", () => {
  const schema = v.object({ items: v.array(v.object({ name: v.string(), count: v.number().int().min(1) }).strict()) });
  const result = schema.safeParse({ items: [{ name: 3, count: 0, extra: true }, { count: 1.5 }] });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.error instanceof v.ValidationError);
  assert.deepEqual(result.error.issues.map((issue) => issue.path), [
    ["items", 0, "name"], ["items", 0, "count"], ["items", 0], ["items", 1, "name"], ["items", 1, "count"],
  ]);
  assert.throws(() => schema.parse({}), v.ValidationError);
});

test("defaults yield fresh parsed objects while optional absent keys stay absent", () => {
  const schema = v.object({
    nested: v.object({ tags: v.array(v.string()).default([]) }).default({}),
    optional: v.string().optional(),
    enabled: v.boolean().default(false),
  });
  const first = schema.parse({}), second = schema.parse({});
  assert.equal(JSON.stringify(first), '{"nested":{"tags":[]},"enabled":false}');
  first.nested.tags.push("change");
  assert.deepEqual(second.nested.tags, []);
  assert.equal(Object.hasOwn(schema.parse({ optional: undefined }), "optional"), true);
  assert.equal(schema.safeParse({ enabled: null }).success, false);
});

test("strict keys reject extras and normal objects strip extras in schema order", () => {
  const schema = v.object({ second: v.number(), first: v.string() });
  assert.equal(JSON.stringify(schema.parse({ first: "x", extra: 1, second: 2 })), '{"second":2,"first":"x"}');
  assert.equal(schema.strict().safeParse({ first: "x", second: 2, extra: 1 }).success, false);
  const omitted = schema.strict().omit({ second: true });
  assert.deepEqual(omitted.parse({ first: "x" }), { first: "x" });
  assert.equal(omitted.safeParse({ first: "x", second: 2 }).success, false);
  assert.equal(schema.safeParse({ first: "x" }).success, false, "omit must not mutate the original");
});

test("prototype names remain data and cannot satisfy required fields by inheritance", () => {
  const input = JSON.parse('{"__proto__":{"polluted":true},"constructor":"x","toString":"y"}');
  const result = v.record(v.string(), v.unknown()).parse(input);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, "__proto__"), true);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), input);
  assert.equal(v.object({ toString: v.string() }).safeParse({}).success, false);
  assert.equal(v.object({ id: v.string() }).safeParse(Object.create({ id: "inherited" })).success, false);
  assert.equal(v.object({ id: v.string() }).safeParse(new Date()).success, false);
});

test("records validate both keys and values and preserve nested issue paths", () => {
  const schema = v.record(v.string().regex(/^key/), v.array(v.number().int()));
  const result = schema.safeParse({ bad: [1.5], keyOk: ["x"] });
  assert.equal(result.success, false);
  if (!result.success) assert.deepEqual(result.error.issues.map((issue) => issue.path), [["bad"], ["bad", 0], ["keyOk", 0]]);
});

test("arrays reject sparse required positions and cyclic JSON rejects without overflowing", () => {
  assert.equal(v.array(v.string()).safeParse(new Array(2)).success, false);
  const cycle: unknown[] = []; cycle.push(cycle);
  assert.equal(JsonValueSchema.safeParse(cycle).success, false);
  const shared = { key: [1, true, null] };
  assert.deepEqual(JsonValueSchema.parse([shared, shared]), [shared, shared], "shared noncyclic values remain legal");
});

test("numbers reject coercion, NaN and infinities at the JSON boundary", () => {
  for (const value of ["2", NaN, Infinity, -Infinity, null]) assert.equal(v.number().safeParse(value).success, false);
  assert.equal(v.number().int().min(1).max(3).safeParse(1.5).success, false);
  assert.equal(v.number().int().min(1).max(3).safeParse(4).success, false);
  assert.equal(v.number().int().min(1).max(3).parse(2), 2);
});

test("string bounds, regex and URLs are stable across repeated validation", () => {
  const schema = v.string().min(2).max(3).regex(/^ab/g);
  assert.equal(schema.safeParse("ab").success, true);
  assert.equal(schema.safeParse("ab").success, true);
  for (const value of ["a", "abcd", "xx", 2]) assert.equal(schema.safeParse(value).success, false);
  assert.equal(v.string().url().safeParse("https://example.com").success, true);
  assert.equal(v.string().url().safeParse("relative/path").success, false);
  const custom = v.array(v.string()).min(1, "At least one step is required").safeParse([]);
  if (!custom.success) assert.equal(custom.error.issues[0].message, "At least one step is required");
});

test("datetime verifies calendar days, clock ranges and explicit timezone", () => {
  const schema = v.string().datetime({ offset: true });
  for (const value of ["2024-02-29T12:30:59.001Z", "2026-10-04T12:30+07:00", "2026-10-04T12:30:00-0700"]) {
    assert.equal(schema.safeParse(value).success, true, value);
  }
  for (const value of ["2025-02-29T12:30:00Z", "2026-04-31T12:30:00Z", "2026-10-04T24:00:00Z", "2026-10-04T12:60:00Z", "2026-10-04T12:30:00", "2026-10-04T12:30:00+25:00"]) {
    assert.equal(schema.safeParse(value).success, false, value);
  }
  assert.equal(v.string().datetime().safeParse("2026-10-04T12:30:00+07:00").success, false);
});

test("union discards rejected branches and keeps the structurally matching refinement", () => {
  const schema = v.union([v.string().min(3), v.number().min(1)]);
  assert.equal(schema.parse(3), 3);
  const result = schema.safeParse(0);
  assert.equal(result.success, false);
  if (!result.success) assert.equal(result.error.issues[0].code, "too_small");
  assert.equal(schema.safeParse(null).success, false);
});

test("discriminator selects one branch without stripping its strict-key guard", () => {
  assert.deepEqual(ObservationSourceRefSchema.parse({ kind: "repo", path: "src/app.ts" }), { kind: "repo", path: "src/app.ts" });
  assert.equal(ObservationSourceRefSchema.safeParse({ kind: "repo", id: "agent" }).success, false);
  assert.equal(ObservationSourceRefSchema.safeParse({ kind: "agent", id: "agent", path: "src/app.ts" }).success, false);
  const unknown = ObservationSourceRefSchema.safeParse({ kind: "other" });
  if (!unknown.success) assert.deepEqual(unknown.error.issues[0].path, ["kind"]);
});

test("refinements never receive invalid child types and retain relative paths", () => {
  let calls = 0;
  const schema = v.object({ rows: v.array(v.string().min(1)) }).superRefine((value, context) => {
    calls++;
    if (value.rows.length < 2) context.addIssue({ code: "custom", path: ["rows"], message: "Two rows required" });
  });
  assert.equal(schema.safeParse({ rows: [3] }).success, false);
  assert.equal(calls, 0);
  const result = v.object({ data: schema }).safeParse({ data: { rows: [""] } });
  assert.equal(calls, 1, "bounds failures keep the declared type for refinements");
  if (!result.success) assert.deepEqual(result.error.issues.map((issue) => issue.path), [["data", "rows", 0], ["data", "rows"]]);
  const tradeoff = TradeoffWeightsSchema.safeParse({ speed_to_alpha: 1, scalability: 1, ux_polish: 1, maintainability: 1, cost: 1, security: 1, unacceptable_tradeoff: "cost" });
  if (!tradeoff.success) assert.deepEqual(tradeoff.error.issues[0].path, ["__sum"]);
});

test("preprocessing applies before parsing without mutating authored data", () => {
  const schema = v.preprocess((input) => ({ ...(input as object), version: 2 }), v.object({ version: v.literal(2), title: v.string() }));
  const input = { title: "Example" };
  assert.deepEqual(schema.parse(input), { version: 2, title: "Example" });
  assert.deepEqual(input, { title: "Example" });
});

// Compile-time contracts: typed defaults, optional keys and discriminated branches.
const TypedSchema = v.object({ count: v.number().default(0), note: v.string().optional() });
type Typed = v.Infer<typeof TypedSchema>;
const typed: Typed = { count: 1 };
void typed;
// @ts-expect-error defaulted outputs must include count
const missing: Typed = {};
// @ts-expect-error number output must not widen to any
const wrong: Typed = { count: "one" };
void missing; void wrong;
function checkBranch(value: v.Infer<typeof ObservationSourceRefSchema>) {
  if (value.kind === "repo") {
    const path: string = value.path;
    // @ts-expect-error discriminator narrows away the agent field
    void value.id;
    return path;
  }
}
void checkBranch;
