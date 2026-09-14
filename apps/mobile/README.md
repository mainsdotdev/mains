# mobile

Expo/React Native client for controlling a Mains desktop backend from iOS. Android support is planned for a later release.

## Requirements

- Node 24.20.0 (see `.node-version` or `.nvmrc`)
- npm
- An Expo account for cloud builds
- Xcode when building the app locally

## Development

Install dependencies and verify the project:

```bash
npm install
npm run doctor
npm run typecheck
npm run lint
```

The app uses a custom development client rather than Expo Go:

```bash
npm run build:development
npm start
```

For local native builds:

```bash
npm run ios
```

## App variants

| Profile | App name | Identifier | Update channel |
|---|---|---|---|
| `development` | Mains Dev | `dev.mains.mobile.dev` | `development` |
| `preview` | Mains Preview | `dev.mains.mobile.preview` | `preview` |
| `production` | Mains | `dev.mains.mobile` | `production` |

Development and preview builds permit plain local-network traffic for connecting to a Mac over LAN. Production expects a secure `wss://` endpoint such as Tailscale HTTPS.

## EAS setup

Authenticate once and link this repository to an Expo project:

```bash
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest update:configure
```

Then create builds with:

```bash
npm run build:development
npm run build:preview
npm run build:production
```

After Apple submission credentials are configured, build and upload the App Store binary with:

```bash
npm run release
```

`release` uploads the binary to App Store Connect; it does not bypass TestFlight, store metadata, or app review.

## Native project policy

This project uses Expo Continuous Native Generation. The `ios/` directory is generated and ignored. Keep native configuration in `app.config.ts` or config plugins so a clean prebuild remains reproducible.

## Architecture report

The comparison with T3 Code, the gaps in the desktop backend, and the proposed
delivery plan live in [`docs/architecture-report.md`](docs/architecture-report.md).

## Current vertical slice

The initial shell includes the connection empty state and a real QR camera surface. It validates and redacts a Mains pairing URL but intentionally does not persist its token until the backend's device-session exchange is implemented.
