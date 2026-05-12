# n8n-nodes-plaud

[![n8n.io - Workflow Automation Tool](https://raw.githubusercontent.com/n8n-io/n8n/master/assets/n8n-logo.png)](https://n8n.io)

Community node for [n8n](https://n8n.io) that integrates with [Plaud](https://www.plaud.ai) — the AI voice recorder cloud.

> ⚠️ **Unofficial / undocumented API.** Plaud does not publish an API. This node was built by reverse-engineering the network traffic of `web.plaud.ai`. Endpoints, payloads, and the auth flow may change without notice. Use at your own risk and review Plaud's Terms of Service before deploying. Do not rely on this for mission-critical workflows.

## What you get

### Plaud (action node)

| Resource | Operations |
|---|---|
| Recording | Get Many, Get, Trash, Delete, Get Download URL, Download Audio (binary) |
| Transcript | Get (returns the transcript JSON for a recording) |
| Summary | Get (returns the AI-generated summary as markdown) |
| Account | Get Profile |
| Upload | Upload Audio (multipart presigned-S3 flow) |
| Tag | Get Many |

### Plaud Trigger (polling)

| Event | What it fires on |
|---|---|
| New Recording | A recording with a `version_ms` higher than the cursor (i.e. anything created or updated since last poll) |
| New Transcript Available | A recording that has just transitioned from "no transcript" to `is_trans: true` |

State (cursor + seen-ids) is kept in `workflowStaticData('node')`. The very first poll only records the cursor — it does **not** emit historical recordings, so installing the trigger doesn't flood you.

## Credentials

Plaud has no API key endpoint, and the web login encrypts the password client-side with a public key. Reproducing that from a generic HTTP client requires reverse-engineering obfuscated JS.

**Workaround**: paste the bearer JWT from a logged-in browser session.

1. Log in to https://web.plaud.ai
2. Open DevTools → **Network** tab
3. Click any request to `api-*.plaud.ai` (e.g. the call to `/user/me`)
4. In **Headers**, find the `authorization` request header
5. Copy the value **without** the leading `bearer ` prefix
6. Paste into the **Access Token (JWT)** field of the credential
7. Pick the matching **Region** (the JWT's `region` claim tells you: `aws:eu-central-1` → EU Central, `aws:us-east-1` → US East, etc.)

The token typically lasts ~10 months before you need to re-paste.

## Installation

### Self-hosted n8n via Docker

```bash
# Inside the n8n container, mount or copy the built package into ~/.n8n/custom/
docker exec -it <n8n-container> sh -c '
  mkdir -p /home/node/.n8n/custom &&
  cd /home/node/.n8n/custom &&
  npm init -y >/dev/null &&
  npm install n8n-nodes-plaud
'
docker restart <n8n-container>
```

Or add it to your Compose `volumes:` so the package persists across restarts.

### Umbrel (n8n.frey.host style)

```bash
ssh umbrel@your-umbrel.local
docker exec -it n8n_n8n_1 sh -c '
  mkdir -p /home/node/.n8n/custom &&
  cd /home/node/.n8n/custom &&
  npm init -y >/dev/null &&
  npm install n8n-nodes-plaud
'
docker restart n8n_n8n_1
```

### Local development (`npm link`)

```bash
cd n8n-nodes-plaud
npm install
npm run build
npm link

# In your n8n custom-extensions directory:
mkdir -p ~/.n8n/custom
cd ~/.n8n/custom
npm init -y
npm link n8n-nodes-plaud

# Restart n8n (Ctrl+C, then n8n start)
```

After install + restart, "Plaud" and "Plaud Trigger" appear in the node panel.

## Caveats

- **Audio download** uses a presigned S3 URL with a 1-hour expiry — fetch it immediately if you need the binary.
- **Transcript / summary** require two HTTP calls (Plaud `/file/detail/{id}` → presigned S3). The summary is gzipped markdown; the node decompresses it for you.
- **Upload**: Plaud's preferred audio format is OGG. Other formats (m4a, mp3, wav, opus) appear to work via the `file_type` field but aren't all tested. The default chunk count is what Plaud's `/file/get_upload_presigned_url` returns; we trust their split.
- **Polling cadence**: Plaud has no published rate limit. Login responses imply ~10 logins/hour. Polling once a minute is safe; sub-minute polling has not been tested.

## License

MIT
