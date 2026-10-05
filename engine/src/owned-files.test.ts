import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OwnedFileSchema } from "./owned-files.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC_SCHEMAS = [
  "docs/contracts/groundwork.build-request.v1.schema.json",
  "docs/contracts/groundwork.spec-v3-extension.schema.json",
];
const SAFE = ["Sources/Plan.swift", "Sources/Plan%20View.swift", "Sources/Pl%61n.swift", "config/.env.example"];
const UNSAFE = [
  "Sources/%2e%2e/Secret.swift",
  "Sources/%00Secret.swift",
  "Sources/%zzSecret.swift",
  "Sources/%FF.swift",
  "Sources/%73ecrets/key.swift",
  "Sources/%2eSSH/key",
  "Sources/.SSH/key",
  "Sources/.env.production",
  "Sources/Credentials.json",
  "Sources/id_ED25519",
];

test("runtime and public ownership schemas share safe and hostile path vectors", () => {
  const validators = PUBLIC_SCHEMAS.map((relative) => {
    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));
    assert.equal(schema.$defs.ownedFile.format, "groundwork-owned-file");
    const pattern = new RegExp(schema.$defs.ownedFile.pattern);
    return { pattern, validate: (value: string) => pattern.test(value) && OwnedFileSchema.safeParse(value).success };
  });
  for (const value of SAFE) {
    assert.equal(OwnedFileSchema.safeParse(value).success, true, `runtime should accept ${value}`);
    validators.forEach(({ validate }) => assert.equal(validate(value), true, `public schema should accept ${value}`));
  }
  for (const value of UNSAFE) {
    assert.equal(OwnedFileSchema.safeParse(value).success, false, `runtime should reject ${value}`);
    validators.forEach(({ validate }) => assert.equal(validate(value), false, `public schema should reject ${value}`));
  }
  assert.equal(validators.every(({ pattern }) => pattern.test("Sources/%FF.swift")), true, "the custom format must run; pattern-only validation is insufficient");
});
