# Engine contract validation

`engine/src/validation.ts` owns Groundwork's synchronous contract validation.
The engine has no third-party runtime libraries. TypeScript, tsx, and esbuild
are development tools. The validator was written for Groundwork; it does not
vendor a library implementation or promise compatibility with a general-purpose
validation package.

Schema declarations remain in the domain modules. `Infer<typeof Schema>` gives
the parsed output type, including defaulted fields and discriminated branches.
`parse(input)` returns that output or throws `ValidationError`.
`safeParse(input)` returns `{ success: true, data }` or
`{ success: false, error }`. Each error issue has a code, message, and a path
of field names and array indices. The CLI prints those paths before exiting.

The module supports the engine's strings, finite numbers, booleans, literals,
enums, arrays, objects, typed records, unions, discriminated unions, recursive
JSON values, optional fields, defaults, preprocessing, and refinements.
Strings support bounds, regular expressions, URLs, and timezone-bearing ISO
dates. Objects expose their shape; enums expose their options; object omission
preserves the strict-key policy. Bounds and integer checks do not coerce values.

Objects strip undeclared fields unless the schema is strict. Strict objects
reject undeclared keys. Declared fields appear in schema order, preserving
canonical packet bytes. Defaults are parsed through their schema to create
fresh objects and arrays. An absent optional key stays absent; a supplied
undefined key stays supplied. Null does not trigger a default.

Refinements receive structurally valid values, including values rejected by a
bound. A wrong child type prevents the enclosing refinement from running.
Refinement issue paths append to the enclosing field's path. Union branches
keep errors local until the matching branch is selected.

Object and record input must have an ordinary or null prototype. Required fields
cannot be supplied by inheritance. Prototype-like record keys remain own data
properties and cannot modify the output prototype. Recursive containers reject
cycles while allowing repeated noncyclic values. `unknown` and `any` explicitly
pass their values through, as required by observation and working-memory fields.
Non-finite numbers and out-of-range timezone offsets are rejected.

`validation.test.ts` exercises these boundaries and checks inferred types.
`release-stage.test.ts` verifies that the committed bundle matches its source,
contains only owned modules and Node built-ins, and has no runtime dependencies.
Run the complete gate with `npm test` before publishing a schema change.
