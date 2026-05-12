# n8n-nodes-plaud-cloud

This is an n8n community node. It lets you use the [Plaud](https://www.plaud.ai) AI voice recorder cloud in your n8n workflows.

Plaud sells pocketable AI voice recorders that automatically sync recordings to a cloud where they are transcribed and summarized. This node exposes that cloud as a set of n8n operations: list recordings, fetch transcripts and summaries, upload new audio, manage tags and devices, and react to new content via a polling trigger.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)  
[Operations](#operations)  
[Credentials](#credentials)  
[Compatibility](#compatibility)  
[Usage](#usage)  
[Resources](#resources)

> ⚠️ **Unofficial / undocumented API.** Plaud does not publish an API. This node was built by reverse-engineering the network traffic of `web.plaud.ai`. Endpoints, payloads, and the auth flow may change without notice. Use at your own risk and review Plaud's Terms of Service before deploying.

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation. The package name is `n8n-nodes-plaud-cloud`.

For self-hosted iterative development against a remote n8n container, this repo includes [`scripts/deploy.sh`](scripts/deploy.sh):

```bash
PLAUD_VPS=root@your-vps-ip ./scripts/deploy.sh
```

## Operations

### Plaud (action node)

| Resource | Operations |
|---|---|
| Recording | Get Many, Get, Update Filename, Trash, Delete, Get Download URL, Download Audio (binary) |
| Transcript | Get (returns the transcript JSON for a recording) |
| Summary | Get (returns the AI-generated summary as markdown) |
| Account | Get Profile |
| Upload | Upload Audio (multipart presigned-S3 flow) |
| Tag | Get Many |
| Device | Get Many (list devices linked to the account) |

### Plaud Trigger (polling)

| Event | What it fires on |
|---|---|
| New Recording | A recording with a `version_ms` higher than the cursor (anything created or updated since last poll) |
| New Transcript Available | A recording that has just transitioned from `is_trans: false` to `is_trans: true` |

The first poll silently establishes a cursor — installing the trigger does not flood you with historical recordings. State (cursor + seen-ids) is persisted in `workflowStaticData('node')`.

## Credentials

Plaud has no API-key endpoint, and the web login encrypts the password client-side with a public key. Reproducing that from a generic HTTP client requires reverse-engineering obfuscated JS, so this node uses a different mechanism: a long-lived bearer JWT extracted from a logged-in browser session.

Prerequisites:
- A Plaud account with at least one recording in the library.
- Access to a browser with DevTools (any modern desktop browser).

Steps to obtain the credential value:

1. Log in to [web.plaud.ai](https://web.plaud.ai).
2. Open DevTools → **Network** tab.
3. Click any request to `api-*.plaud.ai` (e.g. the request to `/user/me`).
4. Find the `authorization` request header.
5. Copy its value **without** the leading `bearer ` prefix.
6. In n8n, create a new **Plaud API** credential and paste the value into **Access Token (JWT)**.

The regional API host is detected automatically from the token's `region` claim, so there is no second field to configure. The token typically lasts approximately ten months.

## Compatibility

- Tested against n8n 1.74.0 and later.
- Requires Node.js 18 or later in the n8n runtime.
- Known regions auto-mapped: `aws:eu-central-1`, `aws:eu-west-1`, `aws:us-east-1`, `aws:us-east-2`, `aws:us-west-1`, `aws:us-west-2`, `aws:ap-southeast-1`, `aws:ap-southeast-2`, `aws:ap-northeast-1`, `aws:ap-south-1`. Other regions fall back to `api.plaud.ai` (Plaud's discovery host); please open an issue with your `region` claim if you hit this fallback so the mapping can be extended.

## Usage

### Auto-transcribe-and-post

```
Plaud Trigger (Event: New Transcript Available)
  ↓
Plaud (Resource: Transcript, Operation: Get, Recording ID: ={{ $json.id }})
  ↓
Slack / Email / Notion ... (consume $json.transcript)
```

### Archive recordings to S3

```
Plaud Trigger (Event: New Recording)
  ↓
Plaud (Resource: Recording, Operation: Download Audio, Recording ID: ={{ $json.id }})
  ↓
AWS S3 (Upload Binary Data)
```

### Upload an external recording into Plaud

```
HTTP Request (fetch some .ogg)
  ↓
Plaud (Resource: Upload, Operation: Upload Audio, Filename: "Meeting 2026-01-15")
```

### Known limitations

- Audio download URLs expire after 1 hour. Fetch immediately if you need the binary.
- Summary content is gzipped Markdown server-side; the node decompresses transparently.
- Upload uses the multipart chunk split returned by Plaud's `/file/get_upload_presigned_url` — Plaud decides how many parts. Voice-memo-sized files work fine; very large uploads (>1 GB) are untested.
- Plaud has no published rate limit. Polling at one-minute intervals is safe; sub-minute polling is untested.

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
* [Plaud website](https://www.plaud.ai)
* [Reverse-engineered API notes](https://github.com/henrikfrey/n8n-nodes-plaud) (this repository)

## License

[MIT](LICENSE)
