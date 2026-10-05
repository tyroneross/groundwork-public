import * as v from "./validation.js";

const TopologyIdSchema = v
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const PlatformSchema = v.enum([
  "web",
  "vite-spa",
  "ios",
  "macos",
  "watchos",
  "tvos",
  "visionos",
  "android",
  "claude-plugin",
  "agent-system",
  "api",
  "service",
  "other",
]);

export const PlatformSurfaceRoleSchema = v.enum([
  "primary",
  "companion",
  "admin",
  "extension",
  "service",
]);

export const PlatformSurfaceProvenanceSchema = v.enum([
  "observed",
  "decided",
  "assumed",
  "derived",
]);

function addDuplicateStringIssues(
  values: string[],
  ctx: v.RefinementContext,
  field: "interactionModes" | "featureIds",
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: "custom",
        path: [field, index],
        message: `Duplicate ${field} value: ${value}`,
      });
    }
    seen.add(value);
  });
}

export const PlatformSurfaceSchema = v
  .object({
    id: TopologyIdSchema,
    platform: PlatformSchema,
    role: PlatformSurfaceRoleSchema,
    name: v.string().min(1),
    interactionModes: v.array(v.string().min(1)),
    featureIds: v.array(TopologyIdSchema),
    provenance: PlatformSurfaceProvenanceSchema.optional(),
  })
  .strict()
  .superRefine((surface, ctx) => {
    addDuplicateStringIssues(surface.interactionModes, ctx, "interactionModes");
    addDuplicateStringIssues(surface.featureIds, ctx, "featureIds");
  });

export const PlatformSurfacesSchema = v
  .array(PlatformSurfaceSchema)
  .min(1)
  .superRefine((surfaces, ctx) => {
    const seenIds = new Set<string>();
    let primaryCount = 0;

    surfaces.forEach((surface, index) => {
      if (surface.role === "primary") primaryCount += 1;
      if (seenIds.has(surface.id)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "id"],
          message: `Duplicate platform surface id: ${surface.id}`,
        });
      }
      seenIds.add(surface.id);
    });

    if (primaryCount !== 1) {
      ctx.addIssue({
        code: "custom",
        message: `Platform topology must contain exactly one primary surface; received ${primaryCount}.`,
      });
    }
  });

/** The canonical v3 compatibility view of a product's platform topology. */
export const PlatformTopologySchema = v
  .object({
    platformTarget: PlatformSchema,
    platformSurfaces: PlatformSurfacesSchema,
  })
  .strict()
  .superRefine((topology, ctx) => {
    const primary = topology.platformSurfaces.find((surface) => surface.role === "primary");
    if (primary && topology.platformTarget !== primary.platform) {
      ctx.addIssue({
        code: "custom",
        path: ["platformTarget"],
        message: `platformTarget must match primary platform ${primary.platform}.`,
      });
    }
  });

export type Platform = v.Infer<typeof PlatformSchema>;
export type PlatformSurfaceRole = v.Infer<typeof PlatformSurfaceRoleSchema>;
export type PlatformSurfaceProvenance = v.Infer<typeof PlatformSurfaceProvenanceSchema>;
export type PlatformSurface = v.Infer<typeof PlatformSurfaceSchema>;
export type PlatformSurfaces = v.Infer<typeof PlatformSurfacesSchema>;
export type PlatformTopology = v.Infer<typeof PlatformTopologySchema>;

/**
 * Project a full topology into the one-value compatibility field used by v2
 * renderers. Companion surfaces never change this projection.
 */
export function deriveLegacyPlatformTarget(surfaces: readonly PlatformSurface[]): Platform {
  const parsed = PlatformSurfacesSchema.parse(surfaces);
  return parsed.find((surface) => surface.role === "primary")!.platform;
}

/**
 * Replace the primary at its existing position without mutating the input or
 * changing any companion, admin, extension, or service surface.
 */
export function replacePrimarySurface(
  surfaces: readonly PlatformSurface[],
  replacement: PlatformSurface,
): PlatformSurfaces {
  const parsedSurfaces = PlatformSurfacesSchema.parse(surfaces);
  const parsedReplacement = PlatformSurfaceSchema.parse(replacement);
  if (parsedReplacement.role !== "primary") {
    throw new Error("Replacement platform surface must have role primary.");
  }

  return PlatformSurfacesSchema.parse(
    parsedSurfaces.map((surface) =>
      surface.role === "primary" ? parsedReplacement : surface,
    ),
  );
}

export const LegacyPlatformChoiceSchema = v.enum([
  "platform-web",
  "platform-ios",
  "platform-macos",
  "platform-multi",
]);

export type LegacyPlatformChoice = v.Infer<typeof LegacyPlatformChoiceSchema>;
export type LegacyPlatformChoiceIntent =
  | { kind: "primary"; platform: "web" | "ios" | "macos" }
  | { kind: "equal-peers"; choice: "platform-multi" };

/**
 * Interpret the legacy Designer card without treating equal peers as a single
 * canonical platform. A caller must handle that legacy case explicitly.
 */
export function interpretLegacyPlatformChoice(choice: unknown): LegacyPlatformChoiceIntent {
  const parsed = LegacyPlatformChoiceSchema.parse(choice);
  if (parsed === "platform-multi") {
    return { kind: "equal-peers", choice: parsed };
  }

  const platformByChoice = {
    "platform-web": "web",
    "platform-ios": "ios",
    "platform-macos": "macos",
  } as const;
  return { kind: "primary", platform: platformByChoice[parsed] };
}
