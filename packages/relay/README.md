# Shared relay endpoint

React Native/Node-compatible endpoint cryptography and a WebSocket adapter for
the private Go gateway in `../../apps/relay`. There is no host runtime, native
module or application permission policy here. Native platforms supply their
own cryptographically secure random generator.

Run `npm install` here before installing consumers, then `npm test`. Plain
TypeScript source is linked into the backend and mobile app; there is no build.
The host and mobile type checks also check this source. Wire DTOs belong to
`@mains/contracts/relay`. See the gateway README for setup and protocol details.
