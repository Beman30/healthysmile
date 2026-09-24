# Assigned beta accounts

The application supports assigned usernames and generated passwords. There is no public registration. Each tester is assigned a new studio UUID and an empty archive. Only the original owner can initialize the single administrator, using a verified Cloudflare Access JWT and their existing active owner membership.

## Activation order

1. Deploy while Cloudflare Access is still enabled.
2. The owner opens `/account` through their existing Cloudflare login, chooses a username, and selects **Crea il mio account**. Save the generated credentials. This preserves the existing studio and patients. The new administrator session is established automatically.
3. Create tester accounts from the same page and copy each username/password. Credentials are displayed once. The administrator can reset tester passwords or suspend access; either operation immediately invalidates their sessions.
4. Only after the administrator credentials have been saved, remove the Cloudflare Access gate for **this Worker only**. Do not remove other Access applications, D1/R2 bindings or data. The application now protects patient APIs and private app scripts with its own session cookie; installation/login pages and icon/manifest assets are deliberately public.
5. Test in a fresh browser: `/installa` opens without a Cloudflare email code, an installed launch shows the app login, anonymous patient API requests fail, and a tester sees only its empty archive.

`BOOTSTRAP_ADMIN_EMAIL` identifies the original owner. It is not a secret and is not sufficient to initialize an administrator: a signed Access identity and the matching owner membership must also be verified. Legacy signed Access sessions remain valid during transition. Keep the existing Access variables while doing the setup. Removing the Access edge application requires dashboard access; a successful GitHub deployment does not remove that edge gate.

New `hs_accounts`, `hs_sessions`, and `hs_login_limits` tables are created idempotently on first account setup/login using a D1 batch. Existing studios, patients, images and R2 objects are not rewritten. Account creation uses a transaction so duplicate usernames do not leave orphan studios.

## Credential and session model

- All passwords are generated on the server with 192 bits of cryptographic randomness and stored only as SHA-256 hashes, like random API tokens. There is intentionally no user-chosen password endpoint. Adding one requires a proper password KDF and revised tests.
- Sessions contain 256 random bits; only their hashes are stored. Cookies are `__Host-`, Secure, HttpOnly, SameSite=Lax, with an absolute 24-hour expiry. Every request checks active account and studio state.
- Mutations require same-origin requests and the existing explicit write header. Login limits are persisted in D1 per IP and username. Passwords, session cookies and hashes are not included in account lists.
- No default password, public first-user bootstrap, client-supplied studio selector, or permanent shared beta password exists.
- The installation gate is a user-interface requirement, not an authorization boundary. APIs always enforce server-side account/studio authorization.

## Checks

`npm test` covers bootstrap, rate limiting, CSRF, sessions, account revocation and patient isolation. `tests/accounts-browser.cjs` tests the real browser login/administration flow with synthetic data; `tests/mobile-browser.cjs` verifies the installed photo workflow and the browser installation gate.
