import test from "node:test";
import assert from "node:assert/strict";
import {
  PlatformSchema,
  PlatformSurfacesSchema,
  PlatformTopologySchema,
  deriveLegacyPlatformTarget,
  interpretLegacyPlatformChoice,
  replacePrimarySurface,
  type PlatformSurface,
} from "./platform-topology.js";

function spectraSurfaces(): PlatformSurface[] {
  return [
    {
      id: "surface-macos",
      platform: "macos",
      role: "primary",
      name: "Spectra Studio",
      interactionModes: ["pointer", "keyboard"],
      featureIds: ["feature-editor"],
      provenance: "observed",
    },
    {
      id: "surface-web",
      platform: "web",
      role: "companion",
      name: "Spectra Review",
      interactionModes: ["pointer", "touch"],
      featureIds: ["feature-review"],
      provenance: "observed",
    },
  ];
}

test("macOS primary plus web companion validates and projects only the primary", () => {
  const platformSurfaces = spectraSurfaces();
  const topology = PlatformTopologySchema.parse({
    platformTarget: "macos",
    platformSurfaces,
  });

  assert.equal(deriveLegacyPlatformTarget(topology.platformSurfaces), "macos");
  assert.equal(topology.platformSurfaces[1].role, "companion");
  assert.notEqual(deriveLegacyPlatformTarget(topology.platformSurfaces), "web");
});

test("platformTarget must match the primary surface", () => {
  assert.throws(
    () => PlatformTopologySchema.parse({
      platformTarget: "web",
      platformSurfaces: spectraSurfaces(),
    }),
    /platformTarget must match primary platform macos/,
  );
});

test("zero or multiple primaries are rejected", () => {
  const zeroPrimary = spectraSurfaces().map((surface) => ({
    ...surface,
    role: "companion" as const,
  }));
  const multiplePrimaries = spectraSurfaces().map((surface) => ({
    ...surface,
    role: "primary" as const,
  }));

  assert.throws(
    () => PlatformSurfacesSchema.parse(zeroPrimary),
    /exactly one primary surface; received 0/,
  );
  assert.throws(
    () => PlatformSurfacesSchema.parse(multiplePrimaries),
    /exactly one primary surface; received 2/,
  );
});

test("duplicate surface ids and duplicate surface data reject", () => {
  const duplicateIds = spectraSurfaces();
  duplicateIds[1] = { ...duplicateIds[1], id: duplicateIds[0].id };
  assert.throws(
    () => PlatformSurfacesSchema.parse(duplicateIds),
    /Duplicate platform surface id: surface-macos/,
  );

  const duplicateModes = spectraSurfaces();
  duplicateModes[0] = {
    ...duplicateModes[0],
    interactionModes: ["pointer", "pointer"],
  };
  assert.throws(
    () => PlatformSurfacesSchema.parse(duplicateModes),
    /Duplicate interactionModes value: pointer/,
  );

  const duplicateFeatures = spectraSurfaces();
  duplicateFeatures[0] = {
    ...duplicateFeatures[0],
    featureIds: ["feature-editor", "feature-editor"],
  };
  assert.throws(
    () => PlatformSurfacesSchema.parse(duplicateFeatures),
    /Duplicate featureIds value: feature-editor/,
  );
});

test("primary replacement preserves every non-primary surface and does not mutate input", () => {
  const original: PlatformSurface[] = [
    ...spectraSurfaces(),
    {
      id: "surface-admin",
      platform: "web",
      role: "admin",
      name: "Spectra Admin",
      interactionModes: ["pointer"],
      featureIds: ["feature-admin"],
      provenance: "observed",
    },
    {
      id: "surface-extension",
      platform: "claude-plugin",
      role: "extension",
      name: "Spectra Assistant",
      interactionModes: ["text"],
      featureIds: ["feature-assistant"],
      provenance: "observed",
    },
    {
      id: "surface-service",
      platform: "api",
      role: "service",
      name: "Spectra API",
      interactionModes: ["request-response"],
      featureIds: ["feature-api"],
      provenance: "observed",
    },
  ];
  const before = structuredClone(original);
  const replacement: PlatformSurface = {
    id: "surface-ios",
    platform: "ios",
    role: "primary",
    name: "Spectra Mobile",
    interactionModes: ["touch"],
    featureIds: ["feature-editor"],
    provenance: "decided",
  };

  const revised = replacePrimarySurface(original, replacement);

  assert.deepEqual(original, before);
  assert.deepEqual(revised[0], replacement);
  assert.deepEqual(revised.slice(1), before.slice(1));
  assert.equal(deriveLegacyPlatformTarget(revised), "ios");
  assert.deepEqual(replacePrimarySurface(original, replacement), revised);
});

test("primary replacement rejects a non-primary replacement or a duplicate companion id", () => {
  const surfaces = spectraSurfaces();
  assert.throws(
    () => replacePrimarySurface(surfaces, {
      ...surfaces[0],
      role: "companion",
    }),
    /must have role primary/,
  );
  assert.throws(
    () => replacePrimarySurface(surfaces, {
      ...surfaces[0],
      id: surfaces[1].id,
    }),
    /Duplicate platform surface id: surface-web/,
  );
});

test("the v2 platform enum remains an identity-compatible subset of v3", () => {
  const legacyTargets = [
    "web",
    "vite-spa",
    "ios",
    "macos",
    "claude-plugin",
    "agent-system",
  ] as const;

  for (const target of legacyTargets) {
    assert.equal(PlatformSchema.parse(target), target);
  }
});

test("platform-multi remains an explicit equal-peer legacy choice", () => {
  assert.deepEqual(
    interpretLegacyPlatformChoice("platform-multi"),
    { kind: "equal-peers", choice: "platform-multi" },
  );
  assert.deepEqual(
    interpretLegacyPlatformChoice("platform-macos"),
    { kind: "primary", platform: "macos" },
  );
  assert.equal(deriveLegacyPlatformTarget(spectraSurfaces()), "macos");
  assert.equal(PlatformSchema.safeParse("platform-multi").success, false);
});
