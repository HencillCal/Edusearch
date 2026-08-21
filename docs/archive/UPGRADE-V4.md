# EduSearch AI V4 — Institution and Private Libraries

## Added in this step

1. Institution libraries
   - Users can create libraries for universities, colleges, TVETs, departments, classes and study groups.
   - Libraries can be public or private.
   - Public libraries are discoverable without an account.

2. Secure membership
   - New libraries receive a random join code.
   - Only the SHA-256 hash is stored in SQLite.
   - Owners can rotate the join code; the old code stops working immediately.
   - Membership roles are owner, editor and viewer.
   - Owners can promote, demote or remove members.

3. Private document enforcement
   - Restricted documents do not appear in anonymous search, home lists, recommendations or related results.
   - Preview, download, save, rate, report and collection operations use the same access policy.
   - Members regain search and viewer access immediately after joining.
   - Administrators retain moderation access.

4. Library document operations
   - Uploads can target a library.
   - Uploaders choose public or members-only visibility.
   - Owners and editors can add existing documents without copying the file.
   - Removing a primary private document returns it to an unpublished state instead of exposing it publicly.

5. Administration and auditing
   - Dashboard metrics include total and private libraries.
   - A recent audit feed records library creation, updates, joins, code rotation, role changes and document operations.
   - A dedicated `/api/admin/audit` endpoint supports administrative review.

6. Compatibility
   - Existing databases are migrated in place with `visibility` and `library_id` document columns.
   - Existing documents default to public.
   - Existing accounts, searches, OCR jobs and moderation data are preserved.

## Validation performed

- 83 application TypeScript/TSX files passed syntax transpilation.
- Fresh SQLite schema creation and in-place document-column migration passed.
- Anonymous private-document search and viewer access were denied.
- Mixed public/member-only libraries hide restricted titles and document counts from non-members.
- Cross-library restricted-document attachment and stale-link exposure were denied.
- Owner and joined-member access passed.
- Join codes, role promotion, immediate member revocation and audit logging passed.
- Restricted-document removal removed the FTS entry and returned the document to `approved` status.
