import test from "node:test";
import assert from "node:assert/strict";
import { canonicalSpecPacket, createBuildRequest } from "./build-artifacts.js";
import { deriveTasks, renderBuilderHandoff, renderTasks } from "./handoff.js";
import { compileTaskGraph } from "./graph.js";
import { renderDocs } from "./render.js";
import { SpecSchema, type Spec } from "./spec.js";
import { buildTraceability } from "./traceability.js";

const PRIVATE_REPO = "/Users/example/private/Pulse";

export function completeSpec(): Spec {
  return SpecSchema.parse({
    schemaVersion: 3,
    id: "spec-pulse",
    productName: "Pulse",
    productDescription: "An iOS health dashboard that imports HealthKit samples and presents a review summary.",
    platformTarget: "ios",
    platformSurfaces: [
      {
        id: "surface-ios",
        platform: "ios",
        role: "primary",
        name: "Pulse iOS",
        interactionModes: ["touch", "voiceover"],
        featureIds: ["feature-health-sync", "feature-health-review"],
        provenance: "decided",
      },
      {
        id: "surface-web",
        platform: "web",
        role: "companion",
        name: "Pulse Review",
        interactionModes: ["pointer", "keyboard"],
        featureIds: ["feature-web-review", "feature-account-deletion"],
        provenance: "decided",
      },
      {
        id: "surface-review-service",
        platform: "service",
        role: "service",
        name: "Pulse Review Service",
        interactionModes: ["https-json"],
        featureIds: ["feature-summary-service", "feature-account-deletion"],
        provenance: "decided",
      },
    ],
    designIntent: "design-app",
    personas: [
      {
        id: "persona-member",
        name: "Health-conscious member",
        jobs: ["Review recent activity after granting HealthKit access"],
      },
    ],
    scenarios: [
      {
        id: "scenario-first-sync",
        personaId: "persona-member",
        context: "The member opens Pulse before any HealthKit authorization exists.",
        goal: "Grant read access and see a trustworthy activity summary.",
        successSignal: "The dashboard shows the imported sample count and last synchronization time.",
      },
    ],
    needs: [
      {
        id: "need-health-review",
        title: "Review authorized health activity",
        description: "Members need a clear summary without exposing unrelated HealthKit data.",
        priority: "P0",
        source: "user-decision",
        ears: [
          {
            id: "acceptance-health-permission",
            ears: "WHEN HealthKit read permission is not determined, THE SYSTEM SHALL request only step-count and workout read access before starting synchronization.",
          },
        ],
      },
    ],
    features: [
      {
        id: "feature-health-sync",
        title: "HealthKit synchronization",
        surface: "tool",
        priority: "P0",
        needIds: ["need-health-review"],
        acceptanceCriteria: [
          "Denied or unavailable HealthKit access leaves the last valid summary intact and presents a retryable explanation.",
        ],
        ears: [
          {
            id: "acceptance-health-sync",
            ears: "WHEN authorization succeeds, THE SYSTEM SHALL import a versioned HealthSampleBatch and update the dashboard exactly once per synchronization command.",
          },
        ],
      },
      {
        id: "feature-health-review",
        title: "Health activity review",
        surface: "ui",
        priority: "P0",
        needIds: ["need-health-review"],
        acceptanceCriteria: [
          "The iOS primary and web companion render the same versioned summary without exposing raw HealthKit identifiers.",
        ],
      },
      {
        id: "feature-summary-service",
        title: "Encrypted redacted-summary service",
        surface: "api",
        priority: "P0",
        needIds: ["need-health-review"],
        acceptanceCriteria: [
          "The service accepts and returns only HealthSummaryV1, encrypts it at rest, and rejects unauthenticated or unsupported-version requests.",
        ],
      },
      {
        id: "feature-web-review",
        title: "Authenticated web companion review",
        surface: "ui",
        priority: "P0",
        needIds: ["need-health-review"],
        acceptanceCriteria: [
          "An authenticated member can review the latest redacted HealthSummaryV1; signed-out, empty, loading, stale, and service-failure states are explicit.",
        ],
      },
      {
        id: "feature-account-deletion",
        title: "Authenticated account deletion",
        surface: "ui",
        priority: "P0",
        needIds: ["need-health-review"],
        acceptanceCriteria: [
          "An authenticated member can deliberately delete the encrypted summary, request-control rows, and active web sessions for only their subject in one transaction; exact replay remains 204 and cross-subject data is unchanged.",
        ],
        ears: [
          {
            id: "acceptance-account-deletion",
            ears: "WHEN an authenticated member confirms account deletion, THE SYSTEM SHALL transactionally delete only that subject's summary, idempotency, rate-limit, and session state and return 204 for the original or repeated request.",
          },
        ],
      },
    ],
    uxFlows: [
      {
        id: "flow-health-review",
        name: "Authorize, synchronize, and review",
        steps: ["Request scoped access", "Import a batch", "Render the summary", "Retain the last valid summary on failure"],
        screenIds: ["screen-health-dashboard", "screen-web-review"],
      },
    ],
    screens: [
      {
        id: "screen-health-dashboard",
        name: "Health dashboard",
        purpose: "Authorize a scoped HealthKit import and review the resulting summary.",
        featureIds: ["feature-health-sync", "feature-health-review"],
        primaryAction: "Sync Health Data",
        states: ["signed-out", "authenticating", "permission-undetermined", "syncing", "summary", "publishing", "published", "permission-denied", "healthkit-unavailable", "sync-failed", "publish-unauthorized", "publish-rate-limited", "publish-failed"],
        elements: [
          {
            id: "element-sync-health",
            name: "Sync Health Data button",
            role: "primary action button",
            dataIn: {
              source: "fetched",
              expectedType: "HKAuthorizationStatus",
              note: "Current scoped HealthKit authorization state",
            },
            dataOut: {
              shows: "HealthKit synchronization command and inline status",
              expectedType: "HealthSyncCommand",
              note: "One command per explicit activation",
            },
          },
          {
            id: "element-health-summary",
            name: "Activity summary",
            role: "summary display",
            dataIn: {
              source: "computed",
              expectedType: "HealthSummaryViewModel",
              note: "Derived from the last valid HealthSampleBatch",
            },
          },
          {
            id: "element-ios-auth",
            name: "Sign in to publish button",
            role: "primary action button",
            dataIn: { source: "user-entry", expectedType: "Auth0NativePKCERequest" },
            dataOut: { shows: "Authenticated opaque member subject", expectedType: "NativeReviewSession" },
          },
          {
            id: "element-publish-summary",
            name: "Publish redacted summary button",
            role: "primary action button",
            dataIn: { source: "computed", expectedType: "AuthenticatedRequest<HealthSummaryV1>" },
            dataOut: { shows: "Published receipt or typed retry state", expectedType: "HealthSummaryReceiptV1 | TypedSummaryError" },
          },
        ],
        data: [
          { field: "authorizationStatus", source: "HKHealthStore" },
          { field: "summary", source: "entity-health-batch" },
          { field: "nativeReviewSession", source: "Auth0 ASWebAuthenticationSession + Keychain" },
          { field: "publishReceipt", source: "POST https://api.pulse.app/v1/health-summary" },
        ],
      },
      {
        id: "screen-web-review",
        name: "Web health review",
        purpose: "Authenticate the member and review the latest redacted summary from the companion service.",
        featureIds: ["feature-web-review", "feature-account-deletion"],
        primaryAction: "Sign in to review",
        states: ["signed-out", "authenticating", "loading", "summary", "empty", "stale", "unauthorized", "rate-limited", "service-failed", "deleting", "deleted", "delete-rate-limited", "delete-failed"],
        elements: [
          {
            id: "element-web-sign-in",
            name: "Sign in to review button",
            role: "primary action button",
            dataIn: { source: "user-entry", expectedType: "OIDCAuthorizationRequest" },
            dataOut: { shows: "Authenticated review session", expectedType: "ReviewSession" },
          },
          {
            id: "element-web-summary",
            name: "Redacted health summary",
            role: "summary display",
            dataIn: { source: "fetched", expectedType: "HealthSummaryV1" },
          },
          {
            id: "element-delete-account",
            name: "Delete account data button",
            role: "destructive action button",
            dataIn: { source: "user-entry", expectedType: "ConfirmedAccountDeletion" },
            dataOut: { shows: "Deleted confirmation or typed retry state", expectedType: "NoContent204 | TypedSummaryError" },
          },
        ],
        data: [
          { field: "reviewSession", source: "OIDC authorization-code-with-PKCE flow" },
          { field: "healthSummary", source: "same-origin GET https://review.pulse.app/api/health-summary BFF over private SUMMARY_SERVICE binding" },
          { field: "accountDeletion", source: "same-origin DELETE https://review.pulse.app/api/account BFF over private SUMMARY_SERVICE binding" },
        ],
      },
    ],
    dataPoints: [
      {
        id: "data-health-samples",
        name: "Authorized health samples",
        type: "HealthSampleBatch",
        description: "Versioned step-count and workout samples selected by the member.",
        pii: true,
        handlingNote: "Store on-device with file protection; never log raw samples or HealthKit identifiers; delete when access is revoked.",
      },
    ],
    dataModel: [
      {
        id: "entity-health-batch",
        name: "Health sample batch",
        description: "The last valid, versioned import used to derive the review summary.",
        fields: [
          { name: "schemaVersion", type: "UInt" },
          { name: "syncedAt", type: "Date" },
          { name: "stepCount", type: "Int" },
          { name: "workoutCount", type: "Int" },
        ],
        readByFeatureIds: ["feature-health-review"],
        writtenByFeatureIds: ["feature-health-sync"],
        elementRefs: ["screen-health-dashboard:element-sync-health", "screen-health-dashboard:element-health-summary"],
        ownedFiles: ["Sources/Models/HealthSampleBatch.swift", "Sources/Persistence/HealthSampleStore.swift"],
      },
      {
        id: "entity-redacted-summary",
        name: "Redacted review summary",
        description: "HealthSummaryV1 persisted by Pulse Review Service in its encrypted server store; it excludes raw samples and HealthKit identifiers and is retained until account deletion or 30 days after last sync. Replay receipts and rate-limit counters live in separate bounded tables.",
        fields: [
          { name: "schemaVersion", type: "1" },
          { name: "memberSubject", type: "opaque OIDC subject" },
          { name: "syncedAt", type: "ISO-8601 timestamp" },
          { name: "stepCount", type: "integer" },
          { name: "workoutCount", type: "integer" },
          { name: "summaryVersion", type: "opaque monotonic version" },
          { name: "storedAt", type: "ISO-8601 timestamp" },
          { name: "keyVersion", type: "positive integer" },
          { name: "wrappedDataKey", type: "AES-256-GCM-encrypted 256-bit DEK bytes" },
          { name: "wrapNonce", type: "96-bit random bytes" },
          { name: "wrapAuthenticationTag", type: "128-bit GCM tag" },
          { name: "ciphertext", type: "AES-256-GCM bytes" },
          { name: "dataNonce", type: "96-bit random bytes" },
          { name: "dataAuthenticationTag", type: "128-bit GCM tag" },
        ],
        readByFeatureIds: ["feature-web-review"],
        writtenByFeatureIds: ["feature-summary-service"],
        elementRefs: ["screen-web-review:element-web-summary"],
        ownedFiles: [
          "services/review/migrations/0001_health_summaries.sql",
          "services/review/src/persistence/health-summary-repository.ts",
          "services/review/src/crypto/summary-envelope.ts",
          "services/review/src/jobs/retention.ts",
          "services/review/src/routes/account-delete.ts",
        ],
      },
      {
        id: "entity-publication-control",
        name: "Publication idempotency and rate-limit control",
        description: "A bounded idempotency ledger preserves subject-plus-endpoint-plus-key publish receipts for 24 hours. Endpoint-scoped counters enforce 60 POST and 300 GET attempts per subject per 15 minutes plus 5 DELETE attempts per subject per 24 hours. Account deletion removes live controls in one transaction and retains only a session-hash-plus-key replay receipt through the original signed cookie's 8-hour absolute expiry.",
        fields: [
          { name: "subjectHash", type: "HMAC-SHA-256(PULSE_AUTH0_ISSUER + NUL + Auth0 subject)" },
          { name: "endpoint", type: "stable route identifier" },
          { name: "idempotencyKey", type: "UUID" },
          { name: "requestHash", type: "SHA-256 canonical request digest" },
          { name: "receiptJson", type: "HealthSummaryReceiptV1 JSON" },
          { name: "createdAt", type: "ISO-8601 timestamp" },
          { name: "expiresAt", type: "ISO-8601 timestamp" },
          { name: "windowStart", type: "route-specific UTC boundary" },
          { name: "requestCount", type: "integer bounded by endpoint quota" },
        ],
        readByFeatureIds: ["feature-summary-service"],
        writtenByFeatureIds: ["feature-summary-service"],
        ownedFiles: [
          "services/review/migrations/0002_request_controls.sql",
          "services/review/src/persistence/idempotency-repository.ts",
          "services/review/src/persistence/rate-limit-repository.ts",
        ],
      },
      {
        id: "entity-web-session",
        name: "Revocable web session",
        description: "The host-only cookie contains an opaque session identifier; D1 retains its HMAC hash, one-way subject hash, validated scope set, authorization version, CSRF hash, and bounded lifecycle metadata so authorization, expiry, logout, rotation, and account deletion are enforceable without storing browser tokens or a recoverable Auth0 subject.",
        fields: [
          { name: "sessionHash", type: "HMAC-SHA-256 opaque identifier" },
          { name: "subjectHash", type: "HMAC-SHA-256(PULSE_AUTH0_ISSUER + NUL + Auth0 subject)" },
          { name: "keyId", type: "session key identifier" },
          { name: "scopeSet", type: "validated sorted Auth0 scope names" },
          { name: "authorizationVersion", type: "positive integer" },
          { name: "csrfTokenHash", type: "HMAC-SHA-256 session-bound CSRF token" },
          { name: "issuedAt", type: "ISO-8601 timestamp" },
          { name: "lastSeenAt", type: "ISO-8601 timestamp" },
          { name: "absoluteExpiresAt", type: "ISO-8601 timestamp" },
          { name: "revokedAt", type: "nullable ISO-8601 timestamp" },
        ],
        readByFeatureIds: ["feature-web-review", "feature-account-deletion"],
        writtenByFeatureIds: ["feature-web-review", "feature-account-deletion"],
        ownedFiles: [
          "services/review/migrations/0003_web_sessions.sql",
          "apps/web/src/auth/session-repository.ts",
        ],
      },
      {
        id: "entity-delete-replay-tombstone",
        name: "Account-delete replay tombstone",
        description: "An 8-hour one-way tombstone, bounded by the session cookie's absolute validity, permits only the same still-valid signed session cookie plus identical deletion idempotency key to receive the prior 204 after the live session row is removed.",
        fields: [
          { name: "sessionHash", type: "HMAC-SHA-256 opaque session identifier" },
          { name: "endpoint", type: "/api/account" },
          { name: "idempotencyKeyHash", type: "HMAC-SHA-256 UUID" },
          { name: "subjectHash", type: "HMAC-SHA-256 opaque subject" },
          { name: "deletedAt", type: "ISO-8601 timestamp" },
          { name: "expiresAt", type: "ISO-8601 timestamp" },
          { name: "result", type: "fixed 204" },
        ],
        readByFeatureIds: ["feature-account-deletion"],
        writtenByFeatureIds: ["feature-account-deletion"],
        ownedFiles: [
          "services/review/migrations/0002_request_controls.sql",
          "services/review/src/persistence/deletion-receipt-repository.ts",
        ],
      },
    ],
    integrations: [
      {
        id: "integration-healthkit",
        name: "HealthKit",
        purpose: "Read member-authorized step-count and workout samples from HKHealthStore.",
        authMode: "HealthKit entitlement plus per-user HKHealthStore read authorization",
        featureIds: ["feature-health-sync"],
        ownedFiles: [
          "Pulse/Pulse.entitlements",
          "Pulse/Info.plist",
          "Pulse.xcodeproj/project.pbxproj",
          "Sources/Integrations/HealthKit.swift",
          "scripts/ios-preflight.mjs",
        ],
        requiredEnv: [],
        codeSetup: [
          "Add the HealthKit capability and NSHealthShareUsageDescription to the target configuration.",
          "Implement HKHealthStore authorization, scoped queries, unavailable handling, and a deterministic adapter seam.",
          "Implement scripts/ios-preflight.mjs to read xcrun simctl list devices available --json, prefer an already booted available iPhone or boot one by UDID, pass -destination id=<UDID> to xcodebuild, support --suite health-sync, auth0, and all, run the generic unsigned Release build/archive for --suite all, shut down only a simulator it booted, and fail with actionable Xcode-runtime guidance when none is available.",
        ],
        unclassifiedSetup: [],
        externalManualActions: [
          {
            id: "manual-healthkit-capability",
            surface: "Apple Developer portal > Certificates, Identifiers & Profiles > Identifiers > Pulse App ID > Capabilities",
            action: "Enable the HealthKit capability for the production App ID and regenerate the distribution provisioning profile.",
            requiredValue: "com.apple.developer.healthkit",
            appDestination: "Pulse/Pulse.entitlements key com.apple.developer.healthkit = true and the Pulse target Signing & Capabilities tab",
            verification: "Archive with distribution signing, then run codesign -d --entitlements :- on Pulse.app and confirm com.apple.developer.healthkit is true.",
          },
        ],
        verification: [
          "On a physical iPhone, grant only step-count and workout read access and confirm one HealthSampleBatch reaches the dashboard.",
          "Deny access and confirm the adapter returns the declared retryable denial without deleting the last valid summary.",
        ],
        docsUrl: "https://developer.apple.com/documentation/healthkit",
      },
      {
        id: "integration-review-oidc",
        name: "Pulse Auth0 applications",
        purpose: "Authenticate the same member in native iOS before summary publication and in the web companion before summary review.",
        authMode: "Auth0 OIDC authorization code with PKCE; iOS uses ASWebAuthenticationSession plus Keychain-backed tokens, while the review.pulse.app Worker owns the web callback, secure host-only session, and same-origin BFF",
        featureIds: ["feature-health-review", "feature-summary-service", "feature-web-review", "feature-account-deletion"],
        ownedFiles: [
          "Sources/Integrations/PulseAuth0.swift",
          "apps/web/src/auth/auth0.ts",
          "apps/web/src/auth/session.ts",
          "apps/web/src/auth/session-repository.ts",
          "apps/web/src/routes/auth-callback.ts",
          "apps/web/src/routes/health-summary-bff.ts",
          "services/review/src/auth/bearer-token.ts",
          "services/review/src/rpc/summary-service-entrypoint.ts",
        ],
        requiredEnv: ["PULSE_AUTH0_ISSUER", "PULSE_AUTH0_AUDIENCE", "PULSE_WEB_CLIENT_ID", "PULSE_WEB_CLIENT_SECRET", "PULSE_IOS_CLIENT_ID", "PULSE_SESSION_KEY_CURRENT", "PULSE_SESSION_KEY_PREVIOUS", "PULSE_SESSION_ACTIVE_KEY_ID", "PULSE_SUBJECT_HASH_KEY"],
        codeSetup: [
          "Implement iOS Auth0 PKCE with ASWebAuthenticationSession, callback com.pulse.app://auth/callback, Keychain token storage, refresh rotation, logout revocation, and bearer authorization for POST /v1/health-summary.",
          "Implement the review.pulse.app Worker as an Auth0 confidential Regular Web Application: handle /auth/callback on that host, exchange the code server-side, validate and sort the granted scopes, compute subject_hash once as HMAC-SHA-256(PULSE_AUTH0_ISSUER + NUL + Auth0 subject) with PULSE_SUBJECT_HASH_KEY, and create a D1 web_sessions row keyed by an HMAC of a random opaque session identifier with subject_hash, scopes_json, authorization_version, csrf_hash, and lifecycle timestamps. Issue an encrypted and signed __Host-pulse_session cookie containing only that opaque identifier with Secure, HttpOnly, SameSite=Lax, Path=/, 15-minute idle expiry, 8-hour absolute expiry, login rotation, D1-backed logout revocation, and no browser token storage.",
          "Terminate the host-only cookie only at review.pulse.app. After validating the D1 session and route scope, call env.SUMMARY_SERVICE.readSummary or deleteAccount on a Cloudflare WorkerEntrypoint RPC service binding with StoredSubjectHashV1; do not expose those methods through public fetch, HTTP headers, or a public route. The browser never sends its cookie or tokens to api.pulse.app.",
          "Validate signature, state, nonce, issuer https://pulse-prod.us.auth0.com/, audience https://api.pulse.app, subject, scopes, authorization version, and expiry at the relevant native, web, and service boundaries; public fetch accepts only the documented bearer POST and health route and cannot dispatch binding RPC methods.",
          "Implement an authenticated subject-to-summary ownership check on both summary endpoints.",
        ],
        unclassifiedSetup: [],
        externalManualActions: [
          {
            id: "manual-auth0-web-client",
            surface: "Auth0 Dashboard > Applications > Applications > Pulse Review Web > Settings",
            action: "Create a Regular Web Application, set Allowed Callback URLs to https://review.pulse.app/auth/callback, Allowed Logout URLs to https://review.pulse.app, and Allowed Web Origins to https://review.pulse.app.",
            requiredValue: "Pulse Review Web client identifier and client secret names",
            appDestination: "Pulse Review Web Worker deployment settings PULSE_WEB_CLIENT_ID and PULSE_WEB_CLIENT_SECRET",
            verification: "Complete a production web login, same-origin BFF read, and logout; confirm callbacks use only https://review.pulse.app/auth/callback, the cookie never reaches api.pulse.app, and an unauthenticated GET https://review.pulse.app/api/health-summary returns 401.",
          },
          {
            id: "manual-auth0-ios-client",
            surface: "Auth0 Dashboard > Applications > Applications > Pulse iOS > Settings",
            action: "Create a Native Application and set Allowed Callback URLs to com.pulse.app://auth/callback and Allowed Logout URLs to com.pulse.app://auth/logout.",
            requiredValue: "Pulse iOS client identifier",
            appDestination: "Pulse iOS build configuration value PULSE_IOS_CLIENT_ID and URL types for com.pulse.app",
            verification: "Sign in and sign out on a physical iPhone, confirm ASWebAuthenticationSession returns only through com.pulse.app://auth/callback, then publish a summary and confirm an expired or wrong-audience token returns 401.",
          },
          {
            id: "manual-auth0-api-resource",
            surface: "Auth0 Dashboard > Applications > APIs > Pulse Summary API > Settings and Permissions",
            action: "Create the Pulse Summary API resource with identifier https://api.pulse.app, enable RS256 access tokens, add publish:summary, read:summary, and delete:account permissions, enable offline_access for the Pulse iOS application, and require rotating refresh tokens with reuse detection.",
            requiredValue: "Pulse Summary API audience and publish:summary, read:summary, delete:account, offline_access permission names",
            appDestination: "Pulse iOS and Pulse Review Web requested scopes plus PULSE_AUTH0_AUDIENCE and native, web-gateway, and service authorization policies",
            verification: "Inspect a native access token, confirm the issuer, audience, subject, expiry, and granted scope set, then reuse an old rotated refresh token and confirm Auth0 revokes the token family.",
          },
          {
            id: "manual-auth0-session-key",
            surface: "Cloudflare Dashboard > Workers & Pages > pulse-review-web > Settings > Variables and Secrets",
            action: "Create a random 32-byte production session-encryption value under PULSE_SESSION_KEY_CURRENT, leave PULSE_SESSION_KEY_PREVIOUS unset for the first deployment, and record the non-secret key identifier under PULSE_SESSION_ACTIVE_KEY_ID. During rotation, move the prior material to PREVIOUS, add new CURRENT material, deploy dual-read/current-write, verify expiry coverage, then retire PREVIOUS.",
            requiredValue: "PULSE_SESSION_KEY_CURRENT, PULSE_SESSION_KEY_PREVIOUS, and PULSE_SESSION_ACTIVE_KEY_ID binding names",
            appDestination: "pulse-review-web encrypted Workers secret bindings consumed only by apps/web/src/auth/session.ts",
            verification: "Complete login, callback, authenticated BFF read, logout, expiry, and staged key-rotation tests; confirm no session value appears in logs, source, browser storage, or api.pulse.app requests.",
          },
        ],
        verification: [
          "Run native and web OIDC callback integration tests with state, nonce, issuer, audience, expiry, refresh, and PKCE mismatch cases.",
          "Sign in as two test subjects and confirm each subject can read only its own redacted summary.",
        ],
      },
      {
        id: "integration-cloudflare-production",
        name: "Cloudflare production deployment",
        purpose: "Deploy the review service, encrypted persistence binding, and web companion at the accepted production origins.",
        authMode: "Cloudflare account authorization for the pulse.app zone; runtime user authentication remains Auth0 OIDC",
        featureIds: ["feature-summary-service", "feature-web-review", "feature-account-deletion"],
        ownedFiles: [
          "package.json",
          "package-lock.json",
          "tsconfig.base.json",
          "services/review/package.json",
          "services/review/tsconfig.json",
          "services/review/vitest.config.ts",
          "services/review/wrangler.toml",
          "services/review/migrations/0001_health_summaries.sql",
          "services/review/migrations/0002_request_controls.sql",
          "services/review/migrations/0003_web_sessions.sql",
          "services/review/src/index.ts",
          "services/review/src/jobs/retention.ts",
          "apps/web/package.json",
          "apps/web/tsconfig.json",
          "apps/web/vitest.config.ts",
          "apps/web/playwright.config.ts",
          "apps/web/wrangler.toml",
          "apps/web/src/index.ts",
          "scripts/deploy-production.mjs",
          "scripts/verify-production.mjs",
          "scripts/validate-cloudflare-config.mjs",
        ],
        requiredEnv: ["PULSE_AUTH0_ISSUER", "PULSE_AUTH0_AUDIENCE", "PULSE_WEB_CLIENT_ID", "PULSE_SUMMARY_KEK_V1", "PULSE_SUMMARY_ACTIVE_KEK_VERSION", "PULSE_SUBJECT_HASH_KEY"],
        codeSetup: [
          "Bootstrap the new npm workspace with root package.json and package-lock.json, shared TypeScript configuration, service and web package manifests, Vitest and Playwright configurations, Worker entrypoints, exact build/test/deploy scripts, and Node 22 pinned in engines.",
          "Author Wrangler configuration with placeholder-safe DB bindings for both Workers, the SUMMARY_SERVICE WorkerEntrypoint service binding, local migration commands, scripts/validate-cloudflare-config.mjs, scripts/deploy-production.mjs, and scripts/verify-production.mjs. Code-owned execution may use only a local or ephemeral D1 database; production D1 creation, identifiers, remote migrations, domains, deployment, and smoke require the explicit operator action below.",
          "Migration 0001 creates health_summaries(subject_hash TEXT PRIMARY KEY, summary_version TEXT NOT NULL, stored_at TEXT NOT NULL, synced_at TEXT NOT NULL, key_version INTEGER NOT NULL, wrapped_dek BLOB NOT NULL, wrap_nonce BLOB NOT NULL, wrap_tag BLOB NOT NULL, data_nonce BLOB NOT NULL, ciphertext BLOB NOT NULL, data_tag BLOB NOT NULL). Migration 0002 creates idempotency_requests with primary key(subject_hash,endpoint,idempotency_key), request_hash, receipt_json, created_at, expires_at; rate_limits with primary key(subject_hash,endpoint,window_start), request_count; and deletion_receipts with primary key(session_hash,endpoint,idempotency_key_hash), subject_hash, deleted_at, expires_at. Migration 0003 creates web_sessions(session_hash TEXT PRIMARY KEY, subject_hash TEXT NOT NULL, key_id TEXT NOT NULL, scopes_json TEXT NOT NULL, authorization_version INTEGER NOT NULL, csrf_hash TEXT NOT NULL, issued_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, absolute_expires_at TEXT NOT NULL, revoked_at TEXT) plus subject and expiry indexes.",
          "Encrypt canonical HealthSummaryV1 JSON with a random per-record 256-bit DEK and Web Crypto AES-256-GCM; encrypt that DEK separately with AES-256-GCM under the version-addressable PULSE_SUMMARY_KEK_V1 and persist wrapped_dek, wrap_nonce, and wrap_tag. Persist data_nonce and data_tag for the payload. Payload AAD binds only immutable subject_hash, schemaVersion, and summaryVersion; wrapping AAD separately binds keyVersion plus the immutable record identity so KEK rotation cannot invalidate the unchanged payload authentication tag.",
          "For rotation, provision PULSE_SUMMARY_KEK_V2 while retaining V1, deploy read-V1-or-V2/write-V2 using PULSE_SUMMARY_ACTIVE_KEK_VERSION, transactionally rewrap every DEK without decrypting or rewriting payload ciphertext, decrypt the unchanged payload successfully after rewrap, verify zero V1 rows and rollback coverage, then retire V1. Never overwrite an active versioned key.",
          "Persist one idempotency receipt for each subject_hash plus endpoint plus Idempotency-Key for 24 hours with a canonical request_hash; exact replay returns the stored receipt, a different request hash returns 409, and later summaries do not remove earlier receipts. For a permitted POST, commit the endpoint counter, encrypted summary upsert, and final replay receipt in one D1 transaction or batch; conflict and rate-limit decisions commit none of the summary or receipt, and a rejected attempt does not increment the success counter. Enforce fixed windows of 60 POST attempts per subject per 15 minutes, 300 GET BFF attempts per subject per 15 minutes, and 5 DELETE BFF attempts per subject per 24 hours. A limited route returns Retry-After to its exact window reset and performs no summary, session, receipt, or last-seen mutation.",
          "Run a daily 02:00 UTC Cron Trigger that deletes summaries older than 30 days, expired idempotency and deletion receipts, expired rate-limit windows, and expired or revoked web sessions. Before live-session authorization on DELETE only, verify the signed cookie including its 8-hour absolute expiry, hash its opaque identifier and supplied key, then check deletion_receipts by session_hash plus /api/account plus idempotency_key_hash and return 204 for an exact replay only within that cookie-valid 8-hour window. Otherwise validate the live session and scope; one D1 transaction then removes the summary, idempotency rows, rate-limit rows, and web sessions, writes the one-way replay receipt with the cookie's absolute expiry, clears the cookie, and never restores deleted data.",
          "Make the owned deployment scripts target the public bearer API at https://api.pulse.app and the web companion plus callback/session/BFF at https://review.pulse.app with HTTPS-only redirects, non-public WorkerEntrypoint RPC binding, explicit --environment production, dry-run/config validation, and no preview access to production data; do not execute them without operator approval.",
        ],
        unclassifiedSetup: [],
        externalManualActions: [
          {
            id: "manual-cloudflare-production-account",
            surface: "Cloudflare Dashboard > Workers & Pages > Overview and Websites > pulse.app > DNS",
            action: "Authorize the production Cloudflare account, confirm pulse.app is active, create the pulse-review-prod D1 database, approve custom-domain bindings for api.pulse.app and review.pulse.app, and approve the web-to-service SUMMARY_SERVICE binding.",
            requiredValue: "Cloudflare production account access, pulse.app zone ownership, pulse-review-prod D1 identifier, and SUMMARY_SERVICE binding name",
            appDestination: "Wrangler deployment authentication plus services/review/wrangler.toml and apps/web/wrangler.toml DB bindings, web routes, and SUMMARY_SERVICE binding",
            verification: "Run npx wrangler whoami and inspect the approved D1, DB bindings, routes, and SUMMARY_SERVICE binding in the dashboard; record the identifiers in the Wrangler files but do not migrate or deploy until the separate production-release approval action.",
          },
          {
            id: "manual-cloudflare-summary-key",
            surface: "Cloudflare Dashboard > Workers & Pages > pulse-review-service and pulse-review-web > Settings > Variables and Secrets",
            action: "Create random 32-byte production key material under the versioned PULSE_SUMMARY_KEK_V1 name for the service, create separate shared PULSE_SUBJECT_HASH_KEY material in both Workers, and record 1 under PULSE_SUMMARY_ACTIVE_KEK_VERSION without placing any value in source control. For rotation, add V2 while retaining V1 until rewrap verification passes.",
            requiredValue: "PULSE_SUMMARY_KEK_V1, future versioned KEK names, PULSE_SUMMARY_ACTIVE_KEK_VERSION, and PULSE_SUBJECT_HASH_KEY binding names",
            appDestination: "pulse-review-service encrypted KEK, subject-hash, and active-version bindings plus the identical pulse-review-web PULSE_SUBJECT_HASH_KEY binding consumed by the callback and service storage boundaries",
            verification: "After the separately approved production release, publish one operator test summary, confirm D1 stores wrapped_dek, wrap_nonce, wrap_tag, data_nonce, ciphertext, data_tag, and key_version rather than plaintext counts, then use the staged release process to add V2, switch writes, rewrap, verify old and new records, and retire V1 only after zero rows reference it.",
          },
          {
            id: "manual-cloudflare-production-release",
            surface: "Release operator terminal authenticated to the approved Cloudflare production account",
            action: "After reviewing the generated migration plan and deployment diff, approve the production release, apply remote D1 migrations, run the owned production deployment script, and run the owned authenticated production verification script. Stop on any unexpected migration, binding, domain, certificate, authorization, or cross-subject result.",
            requiredValue: "Explicit production deployment approval, pulse-review-prod D1 identifier, approved api.pulse.app and review.pulse.app routes, and operator test-subject names",
            appDestination: "services/review/wrangler.toml and apps/web/wrangler.toml production bindings plus the approved Cloudflare production account",
            verification: "Run npx wrangler d1 migrations apply pulse-review-prod --remote --config services/review/wrangler.toml, then node scripts/deploy-production.mjs --environment production and node scripts/verify-production.mjs --environment production; confirm the authenticated iOS-to-web production smoke, exact domains, certificates, authorization failures, cross-subject isolation, deletion replay, and rollback signals before closing the release.",
          },
        ],
        verification: [
          "Run npm ci, npm run typecheck, npm run build, both Worker test suites, Playwright, and node scripts/ios-preflight.mjs --suite all before requesting production approval.",
          "Apply migrations only to local or ephemeral D1 with npx wrangler d1 migrations apply pulse-review-prod --local --config services/review/wrangler.toml and confirm subject-scoped create/read/delete, idempotency replay/conflict/expiry, every endpoint quota, retention, session revocation, and account deletion.",
          "Run node scripts/validate-cloudflare-config.mjs --environment production --dry-run and verify the generated binding, route, and migration plan without mutating the production account.",
        ],
      },
    ],
    apiContracts: [
      {
        id: "api-publish-summary",
        method: "POST",
        path: "/v1/health-summary",
        description: "Authorization uses a validated iOS Auth0 bearer access token with publish:summary; Idempotency-Key: UUID is mandatory and retained for 24 hours in a subject-plus-endpoint-plus-key ledger with the canonical request hash and receipt. The service validates OIDC and If-Match when supplied, hashes the subject, encrypts the record, and atomically commits the successful POST counter, encrypted summary upsert, and final replay receipt in one D1 transaction or batch. Exact replay returns the stored receipt even after later publishes; a different request hash returns 409 IDEMPOTENCY_CONFLICT without mutation. A subject-scoped fixed window permits 60 publish attempts per 15 minutes; only a permitted new publish increments the counter, while replay, conflict, and limited requests do not mutate the counter, summary, or receipt. A 429 returns Retry-After to the next window.",
        requestSchema: "headers { Authorization: Bearer token, Idempotency-Key: UUID, If-Match?: summaryVersion }; body { schemaVersion: 1, syncedAt: ISO8601, stepCount: integer >= 0, workoutCount: integer >= 0 }",
        responseSchema: "success 200 { schemaVersion: 1, summaryVersion: string, storedAt: ISO8601 }; error { schemaVersion: 1, error: { code: UNAUTHENTICATED | VERSION_CONFLICT | IDEMPOTENCY_CONFLICT | INVALID_BODY | RATE_LIMITED | STORE_UNAVAILABLE, message: string, retryable: boolean, requestId: string }, retryAfterSeconds?: integer }; 429 includes Retry-After",
        featureIds: ["feature-summary-service"],
        ownedFiles: [
          "services/review/src/routes/health-summary-post.ts",
          "services/review/src/contracts/health-summary-v1.ts",
          "services/review/src/contracts/typed-summary-error.ts",
        ],
      },
      {
        id: "api-read-summary",
        method: "GET",
        path: "/api/health-summary",
        description: "The browser calls same-origin GET https://review.pulse.app/api/health-summary with __Host-pulse_session. The review Worker validates the host-only D1 session and read:summary scope, obtains its already-computed subject_hash, and invokes env.SUMMARY_SERVICE.readSummary({ subjectHash, authorizationVersion }) through a non-public WorkerEntrypoint RPC binding; api.pulse.app never receives the cookie and public fetch cannot dispatch the RPC method. The BFF returns ETag=summaryVersion, honors If-None-Match with 304, never accepts a subject parameter, and permits 300 attempts per subject per 15 minutes; 429 returns Retry-After to the window reset without updating summary or session last-seen state.",
        requestSchema: "browser headers { Cookie: __Host-pulse_session, If-None-Match?: summaryVersion }; non-public WorkerEntrypoint RPC ReadSummaryRequestV1 { subjectHash: StoredSubjectHashV1, authorizationVersion: positive integer }",
        responseSchema: "success 200 { schemaVersion: 1, summaryVersion: string, storedAt: ISO8601, syncedAt: ISO8601, stepCount: integer >= 0, workoutCount: integer >= 0 } with ETag; error { schemaVersion: 1, error: { code: UNAUTHENTICATED | FORBIDDEN_SCOPE | SUMMARY_NOT_FOUND | RATE_LIMITED | STORE_UNAVAILABLE, message: string, retryable: boolean, requestId: string }, retryAfterSeconds?: integer }; 429 includes Retry-After",
        featureIds: ["feature-summary-service", "feature-web-review"],
        ownedFiles: [
          "apps/web/src/routes/health-summary-bff.ts",
          "services/review/src/routes/health-summary-get.ts",
          "services/review/src/rpc/summary-service-entrypoint.ts",
          "services/review/src/contracts/health-summary-v1.ts",
          "services/review/src/contracts/typed-summary-error.ts",
        ],
      },
      {
        id: "api-delete-account",
        method: "DELETE",
        path: "/api/account",
        description: "The browser calls same-origin DELETE https://review.pulse.app/api/account with __Host-pulse_session, X-CSRF-Token, and Idempotency-Key: UUID. Before live-session authorization, the web gateway verifies the signed cookie including its 8-hour absolute expiry, hashes its opaque identifier and supplied key, and returns 204 only for an exact deletion_receipts match on session_hash plus endpoint plus idempotency_key_hash within that cookie-valid window. Otherwise it validates the live D1 session, CSRF hash, authorization version, and delete:account scope, then invokes env.SUMMARY_SERVICE.deleteAccount({ subjectHash, sessionHash, idempotencyKey }) through non-public WorkerEntrypoint RPC. A subject permits 5 DELETE attempts per 24 hours; 429 returns Retry-After without mutation. One D1 transaction deletes the subject's encrypted summary, live idempotency rows, rate-limit rows, and web sessions, writes the one-way replay receipt with the cookie's absolute expiry, and clears the cookie.",
        requestSchema: "browser headers { Cookie: __Host-pulse_session, X-CSRF-Token: session-bound value, Idempotency-Key: UUID }; non-public WorkerEntrypoint RPC DeleteAccountRequestV1 { subjectHash: StoredSubjectHashV1, sessionHash: string, idempotencyKey: UUID } and no body",
        responseSchema: "success 204 with no body; error { schemaVersion: 1, error: { code: UNAUTHENTICATED | FORBIDDEN_SCOPE | RATE_LIMITED | STORE_UNAVAILABLE, message: string, retryable: boolean, requestId: string }, retryAfterSeconds?: integer }; 429 includes Retry-After",
        featureIds: ["feature-account-deletion"],
        ownedFiles: [
          "apps/web/src/routes/account-delete-bff.ts",
          "services/review/src/routes/account-delete.ts",
          "services/review/src/rpc/summary-service-entrypoint.ts",
          "services/review/src/contracts/typed-summary-error.ts",
          "services/review/test/account-delete-contract.test.ts",
        ],
      },
    ],
    tests: [
      {
        id: "test-health-sync-acceptance",
        description: "Given undetermined permission, one Sync Health Data activation requests only step-count and workout read access; success renders one new summary and denial retains the last valid summary.",
        needIds: ["need-health-review"],
        featureIds: ["feature-health-sync", "feature-health-review"],
        screenIds: ["screen-health-dashboard"],
        integrationIds: ["integration-healthkit"],
        platformSurfaceIds: ["surface-ios"],
        kind: "acceptance",
        testFramework: "XCTest",
        ownedFiles: ["Tests/HealthSyncAcceptanceTests.swift"],
        command: "node scripts/ios-preflight.mjs --suite health-sync",
      },
      {
        id: "test-summary-service-contract",
        description: "Authenticated publish, same-origin BFF read, and DELETE /api/account round-trip for one subject; unsupported versions, invalid auth/scope, cross-subject reads, idempotency replay/conflict, rate limits, and unavailable storage return the declared typed failures without losing the last valid record except after confirmed deletion. A successful POST atomically commits its counter, encrypted summary, and final receipt; injected failures between those logical steps roll back all three.",
        needIds: ["need-health-review"],
        featureIds: ["feature-summary-service", "feature-account-deletion"],
        screenIds: [],
        integrationIds: ["integration-review-oidc"],
        platformSurfaceIds: ["surface-review-service"],
        kind: "acceptance",
        testFramework: "Vitest",
        ownedFiles: [
          "services/review/test/test-summary-service-contract.test.ts",
          "services/review/test/account-delete-contract.test.ts",
          "apps/web/tests/health-summary-bff.test.ts",
        ],
        command: "npm test -- --run services/review/test/test-summary-service-contract.test.ts services/review/test/account-delete-contract.test.ts apps/web/tests/health-summary-bff.test.ts",
      },
      {
        id: "test-web-review-acceptance",
        description: "The web companion covers signed-out, successful OIDC login, loading, empty, summary, stale, unauthorized, GET rate-limited with Retry-After recovery, delete rate-limited without deletion, deleting, deleted, delete-failed, and service-failure states and never renders raw identifiers.",
        needIds: ["need-health-review"],
        featureIds: ["feature-web-review", "feature-account-deletion"],
        screenIds: ["screen-web-review"],
        integrationIds: ["integration-review-oidc"],
        platformSurfaceIds: ["surface-web"],
        kind: "acceptance",
        testFramework: "Playwright",
        command: "npx playwright test apps/web/tests/test-web-review-acceptance.spec.ts --project=chromium",
      },
      {
        id: "test-auth0-boundaries",
        description: "Native and web PKCE callbacks reject state, nonce, issuer, audience, scope, expiry, signature, redirect, and verifier mismatches; native refresh tokens rotate with reuse detection. Web callback storage contains only the one-way issuer-plus-subject hash, normalized validated scopes, authorization version, CSRF hash, and lifecycle data. Sessions rotate, expire, reject CSRF, revoke on logout, stay host-only, and never reach api.pulse.app or browser storage. Direct HTTP, forwarded subject/scope headers, and public fetch cannot invoke WorkerEntrypoint RPC methods or elevate stored scopes.",
        needIds: ["need-health-review"],
        featureIds: ["feature-health-review", "feature-summary-service", "feature-web-review", "feature-account-deletion"],
        screenIds: ["screen-health-dashboard", "screen-web-review"],
        integrationIds: ["integration-review-oidc"],
        platformSurfaceIds: ["surface-ios", "surface-review-service", "surface-web"],
        ownedFiles: [
          "Tests/Auth0NativeFlowTests.swift",
          "services/review/test/auth0-boundaries.test.mjs",
          "apps/web/tests/auth0-callback.test.mjs",
          "apps/web/tests/session-key-rotation.test.mjs",
          "apps/web/tests/service-binding.test.mjs",
        ],
        kind: "acceptance",
        testFramework: "XCTest + Node test runner",
        command: "node scripts/ios-preflight.mjs --suite auth0 && node --test services/review/test/auth0-boundaries.test.mjs apps/web/tests/auth0-callback.test.mjs apps/web/tests/session-key-rotation.test.mjs apps/web/tests/service-binding.test.mjs",
      },
      {
        id: "test-request-policy-boundaries",
        description: "Composite subject-plus-endpoint-plus-key idempotency returns the exact stored receipt for the same canonical request digest, returns 409 without mutation for a different digest, and expires after 24 hours. A permitted POST commits its success counter, encrypted summary upsert, and final receipt atomically; fault injection proves no partial counter, summary, or receipt survives. Endpoint policy enforces 60 POST and 300 GET attempts per subject per 15 minutes plus 5 DELETE attempts per subject per 24 hours, returns exact Retry-After, and performs no summary, session, receipt, or last-seen mutation on conflict or 429.",
        needIds: ["need-health-review"],
        featureIds: ["feature-summary-service"],
        screenIds: [],
        integrationIds: ["integration-cloudflare-production"],
        platformSurfaceIds: ["surface-review-service"],
        ownedFiles: ["services/review/test/idempotency-rate-limit.test.mjs"],
        kind: "acceptance",
        testFramework: "Node test runner",
        command: "node --test services/review/test/idempotency-rate-limit.test.mjs",
      },
      {
        id: "test-account-deletion",
        description: "A signed-in web member with stored delete:account scope confirms DELETE /api/account with a session-bound CSRF token and idempotency key; the subject's summary, request controls, and sessions disappear in one transaction and the cookie clears. Exact cookie/key replay resolves the session-hash-plus-key tombstone to 204 before live-session auth only while the original signed cookie remains within its 8-hour absolute validity; replay after cookie expiry, a different key, malformed cookie, expired tombstone, missing scope, or another subject fails closed without cross-subject mutation.",
        needIds: ["need-health-review"],
        featureIds: ["feature-account-deletion"],
        screenIds: ["screen-web-review"],
        integrationIds: ["integration-review-oidc", "integration-cloudflare-production"],
        platformSurfaceIds: ["surface-review-service", "surface-web"],
        ownedFiles: [
          "services/review/test/account-delete-contract.test.ts",
          "apps/web/tests/account-delete-flow.spec.ts",
        ],
        kind: "acceptance",
        testFramework: "Vitest + Playwright",
        command: "npm test -- --run services/review/test/account-delete-contract.test.ts && npx playwright test apps/web/tests/account-delete-flow.spec.ts --project=chromium",
      },
      {
        id: "test-code-owned-release-preflight",
        description: "The new npm workspace bootstraps from the lockfile; local D1 migrations, decryptable AES-GCM envelope rotation, endpoint request policy, daily retention, transactional account deletion, Wrangler WorkerEntrypoint bindings, portable iOS simulator tests/build/archive, and a production configuration dry-run pass without plaintext persistence or any production mutation. Remote migration, deployment, domains, and authenticated production smoke remain operator-gated manual release actions.",
        dependsOnTestIds: [
          "test-health-sync-acceptance",
          "test-summary-service-contract",
          "test-web-review-acceptance",
          "test-auth0-boundaries",
          "test-request-policy-boundaries",
          "test-account-deletion",
        ],
        needIds: ["need-health-review"],
        featureIds: ["feature-health-sync", "feature-health-review", "feature-summary-service", "feature-web-review", "feature-account-deletion"],
        screenIds: ["screen-health-dashboard", "screen-web-review"],
        integrationIds: ["integration-healthkit", "integration-review-oidc", "integration-cloudflare-production"],
        platformSurfaceIds: ["surface-ios", "surface-review-service", "surface-web"],
        ownedFiles: [
          "services/review/test/d1-retention.test.mjs",
          "services/review/test/encryption-rotation.test.mjs",
          "services/review/test/idempotency-rate-limit.test.mjs",
          "services/review/test/wrangler-bindings.test.mjs",
          "apps/web/tests/service-binding.test.mjs",
          "scripts/verify-production.mjs",
        ],
        kind: "smoke",
        testFramework: "Node test runner + Playwright + XCTest preflight",
        command: "npm ci && npm run typecheck && npm run build && npm test && npx playwright test --config apps/web/playwright.config.ts --project=chromium && npx wrangler d1 migrations apply pulse-review-prod --local --config services/review/wrangler.toml && node --test services/review/test/d1-retention.test.mjs services/review/test/encryption-rotation.test.mjs services/review/test/idempotency-rate-limit.test.mjs services/review/test/wrangler-bindings.test.mjs apps/web/tests/service-binding.test.mjs && node scripts/ios-preflight.mjs --suite all && node scripts/validate-cloudflare-config.mjs --environment production --dry-run",
      },
    ],
    adrs: [
      {
        id: "adr-healthkit-local",
        title: "Keep HealthKit data on device",
        context: "Health samples are sensitive and the initial review flow does not require a server copy.",
        decision: "Persist only the last valid derived batch on device and publish no raw HealthKit identifiers.",
        consequences: "The web companion receives only a redacted, versioned summary contract.",
        reversibility: "medium",
        cites: ["need-health-review", "feature-health-sync"],
      },
    ],
    assumptions: [],
    risks: [
      {
        id: "risk-healthkit-unavailable",
        text: "HealthKit may be unavailable or restricted on the current device.",
        likelihood: "medium",
        impact: "medium",
        mitigation: "Expose an explicit unavailable state and keep the last valid summary.",
      },
    ],
    nonGoals: [
      {
        id: "non-goal-write-healthkit",
        text: "Writing samples back to HealthKit is out of scope.",
        because: "The product only needs read-only review and should request the least privilege.",
      },
    ],
    goals: [
      { id: "goal-trusted-sync", statement: "Make a scoped HealthKit sync understandable and recoverable.", metric: "100% of declared permission and failure states have acceptance coverage." },
    ],
    successMetrics: [
      { id: "metric-sync", metric: "Accepted synchronization flow", target: "One batch and one UI update per explicit command" },
    ],
    observability: {
      slis: [{ metric: "HealthKit adapter result by non-sensitive outcome", target: "Recorded for every synchronization command" }],
      slos: [{ metric: "Local summary render after successful adapter response", target: "p95 under 500 ms" }],
    },
    boundaries: {
      always: ["Request least-privilege read types and keep raw health data on device."],
      askFirst: ["Any new HealthKit data type or off-device transfer."],
      never: ["Log raw samples, HealthKit identifiers, or authorization payloads."],
    },
    voiceProfile: {
      principles: ["State permission scope and failure recovery plainly."],
      doWords: ["Allow", "Try again", "Last synced"],
      dontWords: ["Unlock everything", "Guaranteed"],
    },
    projectContext: {
      startingPoint: "existing-app",
      sourceRepo: PRIVATE_REPO,
      sourceArtifacts: ["embedded-current-baseline.md"],
      inspectedAt: "2026-08-05T12:00:00Z",
      evidence: [
        {
          id: "evidence-current-dashboard",
          status: "observed",
          statement: "The existing dashboard shell and Sync action are present.",
          sourceRefs: ["embedded-current-baseline.md"],
        },
        {
          id: "evidence-contract-decision",
          status: "decided",
          statement: "The HealthSampleBatch contract and least-privilege read scope are approved.",
          sourceRefs: ["decision:healthkit-contract"],
        },
        {
          id: "evidence-contract-verified",
          status: "observed",
          statement: "The contract fixture round-trips schema version 1 without raw identifiers.",
          sourceRefs: ["test:health-sample-batch-v1"],
        },
      ],
      bootstrap: {
        ownedFiles: [
          "package.json",
          "package-lock.json",
          "tsconfig.base.json",
          "apps/web/package.json",
          "apps/web/tsconfig.json",
          "apps/web/vitest.config.ts",
          "apps/web/playwright.config.ts",
          "apps/web/wrangler.toml",
          "apps/web/src/index.ts",
          "services/review/package.json",
          "services/review/tsconfig.json",
          "services/review/vitest.config.ts",
          "services/review/wrangler.toml",
          "services/review/src/index.ts",
        ],
        commands: {
          install: "npm ci",
          typecheck: "npm run typecheck",
          test: "npm test && npx playwright test --config apps/web/playwright.config.ts --project=chromium",
          build: "npm run build",
        },
      },
    },
    uiPreferences: {
      informationDensity: "Compact health summary with one dominant synchronization action.",
      brandAdjectives: ["calm", "precise", "private"],
      accessibilityFloor: ["VoiceOver labels", "Dynamic Type", "44pt minimum touch targets", "Reduce Motion"],
      responsiveTargets: { minimum: "iPhone SE", maximum: "iPad Pro", deviceClasses: ["compact", "regular"] },
      mustKeep: ["Existing dashboard hierarchy and one primary Sync Health Data action."],
      mustAvoid: ["Decorative health scores", "Permission dark patterns", "Raw identifiers"],
      mayEvolve: ["Summary grouping after live verification."],
      visualReferences: ["embedded-current-baseline.md"],
    },
    architecture: {
      components: [
        {
          id: "component-healthkit-adapter",
          name: "HealthKit adapter",
          kind: "integration",
          featureIds: ["feature-health-sync"],
          owner: "ios",
          description: "Scoped HKHealthStore authorization and query boundary.",
          provenance: "decided",
        },
        {
          id: "component-health-dashboard",
          name: "Health dashboard",
          kind: "ui",
          featureIds: ["feature-health-review"],
          owner: "ios-and-web",
          description: "Renders the last valid redacted summary.",
          provenance: "observed",
        },
        {
          id: "component-summary-service",
          name: "Redacted summary service",
          kind: "service",
          featureIds: ["feature-summary-service", "feature-account-deletion"],
          owner: "service",
          description: "Authenticates subjects, validates HealthSummaryV1, encrypts the latest subject-owned record at rest, and enforces the declared retention and typed failures.",
          provenance: "decided",
        },
        {
          id: "component-web-session-gateway",
          name: "Web session gateway",
          kind: "service",
          featureIds: ["feature-web-review", "feature-account-deletion"],
          owner: "web",
          description: "Owns the review.pulse.app Auth0 callback, encrypted host-only session lifecycle, opaque subject derivation, and private BFF service-binding call.",
          provenance: "decided",
        },
        {
          id: "component-summary-keyring",
          name: "Summary keyring",
          kind: "platform",
          featureIds: ["feature-summary-service"],
          owner: "service",
          description: "Resolves version-addressable nonextractable KEK handles and enforces read-old/write-current rotation without overwriting active keys.",
          provenance: "decided",
        },
        {
          id: "component-summary-envelope",
          name: "Summary envelope encryption",
          kind: "library",
          featureIds: ["feature-summary-service"],
          owner: "service",
          description: "Creates per-record DEKs, wraps them with the selected KEK, binds authenticated metadata, and decrypts only after tag and version validation.",
          provenance: "decided",
        },
        {
          id: "component-request-policy",
          name: "Endpoint request policy",
          kind: "library",
          featureIds: ["feature-summary-service", "feature-account-deletion"],
          owner: "service",
          description: "Enforces composite idempotency replay/conflict semantics and endpoint-scoped POST, GET, and DELETE fixed-window limits; a successful POST shares one transaction with its encrypted summary upsert and final receipt.",
          provenance: "decided",
        },
        {
          id: "component-web-review",
          name: "Web review companion",
          kind: "ui",
          featureIds: ["feature-web-review", "feature-account-deletion"],
          owner: "web",
          description: "Renders only the authenticated subject's redacted summary states and delegates callback, session, and BFF behavior to the web session gateway.",
          provenance: "decided",
        },
      ],
      contracts: [
        {
          id: "contract-health-sample-batch",
          name: "Versioned health sample batch",
          provider: { specId: "spec-pulse", kind: "component", id: "component-healthkit-adapter" },
          consumers: [{ specId: "spec-pulse", kind: "component", id: "component-health-dashboard" }],
          ports: [
            { id: "port-health-request", name: "syncCommand", type: "HealthSyncCommand", direction: "input", required: true },
            { id: "port-health-batch", name: "healthBatch", type: "HealthSampleBatchV1", direction: "output", required: true },
          ],
          transport: "in-process async Swift protocol with Codable version envelope",
          failureModes: ["HealthKit unavailable", "permission denied", "query failure", "unsupported batch version"],
          securityNotes: ["request only step-count and workout read access", "never log raw samples or HealthKit identifiers", "retain data on device with file protection"],
          provenance: "decided",
        },
        {
          id: "contract-web-session",
          name: "Host-only web session and BFF subject",
          provider: { specId: "spec-pulse", kind: "component", id: "component-web-session-gateway" },
          consumers: [{ specId: "spec-pulse", kind: "component", id: "component-web-review" }],
          ports: [
            { id: "port-session-cookie", name: "reviewSession", type: "EncryptedHostOnlySession", direction: "output", required: true },
          ],
          transport: "review.pulse.app __Host-pulse_session and same-origin BFF response only",
          failureModes: ["callback validation failure", "idle or absolute expiry", "revoked session", "forbidden stored scope"],
          securityNotes: ["Secure HttpOnly SameSite=Lax Path=/ cookie", "15-minute idle and 8-hour absolute expiry", "rotate on login and revoke on logout", "no browser token storage"],
          provenance: "decided",
        },
        {
          id: "contract-summary-service-binding",
          name: "Private summary service RPC binding",
          provider: { specId: "spec-pulse", kind: "component", id: "component-summary-service" },
          consumers: [{ specId: "spec-pulse", kind: "component", id: "component-web-session-gateway" }],
          ports: [
            { id: "port-binding-read", name: "readSummary", type: "ReadSummaryRequestV1<StoredSubjectHashV1> -> HealthSummaryV1 | TypedSummaryError", direction: "output", required: true },
            { id: "port-binding-delete", name: "deleteAccount", type: "DeleteAccountRequestV1<StoredSubjectHashV1> -> NoContent204 | TypedSummaryError", direction: "output", required: true },
          ],
          transport: "non-public Cloudflare WorkerEntrypoint RPC methods on env.SUMMARY_SERVICE; no public fetch route, forwarded identity header, or public URL",
          failureModes: ["invalid RPC input", "authorization version mismatch", "rate limited", "encrypted store unavailable"],
          securityNotes: ["only the web Worker service binding can dispatch", "accept only a stored one-way subject hash from the validated D1 session", "public fetch cannot invoke RPC methods"],
          provenance: "decided",
        },
        {
          id: "contract-summary-keyring",
          name: "Versioned summary key handle",
          provider: { specId: "spec-pulse", kind: "component", id: "component-summary-keyring" },
          consumers: [{ specId: "spec-pulse", kind: "component", id: "component-summary-envelope" }],
          ports: [
            { id: "port-key-version", name: "keyVersion", type: "PositiveInteger", direction: "input", required: true },
            { id: "port-key-handle", name: "keyHandle", type: "NonextractableAesGcmKekHandle", direction: "output", required: true },
          ],
          transport: "in-process Workers secret binding lookup by immutable versioned name",
          failureModes: ["unknown key version", "active key unavailable", "retired key still referenced"],
          securityNotes: ["never return raw key bytes", "retain old versions until zero records reference them", "never overwrite a versioned key"],
          provenance: "decided",
        },
        {
          id: "contract-summary-envelope",
          name: "Decryptable summary envelope",
          provider: { specId: "spec-pulse", kind: "component", id: "component-summary-envelope" },
          consumers: [{ specId: "spec-pulse", kind: "component", id: "component-summary-service" }],
          ports: [
            { id: "port-envelope-plaintext", name: "summary", type: "HealthSummaryV1", direction: "input", required: true },
            { id: "port-envelope-record", name: "encryptedEnvelope", type: "WrappedDekEnvelopeV1", direction: "output", required: true },
          ],
          transport: "in-process Web Crypto AES-256-GCM payload encryption and AES-256-GCM DEK wrapping with independent random 96-bit nonces and a versioned keyring handle",
          failureModes: ["authentication tag mismatch", "unknown key version", "malformed envelope", "rewrap transaction failure"],
          securityNotes: ["one random DEK per record", "persist wrapped DEK and wrapping metadata", "payload AAD binds immutable subject, schema, and summary versions; wrap AAD additionally binds mutable KEK version"],
          provenance: "decided",
        },
        {
          id: "contract-request-policy",
          name: "Endpoint idempotency and rate policy",
          provider: { specId: "spec-pulse", kind: "component", id: "component-request-policy" },
          consumers: [{ specId: "spec-pulse", kind: "component", id: "component-summary-service" }],
          ports: [
            { id: "port-policy-request", name: "requestAttempt", type: "SubjectEndpointKeyAndRequestDigest", direction: "input", required: true },
            { id: "port-policy-decision", name: "policyDecision", type: "Proceed | ReplayReceipt | Conflict | RateLimited", direction: "output", required: true },
          ],
          transport: "D1 transaction boundary shared with the caller's successful summary mutation and final receipt",
          failureModes: ["different-body key reuse", "POST, GET, or DELETE endpoint window reached", "policy store unavailable"],
          securityNotes: ["key every ledger row by opaque subject hash", "atomically commit the successful POST counter, summary upsert, and final receipt", "perform no counter, summary, or receipt write on conflict or rate limit", "expire receipts after 24 hours"],
          provenance: "decided",
        },
        {
          id: "contract-redacted-summary-api",
          name: "Authenticated redacted summary API",
          provider: { specId: "spec-pulse", kind: "component", id: "component-summary-service" },
          consumers: [
            { specId: "spec-pulse", kind: "component", id: "component-health-dashboard" },
          ],
          ports: [
            { id: "port-summary-publish", name: "publishSummary", type: "AuthenticatedRequest<HealthSummaryV1>", direction: "input", required: true },
            { id: "port-summary-receipt", name: "publishReceipt", type: "HealthSummaryReceiptV1", direction: "output", required: true },
          ],
          transport: "public HTTPS JSON v1 bearer POST /v1/health-summary on api.pulse.app for the native iOS publisher only",
          failureModes: ["unauthenticated 401", "forbidden publish scope 403", "version or idempotency conflict 409", "invalid body 422", "rate limited 429", "encrypted store unavailable 503"],
          securityNotes: [
            "validate OIDC signature, issuer, audience, expiry, nonce, state, and PKCE before binding the opaque subject",
            "enforce subject ownership on every write and read and never persist raw samples or HealthKit identifiers",
            "encrypt at rest, use TLS in transit, redact logs, and delete on account deletion or 30 days after last sync",
          ],
          provenance: "decided",
        },
      ],
      relationships: [
        {
          id: "relationship-healthkit-dashboard",
          from: { specId: "spec-pulse", kind: "component", id: "component-healthkit-adapter" },
          to: { specId: "spec-pulse", kind: "component", id: "component-health-dashboard" },
          direction: "unidirectional",
          contractRef: { specId: "spec-pulse", kind: "contract", id: "contract-health-sample-batch" },
          criticality: "hard",
          optional: false,
          rationale: "The dashboard may update only from a validated, versioned adapter result.",
          provenance: "decided",
        },
        {
          id: "relationship-web-session-review",
          from: { specId: "spec-pulse", kind: "component", id: "component-web-session-gateway" },
          to: { specId: "spec-pulse", kind: "component", id: "component-web-review" },
          direction: "unidirectional",
          contractRef: { specId: "spec-pulse", kind: "contract", id: "contract-web-session" },
          criticality: "hard",
          optional: false,
          rationale: "The web UI renders authenticated data only after the same-origin gateway establishes and validates the host-only session.",
          provenance: "decided",
        },
        {
          id: "relationship-summary-service-gateway",
          from: { specId: "spec-pulse", kind: "component", id: "component-summary-service" },
          to: { specId: "spec-pulse", kind: "component", id: "component-web-session-gateway" },
          direction: "unidirectional",
          contractRef: { specId: "spec-pulse", kind: "contract", id: "contract-summary-service-binding" },
          criticality: "hard",
          optional: false,
          rationale: "The gateway receives subject-scoped reads and delete results only through the non-public service-binding RPC.",
          provenance: "decided",
        },
        {
          id: "relationship-keyring-envelope",
          from: { specId: "spec-pulse", kind: "component", id: "component-summary-keyring" },
          to: { specId: "spec-pulse", kind: "component", id: "component-summary-envelope" },
          direction: "unidirectional",
          contractRef: { specId: "spec-pulse", kind: "contract", id: "contract-summary-keyring" },
          criticality: "hard",
          optional: false,
          rationale: "Envelope encryption cannot wrap or unwrap a DEK until the immutable key version resolves.",
          provenance: "decided",
        },
        {
          id: "relationship-envelope-service",
          from: { specId: "spec-pulse", kind: "component", id: "component-summary-envelope" },
          to: { specId: "spec-pulse", kind: "component", id: "component-summary-service" },
          direction: "unidirectional",
          contractRef: { specId: "spec-pulse", kind: "contract", id: "contract-summary-envelope" },
          criticality: "hard",
          optional: false,
          rationale: "The service persists or returns a summary only through the authenticated envelope boundary.",
          provenance: "decided",
        },
        {
          id: "relationship-policy-service",
          from: { specId: "spec-pulse", kind: "component", id: "component-request-policy" },
          to: { specId: "spec-pulse", kind: "component", id: "component-summary-service" },
          direction: "unidirectional",
          contractRef: { specId: "spec-pulse", kind: "contract", id: "contract-request-policy" },
          criticality: "hard",
          optional: false,
          rationale: "The service evaluates policy before mutation, then atomically commits the permitted POST counter, encrypted summary upsert, and final replay receipt within the shared D1 transaction boundary.",
          provenance: "decided",
        },
        {
        id: "relationship-summary-service-ios",
          from: { specId: "spec-pulse", kind: "component", id: "component-health-dashboard" },
          to: { specId: "spec-pulse", kind: "component", id: "component-summary-service" },
          direction: "unidirectional",
          contractRef: { specId: "spec-pulse", kind: "contract", id: "contract-redacted-summary-api" },
          criticality: "hard",
          optional: false,
          rationale: "The iOS publisher requires the authenticated service contract before it can publish a redacted summary.",
          provenance: "decided",
        },
      ],
      flows: [
        {
          id: "flow-healthkit-dashboard",
          name: "Synchronize HealthKit and update review",
          trigger: "The member activates Sync Health Data.",
          exchanges: [
            {
              id: "exchange-healthkit-dashboard",
              order: 1,
              from: { specId: "spec-pulse", kind: "component", id: "component-healthkit-adapter" },
              to: { specId: "spec-pulse", kind: "component", id: "component-health-dashboard" },
              contractRef: { specId: "spec-pulse", kind: "contract", id: "contract-health-sample-batch" },
              inputRefs: [{ specId: "spec-pulse", kind: "element", id: "element-sync-health" }],
              outputRefs: [{ specId: "spec-pulse", kind: "element", id: "element-health-summary" }],
              failurePaths: ["Keep the last valid summary and present the typed unavailable, denied, query-failed, or unsupported-version state."],
            },
            {
              id: "exchange-dashboard-service",
              order: 2,
              from: { specId: "spec-pulse", kind: "component", id: "component-health-dashboard" },
              to: { specId: "spec-pulse", kind: "component", id: "component-summary-service" },
              contractRef: { specId: "spec-pulse", kind: "contract", id: "contract-redacted-summary-api" },
              inputRefs: [{ specId: "spec-pulse", kind: "feature", id: "feature-health-review" }],
              outputRefs: [{ specId: "spec-pulse", kind: "feature", id: "feature-summary-service" }],
              failurePaths: ["Retain the on-device summary and show typed authentication, validation, rate-limit, or service-unavailable recovery."],
            },
          ],
          provenance: "decided",
        },
        {
          id: "flow-web-authenticated-review",
          name: "Establish a host-only session and load the subject summary",
          trigger: "The member activates Sign in to review on review.pulse.app.",
          exchanges: [
            {
              id: "exchange-session-binding-subject",
              order: 1,
              from: { specId: "spec-pulse", kind: "component", id: "component-summary-service" },
              to: { specId: "spec-pulse", kind: "component", id: "component-web-session-gateway" },
              contractRef: { specId: "spec-pulse", kind: "contract", id: "contract-summary-service-binding" },
              inputRefs: [{ specId: "spec-pulse", kind: "feature", id: "feature-summary-service" }],
              outputRefs: [{ specId: "spec-pulse", kind: "feature", id: "feature-web-review" }],
              failurePaths: ["Reject invalid RPC inputs, public fetch attempts, missing stored scopes, expired or revoked sessions, and unavailable private bindings without exposing a token."],
            },
            {
              id: "exchange-bound-summary-web",
              order: 2,
              from: { specId: "spec-pulse", kind: "component", id: "component-web-session-gateway" },
              to: { specId: "spec-pulse", kind: "component", id: "component-web-review" },
              contractRef: { specId: "spec-pulse", kind: "contract", id: "contract-web-session" },
              inputRefs: [{ specId: "spec-pulse", kind: "element", id: "element-web-sign-in" }],
              outputRefs: [{ specId: "spec-pulse", kind: "element", id: "element-web-summary" }],
              failurePaths: ["Render signed-out, empty, stale, unauthorized, rate-limited, or service-failed state while keeping the host-only session boundary intact."],
            },
          ],
          provenance: "decided",
        },
      ],
      specDependencies: [],
    },
    governance: {
      constraints: ["Keep iOS primary, web companion, and HealthKit read-only."],
      decisions: ["adr-healthkit-local"],
      owners: ["product", "ios", "web"],
    },
    changeSet: {
      id: "change-healthkit-review",
      current: [
        {
          id: "current-health-dashboard",
          target: { specId: "spec-pulse", kind: "component", id: "component-health-dashboard" },
          summary: "Existing dashboard shell and Sync action are present.",
          provenance: "observed",
          evidenceRefs: ["evidence-current-dashboard"],
        },
      ],
      proposed: [
        {
          id: "proposed-health-contract",
          target: { specId: "spec-pulse", kind: "contract", id: "contract-health-sample-batch" },
          summary: "Add the scoped, versioned HealthSampleBatch contract and explicit failure retention.",
          provenance: "decided",
          evidenceRefs: ["evidence-contract-decision"],
        },
        {
          id: "proposed-redacted-summary-service",
          target: { specId: "spec-pulse", kind: "component", id: "component-summary-service" },
          summary: "Add Auth0 subject validation, idempotent typed APIs, AES-GCM envelope encryption, D1 persistence, key rotation, retention, and transactional account deletion.",
          provenance: "decided",
          evidenceRefs: ["evidence-contract-decision"],
        },
        {
          id: "proposed-web-session-gateway",
          target: { specId: "spec-pulse", kind: "component", id: "component-web-session-gateway" },
          summary: "Add the same-origin Auth0 callback, revocable host-only session, CSRF boundary, and private subject-carrying service binding.",
          provenance: "decided",
          evidenceRefs: ["evidence-contract-decision"],
        },
        {
          id: "proposed-summary-keyring",
          target: { specId: "spec-pulse", kind: "component", id: "component-summary-keyring" },
          summary: "Add immutable version-addressable KEK lookup with read-old/write-current rotation and verified retirement.",
          provenance: "decided",
          evidenceRefs: ["evidence-contract-decision"],
        },
        {
          id: "proposed-summary-envelope",
          target: { specId: "spec-pulse", kind: "component", id: "component-summary-envelope" },
          summary: "Add per-record DEK wrapping, authenticated envelope persistence, tag validation, and transactional rewrap.",
          provenance: "decided",
          evidenceRefs: ["evidence-contract-decision"],
        },
        {
          id: "proposed-request-policy",
          target: { specId: "spec-pulse", kind: "component", id: "component-request-policy" },
          summary: "Add composite request idempotency and subject-scoped fixed-window rate limiting with atomic successful-POST counter, summary, and final-receipt persistence.",
          provenance: "decided",
          evidenceRefs: ["evidence-contract-decision"],
        },
        {
          id: "proposed-web-review-companion",
          target: { specId: "spec-pulse", kind: "component", id: "component-web-review" },
          summary: "Add the authenticated web companion with explicit signed-out, loading, empty, stale, unauthorized, rate-limited, and service-failed states.",
          provenance: "decided",
          evidenceRefs: ["evidence-contract-decision"],
        },
        {
          id: "proposed-summary-api-contract",
          target: { specId: "spec-pulse", kind: "contract", id: "contract-redacted-summary-api" },
          summary: "Add the public bearer publish contract plus non-public WorkerEntrypoint read/delete binding with stored-scope authorization, ownership, stable errors, idempotency, endpoint quotas, and retry semantics.",
          provenance: "decided",
          evidenceRefs: ["evidence-contract-decision"],
        },
        {
          id: "proposed-account-deletion",
          target: { specId: "spec-pulse", kind: "feature", id: "feature-account-deletion" },
          summary: "Add deliberate same-origin deletion with CSRF, private subject binding, one-transaction cleanup, 204 replay, and cross-subject isolation.",
          provenance: "decided",
          evidenceRefs: ["evidence-contract-decision"],
        },
        {
          id: "proposed-production-flow",
          target: { specId: "spec-pulse", kind: "flow", id: "flow-healthkit-dashboard" },
          summary: "Extend the current local HealthKit flow through authenticated Cloudflare production publication and subject-scoped web review.",
          provenance: "decided",
          evidenceRefs: ["evidence-contract-decision"],
        },
      ],
      verified: [
        {
          id: "verified-health-contract-fixture",
          target: { specId: "spec-pulse", kind: "contract", id: "contract-health-sample-batch" },
          summary: "The schema-v1 contract fixture round-trips without raw HealthKit identifiers.",
          provenance: "observed",
          evidenceRefs: ["evidence-contract-verified"],
        },
      ],
    },
  });
}

function incompleteSpectraSpec(): Spec {
  return SpecSchema.parse({
    schemaVersion: 3,
    id: "spec-spectra-incomplete",
    productName: "Spectra",
    productDescription: "A native campaign editor with a web review companion.",
    platformTarget: "macos",
    platformSurfaces: [
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
        featureIds: [],
        provenance: "observed",
      },
    ],
    features: [
      {
        id: "feature-editor",
        title: "Campaign editor",
        surface: "ui",
        needIds: [],
        acceptanceCriteria: [],
      },
    ],
    screens: [
      {
        id: "screen-editor",
        name: "Editor",
        purpose: "Edit a campaign.",
        featureIds: ["feature-editor"],
        states: [],
        elements: [
          { id: "element-publish", name: "Publish control", role: "primary action button" },
        ],
      },
    ],
    tests: [],
    projectContext: { startingPoint: "unspecified", sourceArtifacts: [], evidence: [] },
    uiPreferences: {},
    architecture: { components: [], contracts: [], relationships: [], flows: [], specDependencies: [] },
    governance: { constraints: ["Keep macOS primary and web companion."], decisions: [], owners: ["product"] },
    changeSet: {
      id: "change-spectra-incomplete",
      current: [],
      proposed: [
        {
          id: "proposed-guidance",
          target: { specId: "spec-spectra-incomplete", kind: "screen", id: "screen-editor" },
          summary: "Add first-run guidance.",
          provenance: "decided",
          evidenceRefs: [],
        },
      ],
      verified: [],
    },
  });
}

export function renderStandaloneHandoff(spec: Spec, visualEvidence: Record<string, string> = {}): {
  handoff: string;
  tasks: ReturnType<typeof deriveTasks>;
  buildRequest: ReturnType<typeof createBuildRequest>;
  traceability: ReturnType<typeof buildTraceability>;
} {
  const tasks = compileTaskGraph(spec, deriveTasks(spec));
  const taskDocument = renderTasks(spec, tasks);
  const traceability = buildTraceability(spec, tasks);
  const buildRequest = createBuildRequest({
    spec,
    canonicalSpecPacket: canonicalSpecPacket(spec, traceability),
    tasks,
    createdAt: "2026-08-05T12:30:00Z",
    runId: `run-${spec.id}-acceptance`,
  });
  const handoff = renderBuilderHandoff(spec, {
    docs: renderDocs(spec),
    tasks: taskDocument,
    traceability,
    visualEvidence,
  });
  return { handoff, tasks, buildRequest, traceability };
}

export const COMPLETE_VISUAL_EVIDENCE = {
  "embedded-current-baseline.md": [
    "# Sanitized observed baseline",
    "The current iOS dashboard has one Sync Health Data action, a compact last-valid summary, and permission-denied and unavailable states.",
    "No server publication, Auth0 session, or web companion exists in the observed baseline; those are proposed additions below.",
  ].join("\n"),
  "embedded-dashboard-direction.md": [
    "# Confirmed dashboard direction",
    "Compact native summary, one dominant Sync Health Data action, persistent permission explanation, and no decorative health score.",
    "The web companion preserves the same information hierarchy with pointer and keyboard interaction.",
  ].join("\n"),
};

test("F-10 standalone handoff is deterministic, complete, portable, and dependency ordered", () => {
  const spec = completeSpec();
  const visualEvidence = COMPLETE_VISUAL_EVIDENCE;
  const first = renderStandaloneHandoff(spec, visualEvidence);
  const second = renderStandaloneHandoff(spec, visualEvidence);

  assert.equal(first.handoff, second.handoff, "the public rendering pipeline must be deterministic");
  assert.match(first.handoff, /\*\*BLOCKED — RETURN TO GROUNDWORK/);
  assert.match(first.handoff, /Existing-app ownership is inferred/);
  assert.match(first.handoff, /embedded Canonical Spec and Traceability sections are authoritative copies;/);
  assert.match(first.handoff, /no `spec\.json`, `traceability\.json`, or other unstated sidecar is required/);

  const contractTask = first.tasks.find((task) => task.id === "task-contract-contract-health-sample-batch");
  const scaffoldTask = first.tasks.find((task) => task.id === "task-scaffold");
  const syncTask = first.tasks.find((task) => task.id === "task-feature-feature-health-sync");
  const reviewTask = first.tasks.find((task) => task.id === "task-feature-feature-health-review");
  const consumerScreenTask = first.tasks.find((task) => task.id === "task-screen-screen-health-dashboard");
  assert.ok(scaffoldTask && contractTask && syncTask && reviewTask && consumerScreenTask);
  assert.ok(scaffoldTask.ownedFiles.includes("package.json"));
  assert.ok(scaffoldTask.ownedFiles.includes("apps/web/playwright.config.ts"));
  assert.ok(scaffoldTask.ownedFiles.includes("services/review/src/index.ts"));
  assert.ok(scaffoldTask.dod.includes("Install: npm ci"));
  assert.ok(scaffoldTask.dod.includes("Typecheck: npm run typecheck"));
  assert.ok(scaffoldTask.dod.includes("Test: npm test && npx playwright test --config apps/web/playwright.config.ts --project=chromium"));
  assert.ok(scaffoldTask.dod.includes("Build: npm run build"));
  assert.ok(contractTask.n < syncTask.n && contractTask.n < reviewTask.n && contractTask.n < consumerScreenTask.n);
  assert.ok(syncTask.deps.includes(contractTask.n));
  assert.ok(reviewTask.deps.includes(contractTask.n));
  assert.match(first.handoff, /Implement architecture contract: Versioned health sample batch/);
  assert.match(first.handoff, /input port `port-health-request` \(syncCommand\) uses `HealthSyncCommand` and is required/);
  assert.match(first.handoff, /output port `port-health-batch` \(healthBatch\) uses `HealthSampleBatchV1` and is required/);
  assert.match(first.handoff, /Transport: in-process async Swift protocol with Codable version envelope/);
  assert.match(first.handoff, /Failure behavior: permission denied/);
  assert.match(first.handoff, /Security: never log raw samples or HealthKit identifiers/);

  assert.match(first.handoff, /WHEN HealthKit read permission is not determined, THE SYSTEM SHALL request only step-count and workout read access before starting synchronization\./);
  assert.match(first.handoff, /Acceptance test asserts: Given undetermined permission, one Sync Health Data activation requests only step-count and workout read access/);
  assert.match(first.handoff, /Framework: `XCTest`/);
  assert.ok(first.buildRequest.acceptanceCriteria.some((criterion) => criterion.id === "acceptance-health-sync"));
  assert.ok(first.buildRequest.tasks.some((task) => task.id === contractTask.id));

  assert.match(first.handoff, /Apple Developer portal > Certificates, Identifiers & Profiles > Identifiers > Pulse App ID > Capabilities/);
  assert.match(first.handoff, /Required value or permission: com\.apple\.developer\.healthkit/);
  assert.match(first.handoff, /App destination: Pulse\/Pulse\.entitlements key com\.apple\.developer\.healthkit = true and the Pulse target Signing & Capabilities tab/);
  assert.match(first.handoff, /Verify: Archive with distribution signing, then run codesign -d --entitlements :- on Pulse\.app and confirm com\.apple\.developer\.healthkit is true\./);
  assert.deepEqual(first.buildRequest.manualActions.find((action) => action.id === "manual-healthkit-capability"),
    {
      id: "manual-healthkit-capability",
      location: "Apple Developer portal > Certificates, Identifiers & Profiles > Identifiers > Pulse App ID > Capabilities",
      action: "Enable the HealthKit capability for the production App ID and regenerate the distribution provisioning profile.",
      requiredValueName: "com.apple.developer.healthkit",
      destination: "Pulse/Pulse.entitlements key com.apple.developer.healthkit = true and the Pulse target Signing & Capabilities tab",
      verification: "Archive with distribution signing, then run codesign -d --entitlements :- on Pulse.app and confirm com.apple.developer.healthkit is true.",
    });
  assert.deepEqual(first.buildRequest.manualActions.find((action) => action.id === "manual-auth0-web-client"), {
    id: "manual-auth0-web-client",
    location: "Auth0 Dashboard > Applications > Applications > Pulse Review Web > Settings",
    action: "Create a Regular Web Application, set Allowed Callback URLs to https://review.pulse.app/auth/callback, Allowed Logout URLs to https://review.pulse.app, and Allowed Web Origins to https://review.pulse.app.",
    requiredValueName: "Pulse Review Web client identifier and client secret names",
    destination: "Pulse Review Web Worker deployment settings PULSE_WEB_CLIENT_ID and PULSE_WEB_CLIENT_SECRET",
    verification: "Complete a production web login, same-origin BFF read, and logout; confirm callbacks use only https://review.pulse.app/auth/callback, the cookie never reaches api.pulse.app, and an unauthenticated GET https://review.pulse.app/api/health-summary returns 401.",
  });
  assert.deepEqual(first.buildRequest.manualActions.find((action) => action.id === "manual-auth0-ios-client"), {
    id: "manual-auth0-ios-client",
    location: "Auth0 Dashboard > Applications > Applications > Pulse iOS > Settings",
    action: "Create a Native Application and set Allowed Callback URLs to com.pulse.app://auth/callback and Allowed Logout URLs to com.pulse.app://auth/logout.",
    requiredValueName: "Pulse iOS client identifier",
    destination: "Pulse iOS build configuration value PULSE_IOS_CLIENT_ID and URL types for com.pulse.app",
    verification: "Sign in and sign out on a physical iPhone, confirm ASWebAuthenticationSession returns only through com.pulse.app://auth/callback, then publish a summary and confirm an expired or wrong-audience token returns 401.",
  });
  assert.deepEqual(first.buildRequest.manualActions.find((action) => action.id === "manual-auth0-api-resource"), {
    id: "manual-auth0-api-resource",
    location: "Auth0 Dashboard > Applications > APIs > Pulse Summary API > Settings and Permissions",
    action: "Create the Pulse Summary API resource with identifier https://api.pulse.app, enable RS256 access tokens, add publish:summary, read:summary, and delete:account permissions, enable offline_access for the Pulse iOS application, and require rotating refresh tokens with reuse detection.",
    requiredValueName: "Pulse Summary API audience and publish:summary, read:summary, delete:account, offline_access permission names",
    destination: "Pulse iOS and Pulse Review Web requested scopes plus PULSE_AUTH0_AUDIENCE and native, web-gateway, and service authorization policies",
    verification: "Inspect a native access token, confirm the issuer, audience, subject, expiry, and granted scope set, then reuse an old rotated refresh token and confirm Auth0 revokes the token family.",
  });
  assert.ok(first.buildRequest.manualActions.some((action) => action.id === "manual-auth0-session-key"
    && action.requiredValueName.includes("PULSE_SESSION_KEY_CURRENT")
    && action.destination.includes("apps/web/src/auth/session.ts")));

  assert.match(first.handoff, /Authenticated redacted summary API/);
  assert.match(first.handoff, /public HTTPS JSON v1 bearer POST \/v1\/health-summary on api\.pulse\.app for the native iOS publisher only/);
  assert.match(first.handoff, /non-public Cloudflare WorkerEntrypoint RPC methods on env\.SUMMARY_SERVICE/);
  assert.match(first.handoff, /encrypts the latest subject-owned record at rest/);
  assert.match(first.handoff, /npx playwright test apps\/web\/tests\/test-web-review-acceptance\.spec\.ts --project=chromium/);
  assert.match(first.handoff, /npm test -- --run services\/review\/test\/test-summary-service-contract\.test\.ts/);
  assert.match(first.handoff, /xcrun simctl list devices available --json/);
  assert.match(first.handoff, /-destination id=<UDID>/);
  assert.doesNotMatch(first.handoff, /<Scheme>|tokens.*live in `design-tokens\.md`|- `spec\.json` —|- `traceability\.json` —/);
  assert.match(first.handoff, /apps\/web\/src\/screens\/web-health-review\.tsx/);
  assert.match(first.handoff, /apps\/web\/tests\/test-web-review-acceptance\.spec\.ts/);
  assert.match(first.handoff, /services\/review\/test\/test-summary-service-contract\.test\.ts/);
  assert.match(first.handoff, /Pulse\/Pulse\.entitlements/);
  assert.match(first.handoff, /services\/review\/wrangler\.toml/);
  assert.match(first.handoff, /services\/review\/migrations\/0001_health_summaries\.sql/);
  assert.match(first.handoff, /services\/review\/migrations\/0002_request_controls\.sql/);
  assert.match(first.handoff, /wrapped_dek/);
  assert.match(first.handoff, /encrypt that DEK separately with AES-256-GCM/);
  assert.doesNotMatch(first.handoff, /AES-KW/);
  assert.match(first.handoff, /PULSE_SUMMARY_KEK_V1/);
  assert.match(first.handoff, /PULSE_SUMMARY_ACTIVE_KEK_VERSION/);
  assert.match(first.handoff, /Payload AAD binds only immutable subject_hash, schemaVersion, and summaryVersion/);
  assert.match(first.handoff, /wrapping AAD separately binds keyVersion/);
  assert.match(first.handoff, /decrypt the unchanged payload successfully after rewrap/);
  assert.match(first.handoff, /primary key\(subject_hash,endpoint,idempotency_key\)/);
  assert.match(first.handoff, /atomically commits the successful POST counter, encrypted summary upsert, and final replay receipt/);
  assert.match(first.handoff, /fault injection proves no partial counter, summary, or receipt survives/);
  assert.match(first.handoff, /60 publish attempts per 15 minutes/);
  assert.match(first.handoff, /300 GET BFF attempts per subject per 15 minutes/);
  assert.match(first.handoff, /5 DELETE BFF attempts per subject per 24 hours/);
  assert.match(first.handoff, /primary key\(subject_hash,endpoint,window_start\)/);
  assert.match(first.handoff, /deletion_receipts with primary key\(session_hash,endpoint,idempotency_key_hash\)/);
  assert.match(first.handoff, /cookie-valid 8-hour window/);
  assert.doesNotMatch(first.handoff, /exact 24-hour (?:deletion_receipts|session-hash-plus-key|cookie\/key) replay/);
  assert.match(first.handoff, /non-public Cloudflare WorkerEntrypoint RPC/);
  assert.doesNotMatch(first.handoff, /X-Pulse-Binding-Version|opaqueSubject/);
  assert.match(first.handoff, /Implement API `DELETE \/api\/account`/);
  assert.match(first.handoff, /package-lock\.json/);
  assert.match(first.handoff, /npx wrangler d1 migrations apply pulse-review-prod --remote --config services\/review\/wrangler\.toml/);
  assert.match(first.handoff, /\*\*Code-owned local\/ephemeral verification:\*\*/);
  const preflightSpec = spec.tests.find((candidate) => candidate.id === "test-code-owned-release-preflight")!;
  assert.doesNotMatch(preflightSpec.command!, /--remote|d1 create|deploy-production|verify-production|production smoke/i);
  assert.match(preflightSpec.command!, /d1 migrations apply pulse-review-prod --local/);
  const releaseAction = first.buildRequest.manualActions.find((action) => action.id === "manual-cloudflare-production-release")!;
  assert.match(releaseAction.action, /approve the production release/);
  assert.match(releaseAction.verification, /deploy-production\.mjs/);
  assert.match(releaseAction.verification, /verify-production\.mjs/);
  assert.match(releaseAction.verification, /authenticated iOS-to-web production smoke/);
  assert.match(first.handoff, /node scripts\/ios-preflight\.mjs --suite health-sync/);
  assert.match(first.handoff, /node scripts\/ios-preflight\.mjs --suite auth0/);
  assert.match(first.handoff, /node scripts\/ios-preflight\.mjs --suite all/);
  assert.doesNotMatch(first.handoff, /platform=iOS Simulator,name=iPhone 16/);
  assert.deepEqual(first.tasks.filter((task) => task.ownedFiles.includes("scripts/ios-preflight.mjs")).map((task) => task.id), ["task-integration-integration-healthkit"]);
  assert.deepEqual(first.traceability.coverageGaps, []);
  assert.deepEqual(first.traceability.featureToApis["feature-account-deletion"], ["api-delete-account"]);
  assert.ok(first.traceability.featureToTests["feature-account-deletion"].includes("test-account-deletion"));

  const summaryContractTask = first.tasks.find((task) => task.id === "task-contract-contract-redacted-summary-api")!;
  const summaryServiceTask = first.tasks.find((task) => task.id === "task-component-component-summary-service")!;
  const webComponentTask = first.tasks.find((task) => task.id === "task-component-component-web-review")!;
  const gatewayTask = first.tasks.find((task) => task.id === "task-component-component-web-session-gateway")!;
  const keyringTask = first.tasks.find((task) => task.id === "task-component-component-summary-keyring")!;
  const envelopeTask = first.tasks.find((task) => task.id === "task-component-component-summary-envelope")!;
  const requestPolicyTask = first.tasks.find((task) => task.id === "task-component-component-request-policy")!;
  const authIntegrationTask = first.tasks.find((task) => task.id === "task-integration-integration-review-oidc")!;
  const cloudflareIntegrationTask = first.tasks.find((task) => task.id === "task-integration-integration-cloudflare-production")!;
  const apiTasks = first.tasks.filter((task) => ["task-api-api-publish-summary", "task-api-api-read-summary", "task-api-api-delete-account"].includes(task.id));
  assert.equal(apiTasks.length, 3);
  for (const task of apiTasks) {
    assert.ok(task.deps.includes(summaryContractTask.n));
    assert.ok(task.deps.includes(summaryServiceTask.n));
  }
  const readApiTask = apiTasks.find((task) => task.id === "task-api-api-read-summary")!;
  assert.ok(!readApiTask.deps.includes(webComponentTask.n));
  const deleteApiTask = apiTasks.find((task) => task.id === "task-api-api-delete-account")!;
  assert.ok(deleteApiTask.deps.includes(gatewayTask.n));
  assert.ok(deleteApiTask.deps.includes(requestPolicyTask.n));
  assert.ok(summaryServiceTask.deps.includes(authIntegrationTask.n));
  assert.ok(summaryServiceTask.deps.includes(cloudflareIntegrationTask.n));
  assert.ok(!summaryServiceTask.deps.includes(gatewayTask.n));
  assert.ok(summaryServiceTask.deps.includes(envelopeTask.n));
  assert.ok(summaryServiceTask.deps.includes(requestPolicyTask.n));
  assert.ok(envelopeTask.deps.includes(keyringTask.n));
  assert.ok(webComponentTask.deps.includes(authIntegrationTask.n));
  assert.ok(webComponentTask.deps.includes(cloudflareIntegrationTask.n));
  assert.ok(webComponentTask.deps.includes(gatewayTask.n));
  assert.ok(!webComponentTask.deps.includes(summaryServiceTask.n));
  assert.ok(gatewayTask.deps.includes(summaryServiceTask.n));
  const productionTask = first.tasks.find((task) => task.id === "task-test-test-code-owned-release-preflight")!;
  const iosScreenTask = first.tasks.find((task) => task.id === "task-screen-screen-health-dashboard")!;
  assert.ok(productionTask.deps.includes(authIntegrationTask.n));
  assert.ok(productionTask.deps.includes(cloudflareIntegrationTask.n));
  assert.ok(productionTask.deps.includes(iosScreenTask.n));
  for (const testId of preflightSpec.dependsOnTestIds) {
    const prerequisite = first.tasks.find((task) => task.id === `task-test-${testId}`)!;
    assert.ok(productionTask.deps.includes(prerequisite.n));
  }
  assert.deepEqual(
    first.traceability.taskDependencies[productionTask.id].filter((id) => id.startsWith("task-test-")).sort(),
    preflightSpec.dependsOnTestIds.map((id) => `task-test-${id}`).sort(),
  );
  assert.ok(first.traceability.architectureFlowToTasks["flow-web-authenticated-review"].includes(gatewayTask.id));
  assert.ok(first.traceability.architectureFlowToTasks["flow-web-authenticated-review"].includes(summaryServiceTask.id));
  assert.ok(first.traceability.architectureFlowToTasks["flow-web-authenticated-review"].includes(webComponentTask.id));
  const taskByNumber = new Map(first.tasks.map((task) => [task.n, task]));
  for (const task of first.tasks) {
    assert.ok(task.deps.every((dependency) => dependency < task.n), `${task.id} has a non-prior dependency`);
    assert.deepEqual(
      first.buildRequest.tasks.find((candidate) => candidate.id === task.id)?.dependsOn,
      task.deps.map((dependency) => taskByNumber.get(dependency)!.id),
    );
  }

  assert.match(first.handoff, /\*\*Sync Health Data button\*\* _\(primary action button\)_ — dataIn: fetched \(`HKAuthorizationStatus`\).*dataOut: HealthKit synchronization command and inline status \(`HealthSyncCommand`\)/);
  assert.doesNotMatch(first.handoff, /DEAD-CONTROL RISK/);
  assert.match(first.handoff, /### embedded-dashboard-direction\.md/);
  assert.match(first.handoff, /Compact native summary, one dominant Sync Health Data action/);
  assert.match(first.handoff, /Existing dashboard shell and Sync action are present\./);
  assert.match(first.handoff, /Add the scoped, versioned HealthSampleBatch contract and explicit failure retention\./);
  assert.match(first.handoff, /The schema-v1 contract fixture round-trips without raw HealthKit identifiers\./);

  assert.doesNotMatch(first.handoff, /\/(?:Users|home|tmp|private|Volumes|var\/folders)\//);
  assert.doesNotMatch(first.handoff, /[A-Za-z]:\\(?:Users|Temp)\\/);
  assert.doesNotMatch(first.handoff, new RegExp(PRIVATE_REPO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(first.handoff, /path redacted; (?:inspect|use)/);
  assert.doesNotMatch(first.handoff, /<target-repository>|<local-path>/);
});

test("F-10 incomplete Spectra-like definition is blocked rather than mislabeled ready", () => {
  const { handoff } = renderStandaloneHandoff(incompleteSpectraSpec());
  assert.match(handoff, /\*\*BLOCKED — RETURN TO GROUNDWORK BEFORE CLAIMING NEAR-PRODUCTION READINESS\.\*\*/);
  assert.doesNotMatch(handoff, /\*\*READY FOR BUILD:\*\*/);
  assert.match(handoff, /Starting point is unresolved/);
  assert.match(handoff, /No executable acceptance criteria are captured/);
  assert.match(handoff, /No acceptance, smoke, unit, or manual tests are captured/);
  assert.match(handoff, /1 interactive element\(s\) have no declared data input or output/);
  assert.match(handoff, /No confirmed UI preference or embedded visual evidence is captured/);
});

test("F-10 clean-sheet definitions require exact bootstrap files and commands", () => {
  const value = structuredClone(completeSpec()) as Spec;
  value.projectContext.startingPoint = "initial-idea";
  delete value.projectContext.bootstrap;
  const { handoff } = renderStandaloneHandoff(SpecSchema.parse(value), COMPLETE_VISUAL_EVIDENCE);
  assert.match(handoff, /Clean-sheet bootstrap files and exact install, typecheck, test, and build commands are unresolved/);
  assert.match(handoff, /TAG:UNRESOLVED — capture exact bootstrap files/);
});

test("F-10 explicit test dependencies fail closed on cycles", () => {
  const value = structuredClone(completeSpec()) as Spec;
  value.tests[0]!.dependsOnTestIds = [value.tests[1]!.id];
  value.tests[1]!.dependsOnTestIds = [value.tests[0]!.id];
  const parsed = SpecSchema.parse(value);
  assert.throws(() => compileTaskGraph(parsed, deriveTasks(parsed)), /Task dependency cycle/);
});
