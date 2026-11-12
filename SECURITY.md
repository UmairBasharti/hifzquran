# Security policy

## Supported versions

Only the latest commit on `main` is maintained.

## Reporting a vulnerability

Please do not open a public issue with the details of a security problem.

Use GitHub's private reporting: open the **Security** tab of this repository and choose **Report a vulnerability**, if it is enabled. If you do not see it, open an issue that says only that you have a security report, and no details, and the maintainer will arrange a private way to receive it.

Include what you found, the steps to reproduce it and the version (commit) you tested.

## How HifzAI handles your data

- **Audio is never stored.** Microphone audio goes to the backend over a WebSocket, is turned into text in memory and is discarded straight away. It is not written to disk, a database or a log.
- **Logs stay free of recitation.** A debug mode (`DEBUG_ASR=1`) can print chunk sizes, signal level and the recognised text for local development. It is off by default and never logs audio.
- **Saved sessions are anonymous.** If you connect Supabase, a finished session is stored as counts and word outcomes only. There are no accounts, names or e-mail addresses. See [docs/DATABASE.md](docs/DATABASE.md).

## What protects the backend

- **Origin allow-list.** The WebSocket refuses a connection (close code `1008`) whose `Origin` header is not in `ALLOWED_ORIGINS`, and CORS uses the same list. Set `ALLOWED_ORIGINS` in `backend/.env` for your deployment. The built-in default covers `localhost` and a few named hosts, so review it before exposing a backend publicly.
- **Capacity cap.** At most `MAX_CONCURRENT_SESSIONS` (default 10) recitation sessions run at once. Extra clients get a `CAPACITY_ERROR` and close code `1013`, so a burst cannot exhaust the CPU or GPU.
- **Input validation.** `POST /session` is validated field by field (ranges, allowed statuses, `endAyah >= startAyah`), and a bad request gets a `422` instead of reaching the database.
- **Row Level Security.** The only table has RLS on, with insert-only access for the public key and no read access. See [docs/DATABASE.md](docs/DATABASE.md).

## Secrets

- `backend/.env` and `frontend/.env.local` are git-ignored. Only `.env.example` files with placeholders are committed.
- The Supabase **service-role** key belongs in `backend/.env` only. Anything starting with `NEXT_PUBLIC_` is sent to every visitor's browser, so never put a secret there.

## Known limits

These are deliberate trade-offs for a small, anonymous, open-source app. If you deploy it publicly, plan for them.

- **No authentication and no per-client rate limit** on `GET /surah/{n}` and `POST /session`. CORS only restricts browsers. Anyone who can reach the backend can add rows within the validation rules. Put a rate-limiting reverse proxy in front of a public backend.
- **No TLS in the app itself.** Use your host's HTTPS, or a reverse proxy, and `wss://` for the WebSocket.
- **Mistake labels are advice.** The recogniser can mishear. Do not treat a red word as a ruling on someone's recitation.
