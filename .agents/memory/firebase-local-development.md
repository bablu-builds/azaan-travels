---
name: Firebase local development
description: Local verification must not store or request Firebase credentials in Replit.
---

Use the repository's demo/mock mode for local development and verification when Firebase credentials are unavailable.

**Why:** The user explicitly requires Firebase credentials, production settings, and deployment controls to remain outside Replit.

**How to apply:** Do not request or add Firebase secrets, service-account files, or production credentials. Preserve real Firebase mode in the code, but use `VITE_DEMO_MODE=true` for local runtime checks.