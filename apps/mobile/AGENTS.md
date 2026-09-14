# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Source architecture

- `src/app` owns Expo Router routes and composes feature modules; keep substantial behavior out of route files.
- `src/features` owns domain UI and its private implementation. Run UI belongs under `features/runs`; other domain modules use their own feature folder.
- `src/components/layout` owns the application shell that composes features.
- `src/components/ui` contains feature-agnostic UI modules. Import them through the `@/components/ui` barrel; they may not depend on `features`, `backend`, or `db`.
- `src/lib` contains lower-level shared implementation and may not depend on `components` or `features`.
