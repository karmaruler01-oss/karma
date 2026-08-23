# Backend Handoff

This package contains the backend/server-side code and database migration definitions extracted from the uploaded project archive.

## Important limitation
The ZIP contains schema/migration definitions and server code, but it does NOT contain the live Supabase database contents, existing users, OAuth tokens, or storage objects. Those live in the Supabase project and must be preserved or migrated separately.

## Database
`supabase/migrations/` contains the current migration present in the uploaded project.

## Storage
The schema contains policies for the private `productions` bucket. The actual bucket/files are live Supabase resources and are not embedded in this ZIP.

## YouTube
OAuth/server routes and stores are included. Real secrets are intentionally excluded.

## Environment
See `ENVIRONMENT.template`. Never commit real secrets.
