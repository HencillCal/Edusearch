# EduSearch AI V13 — Production Administration

V13 turns the existing operational dashboard into a complete management surface while retaining the V12 OCR and visual reconstruction pipeline.

## Administrator accounts

- List users and administrators with contribution and owned-library counts.
- Create either a normal account or administrator account with a temporary password.
- Edit names, email addresses, roles and passwords.
- Promote users and demote administrators.
- Delete accounts while transferring their owned libraries to the acting administrator.
- Prevent the current administrator from deleting or demoting their own account.
- Prevent removal of the final administrator.
- Revoke existing sessions after password or role changes.

## Content operations

- View all documents, not only pending submissions.
- Edit document title, subject and description while refreshing the search index.
- Publish, archive or permanently delete a document.
- Delete stored document and preview files only when their paths remain inside the configured data directory.
- Update contact-message states to in progress, resolved or spam.

## Collections and libraries

- Open a collection and view its current documents.
- Rename and delete collections with duplicate-name protection.
- Remove a document from a collection without unsaving the original document.
- Edit library name, institution and description.
- Rotate join codes with explicit confirmation.
- Delete a library while archiving its private documents to avoid accidental public exposure.
- Confirm member and document removal actions.

## Taxonomy

- Create, edit and delete topics.
- Create, edit and delete subjects.
- Rename linked document subjects deliberately.
- Block subject deletion while documents still depend on it.

## Compatibility

No destructive database migration is required. The upgrade uses the existing SQLite schema, audit log, session tables and role values. Existing V12 data remains compatible.
