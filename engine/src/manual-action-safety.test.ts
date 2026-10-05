import test from "node:test";
import assert from "node:assert/strict";
import {
  APIContractSchema,
  DataModelEntitySchema,
  ExternalManualActionSchema,
  IntegrationSchema,
  TestSchema,
  type Spec,
} from "./spec.js";
import { projectManualActions } from "./build-artifacts.js";

const VALID_ACTION = {
  id: "manual-action-stripe-key",
  surface: "Stripe dashboard",
  action: "Create a restricted API key and copy it into the named environment variable.",
  requiredValue: "STRIPE_SECRET_KEY",
  appDestination: "App deployment settings > Environment Variables",
  verification: "Run the provider connection check and confirm it succeeds.",
};

test("external manual actions require a value or permission name and explicit app destination", () => {
  assert.equal(ExternalManualActionSchema.safeParse(VALID_ACTION).success, true);
  assert.equal(ExternalManualActionSchema.safeParse({
    ...VALID_ACTION,
    requiredValue: "HealthKit workout read permission",
  }).success, true, "permission names remain valid even when they describe protected access");

  const withoutRequiredValue = { ...VALID_ACTION } as Record<string, unknown>;
  delete withoutRequiredValue.requiredValue;
  assert.equal(ExternalManualActionSchema.safeParse(withoutRequiredValue).success, false);

  const withoutDestination = { ...VALID_ACTION } as Record<string, unknown>;
  delete withoutDestination.appDestination;
  assert.equal(ExternalManualActionSchema.safeParse(withoutDestination).success, false);
});

test("schema validation rejects secret-shaped and credential-bearing manual-action content", () => {
  const unsafeValues = [
    { field: "requiredValue", value: "sk_live_1234567890abcdefghijkl" },
    { field: "requiredValue", value: "API_KEY=sk-1234567890abcdefghijkl" },
    { field: "action", value: "Open https://user:password@example.com/settings" },
    { field: "appDestination", value: "https://example.com/settings?access_token=actual-value" },
    { field: "verification", value: "Authorization: Bearer eyJabcdefghij.abcdefghij.abcdefghij" },
    { field: "verification", value: "-----BEGIN PRIVATE KEY-----" },
  ] as const;

  for (const { field, value } of unsafeValues) {
    const parsed = ExternalManualActionSchema.safeParse({ ...VALID_ACTION, [field]: value });
    assert.equal(parsed.success, false, `${field} accepted unsafe content: ${value}`);
    if (!parsed.success) {
      assert.ok(parsed.error.issues.some((issue) => issue.path[0] === field));
    }
  }
});

test("architecture-owned files must remain repository-relative and traversal-free", () => {
  const cases = [
    {
      schema: DataModelEntitySchema,
      value: { id: "entity-summary", name: "Summary", ownedFiles: ["../outside.sql"] },
    },
    {
      schema: IntegrationSchema,
      value: {
        id: "integration-cloudflare",
        name: "Cloudflare",
        purpose: "Persist encrypted summaries.",
        ownedFiles: ["/tmp/wrangler.toml"],
        verification: ["Run the integration smoke test."],
      },
    },
    {
      schema: APIContractSchema,
      value: { id: "api-summary", method: "POST", path: "/v1/summaries", ownedFiles: ["api/../../outside.ts"] },
    },
    {
      schema: TestSchema,
      value: { id: "test-summary", description: "Verify summary publication.", ownedFiles: ["~/private-test.ts"] },
    },
  ];

  for (const { schema, value } of cases) {
    assert.equal(schema.safeParse(value).success, false, `${value.id} accepted an unsafe owned file`);
  }
});

test("publication emits names and explicit destinations, and revalidates bypassed Spec objects", () => {
  const spec = {
    integrations: [{
      id: "integration-stripe",
      externalManualActions: [VALID_ACTION],
    }],
  } as unknown as Spec;

  assert.deepEqual(projectManualActions(spec), [{
    id: VALID_ACTION.id,
    location: VALID_ACTION.surface,
    action: VALID_ACTION.action,
    requiredValueName: VALID_ACTION.requiredValue,
    destination: VALID_ACTION.appDestination,
    verification: VALID_ACTION.verification,
  }]);

  const unsafeSpec = {
    integrations: [{
      id: "integration-stripe",
      externalManualActions: [{
        ...VALID_ACTION,
        requiredValue: "sk_live_1234567890abcdefghijkl",
      }],
    }],
  } as unknown as Spec;
  assert.throws(
    () => projectManualActions(unsafeSpec),
    /must not contain actual secrets/,
  );
});
