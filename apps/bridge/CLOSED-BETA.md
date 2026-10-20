# Closed beta access

Bridge identity signup/sign-in remains available through GitHub or verified
email. Creating an identity never grants beta access or upload permission.
An operator chooses an exact email address. The invitation can exist before
that person creates an account. Only a session with that verified mailbox can
see **Activate beta**; other accounts see a generic access-unavailable page.
That page shows the verified email of the signed-in account beside the account
switch action, so someone using the wrong account can identify it.
Public sign-in, create-account and password-reset pages do not advertise beta.

The user starts from Settings → Bridge → Sign in. After sign-in:

1. A selected, unactivated account sees its invitation. Merely opening this page
   or signing in does not consume any time.
2. **Activate beta** atomically binds the invitation to its account ID and starts
   exactly 30 × 24 hours, using the server clock. The normal device-code or
   desktop state/PKCE callback continues afterwards.
3. The existing device approval/recovery ceremony still protects encryption
   keys. Beta access never bypasses it.
4. Settings shows **Beta access** and the expiry in the user's local timezone,
   with the standard plan's storage/file limits and no purchase options.
5. At expiry, new encrypted record writes and R2 uploads pause, including on
   existing WebSockets and previously signed PUT URLs. Reading, downloading,
   deletion and account-key recovery remain available. Local changes stay queued.

Activation is idempotent. Repeated clicks, login retries, a second device or
re-inviting an activated account never restart or extend its period. No payment
provider, automatic renewal or public waitlist exists. A remote invite emails the
selected person once: the steps (install Mains, sign in with this exact address,
choose **Activate beta**) and a link to mains.dev, but no link that signs in, so no
shareable invite code or secret exists. A GitHub account must expose that same verified email to the
authentication provider. Plus aliases and dots are not collapsed.

## Account email

Resend's free tier allows 100 emails a day across staging and production together,
so every account email (sign-in link, verification, password reset, invitation)
passes one policy in `src/auth-mail.ts`:

- Any address can sign up and sign in by email; Bridge access is gated after
  sign-in, by invitation. A sign-up appears in the `user` table, where the operator
  picks whom to invite.
- An address receives at most 3 emails an hour; further requests are skipped
  silently.
- Each hub sends at most 10 emails a UTC day. Past that, every request, for any
  address, is refused with "Email is paused for today", and the sign-in-link form
  shows it. GitHub sign-in needs no email and keeps working.
- Verification mail goes out at sign-up and again when an unverified address tries
  its password. The limits above bound how often.

`BRIDGE_MAIL_POLICY=unrestricted` lifts all of this for tests and local development
only; `production:check` refuses it in either deployed configuration.

## Operator commands

Run commands from `apps/bridge`. The default is **local D1**, with all migrations
applied locally. Use a disposable config/store for acceptance tests.

```sh
npm run beta -- invite --email tester@example.com
npm run beta -- list
npm run beta -- show --email tester@example.com
npm run beta -- extend --email tester@example.com --expires-at 2026-12-01T12:00:00Z
npm run beta -- revoke --email tester@example.com
```

- `invite` inserts a pending invitation with no start/expiry and is safe to retry.
  It can reopen a cancelled **unactivated** invitation. It never reopens an
  activated/revoked/expired grant. A remote invite then emails the invitation
  through the Worker's private `BridgeOperations.sendBetaInvite`, so the Resend key
  never leaves the Worker; `mailed_at` records it and a retry sends nothing more.
  `--resend` sends it again, `--no-mail` skips it, and an invitation already
  active or revoked gets no mail. The email counts toward the limits above; when
  the day's limit is reached, run the same command again the next day. Local
  invites are never emailed.
- `extend` requires an already activated grant and a later, explicit future end
  timestamp including a timezone. It preserves the original start, can restore
  a revoked grant and does not change an unchanged row when retried.
- `revoke` pauses beta uploads without deleting identity, keys, files or the
  original activation/expiry. An active manual/paid subscription still permits
  uploads; revoking beta never revokes a separate subscription.
- `list` returns at most 100 entries. Use `--after LAST_EMAIL` for the next page.
  Dates in the operator output are Unix milliseconds; zero changed rows means
  no new grant/extension was applied. `show` exposes no credentials or keys.
- Local commands accept `--config PATH --persist-to DIRECTORY`. They reject
  live-account configs and always pass `--local` to Wrangler.

Remote commands require **both** `--remote` and an explicit environment. Config,
account and Wrangler profile are pinned to the existing isolated environment:

```sh
npm run beta -- invite --email tester@example.com --environment staging --remote
npm run beta -- invite --email tester@example.com --environment production --remote
```

These examples are rollout instructions; implementation/local acceptance does
not execute them. There is no public invite/list/extend/revoke HTTP endpoint.
Remote operator commands use D1's query API, including for writes; they do not
start a bulk SQL import or put the database into import mode.
Operator changes are observed within the existing 60-second subscription cache.
Activation invalidates its own cache immediately. Exact expiry is checked on
every use of a cached grant. No cron job, R2 write or per-frame D1 query is needed.

## Data and rollout

Migration `0005_closed_beta.sql` only adds `bridge_beta_invites`, indexed by email
and account ID. Existing users, subscriptions, device credentials, recovery
wraps, account hubs and R2 objects are unchanged. An active paid/manual grant
takes precedence over beta. Existing initialized account owners can still sign
in for read/recovery access without an invitation; they receive no new upload
rights. Old pending credentials cannot bootstrap an uninvited account.
Migration `0007_beta_invite_mail.sql` adds the nullable `mailed_at` column; mail
counters reuse `bridge_limits`.

For each authorized rollout: take and verify the normal environment backup,
apply pending D1 migrations **before** deploying the hub, deploy the compatible
desktop/web renderer, then add only the selected invitations. No invitations or
entitlements are seeded by the migration. Production and staging use their own
tables, resources and operator profiles.

Closed beta first reached production on 2026-10-16 with migration
`0005_closed_beta.sql`, Worker version
`6891a4e1-5f83-44f8-9e5a-608f9fd3c69b`. A verified environment backup and
code-rollback plan were saved before deployment. Staging was not changed.
Production acceptance confirmed:

- A verified account without an invitation sees the generic unavailable page,
  without beta copy or an activation button.
- Adding its exact email reveals the invitation without setting activation or
  expiry timestamps. Clicking **Activate beta** starts exactly 30 days and
  continues to device authorization.
- Re-inviting the activated account changes no rows and preserves both dates.
- A separate verified, uninvited identity sees the same unavailable page and
  has no subscription or upload permission.

After acceptance, all original identity, device, key-wrap and entitlement rows
matched the pre-release backup. All three existing ciphertext objects retained
their original ETags and lengths. The test did not modify Mac profiles.

Private rollout receipts stay in the ignored `.wrangler` directory; account
identifiers, email addresses and authentication material do not belong here.

Staging acceptance on 2026-10-16 used a separate verified email identity and two
empty backend profiles. The invitation had no activation or expiry timestamps
until **Activate beta** was clicked. Activation started exactly 30 days; signing
in on the second profile and re-inviting the active account preserved both dates.
The app showed **Beta access**, its expiry and the standard storage/file limits.
Before device-key approval, the second profile could not receive shared content.
After approval, acceptance covered Atlas edits in both directions, a synthetic
chat and three tool records (including large encrypted values), a file downloaded
from R2 with its source offline, deletion propagation and restart/catch-up on both
profiles. Both outboxes drained. All original auth/Bridge rows and 12 existing
ciphertext objects matched the verified pre-test backup; production and canonical
Mac profiles were not changed. Private receipts are in
`.wrangler/staging-beta-acceptance/`.

D1 exports already include the full new table, including original activation
and expiry. Keep it in backup/restore reconciliation so a recovery does not
restart beta periods. Restoring an older pre-beta backup requires applying the
additive migration before using this hub version. A code-only rollback can leave
the additive table in place, but a pre-beta hub lacks the enrollment gate; prefer
a forward fix rather than reopening new Bridge enrollment during a beta incident.
