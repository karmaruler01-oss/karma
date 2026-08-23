GITHUB UPLOAD PACKAGE

This package is prepared for uploading the project source to a GitHub repository.

IMPORTANT:
- Do NOT commit real API keys, OAuth client secrets, Supabase service-role keys,
  passwords, or other credentials.
- Use .env.example/.env.template files as templates and configure secrets on
  the eventual hosting/deployment platform.
- This package contains source code and configuration; it does NOT by itself
  deploy the backend or create a persistent database.
- Keep this ZIP as a backup before making changes.

Recommended GitHub destination:
karmaruler01-oss/karma

After upload, the next step is deploying the server/backend from this repository
and then configuring each Lovable frontend to call that backend.
