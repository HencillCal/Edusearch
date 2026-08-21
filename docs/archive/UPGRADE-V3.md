# EduSearch AI V3 Upgrade

## Added in this step

1. Personalized recommendations
   - Uses saved documents, recent downloads, followed topics and successful searches.
   - Excludes already-saved documents where possible.
   - Falls back to popular and recent material for new accounts.

2. Topic following
   - Users can follow or unfollow topics from the Subjects page.
   - Topic names are matched case-insensitively and stored using the canonical taxonomy name where available.

3. Notifications
   - Database-backed unread/read state.
   - Welcome notification for new accounts.
   - Contributor alerts for document approval, rejection and requested changes.
   - Alerts when a new document is published in a followed topic.
   - Report-resolution notifications for authenticated reporters.

4. Ratings and trust
   - One 1–5 rating per user per document.
   - Users can update an existing rating.
   - Average rating and rating count are calculated from persisted votes.

5. Document reports
   - Supports copyright, wrong document, missing pages, poor quality, incorrect OCR, personal information, malware and other reasons.
   - Reports move through open, reviewing, resolved or dismissed states.

6. Administrator operations
   - Open-report queue with resolve and dismiss actions.
   - Subject creation.
   - Topic creation with parent subject, synonyms and related topics at API level.
   - Dashboard metric for unresolved reports.

7. Compatibility
   - Existing accounts and documents are preserved.
   - New SQLite tables are created automatically on startup.
   - Existing FTS search and OCR workflows are unchanged.

## Validation performed

- All 82 TypeScript/TSX source files passed syntax transpilation.
- New SQLite tables passed live insertion and relationship tests.
- API smoke tests passed for registration, sessions, topic following, recommendations, ratings, reports, report resolution, taxonomy creation, moderation notifications and FTS publication.
- Followed-topic publication notifications were tested with a separate uploader and follower account.

## Local verification

After installing dependencies, run:

```bash
npm run setup
npm run check
npm run dev
```

The package registry available in the build workspace returned HTTP 503, so the dependency-resolved Vite build must be run on the destination machine.
