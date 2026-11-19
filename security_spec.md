# Security Specification & Payload-First TDD (`security_spec.md`)

## 1. Data Invariants
1. **Strict Tenant Isolation**: Every organization document belongs to a single verified Firebase Auth user (`ownerId == request.auth.uid`). No user may read, list, create, update, or delete another user's organization or any nested subcollection.
2. **Master Gate Hierarchy**: Every subcollection document (`projects`, `sources`, `chunks`, `mcps`, `traces`) validates parent ownership via `get()` on the parent organization/project during single-document operations (`get`, `create`, `update`, `delete`), and validates `resource.data.ownerId == request.auth.uid` on `list` queries without `get()` fan-out.
3. **Immutable Lineage & Temporal Integrity**: `ownerId`, `orgId`, `projectId`, `sourceId`, and `createdAt` cannot be altered after creation. All `createdAt` / `updatedAt` timestamps must equal `request.time`.
4. **Immutable Audit Traces**: `TraceLog` documents in `/traces/{traceId}` are append-only (`update` is always denied; only `create`, `get`, `list`, `delete` by verified owner are permitted).
5. **Bounded Payloads & Strict Schemas**: Every string enforces explicit `.size()` limits, every ID path variable enforces `isValidId()`, every array enforces explicit `.size() <= MAX` bounds, and every write enforces exact `keys().hasAll(...)` + `keys().hasOnly(...)` or `affectedKeys().hasOnly(...)`.

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Return PERMISSION_DENIED)
1. **Identity Spoofing on Org Create**: `ownerId` set to another user's UID (`"victim-uid"`).
2. **Unverified Email Write**: Authenticated token with `email_verified: false` attempts to create an organization.
3. **Ghost Field Shadow Injection**: Organization create includes extra undeclared key `isAdmin: true`.
4. **ID Poisoning**: Creating `/organizations/a..very..long..invalid..id$%` violating `^[a-zA-Z0-9_-]+$` or exceeding 128 chars.
5. **Blanket List Scraping**: Listing `/organizations` without filtering to `ownerId == request.auth.uid` (returns another user's org).
6. **Orphaned Project Creation**: Creating `/organizations/{nonExistentOrg}/projects/{projectId}` where parent org does not exist.
7. **Cross-Tenant Project Read**: User B attempts `get` on User A's `/organizations/{orgA}/projects/{projA}`.
8. **Immutable Field Tampering**: Updating a project to change `ownerId`, `orgId`, or `createdAt`.
9. **Client Timestamp Forgery**: Creating a project with a backdated client timestamp (`createdAt != request.time`).
10. **Value Poisoning on Update**: Updating `project.status` to an invalid value `"hacked"` or a 10KB string.
11. **Array Exhaustion Attack**: Creating a `KnowledgeChunk` with `embedding` list length > 1024 or `TraceLog` with `citations` length > 10.
12. **Trace Log Tampering**: Attempting to `update` an existing `TraceLog` document to falsify latency or status code.
