# Azaan Travels — Website + Android

Cleaned project prepared for the `bablu-builds/azaan-travels` GitHub repository.

## Included
- React/Vite website UI
- `src/` application code
- `public/` assets
- Capacitor Android project (`android/`)
- Firebase client integration code with environment-variable placeholders
- Demo/mock Firebase mode
- Build configuration

## Intentionally excluded
- Database files / Firestore rules
- Firebase project deployment configuration
- `.env` secrets
- `node_modules`
- generated build output
- Replit workspace metadata

## Run
```bash
pnpm install
pnpm dev
```

## Android
```bash
pnpm build
npx cap sync android
cd android
./gradlew assembleDebug
```

On Windows:
```powershell
cd android
gradlew.bat assembleDebug
```

Set real Firebase values only in a local `.env` when the new database is ready.
