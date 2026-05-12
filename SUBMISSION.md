# Verified community node — submission checklist

Notes for promoting `n8n-nodes-plaud-cloud` from "just published on npm" to "n8n verified community node". Verified nodes are surfaced inside the n8n editor under **Community Nodes** (no manual install needed) and become discoverable via the official n8n MCP server's `get_node_types` schema lookups.

## Status

| Requirement | State |
|---|---|
| Public on npm under a `n8n-nodes-*` name | ✅ `n8n-nodes-plaud-cloud` |
| README matches n8n's community-node template structure | ✅ (Installation / Operations / Credentials / Compatibility / Usage / Resources) |
| Passes `eslint-plugin-n8n-nodes-base` (`/community`, `/credentials`, `/nodes` rule sets) | ✅ `npm run lint` clean |
| LICENSE file present | ✅ MIT |
| `n8nNodesApiVersion: 1` in package.json | ✅ |
| Icon present | ✅ placeholder SVG |
| No `n8n-nodes-base.*` collisions in node names | ✅ uses `plaud` / `plaudTrigger` |
| Reasonable test coverage | ❌ — no unit tests yet |
| Brand icon authorized by Plaud | ❌ — placeholder; submission will surface this |
| n8n-docs PR with package entry | ❌ — see "Submission steps" below |

## Submission steps

1. **Confirm published version on npm** with full operation set and the verified-friendly README:
   ```bash
   npm version minor    # 0.1.0 → 0.2.0 (or whatever the latest fixes warrant)
   git push --follow-tags
   npm publish --otp=<otp>
   ```
2. **Apply via the n8n community node program form**:  
   https://internal.users.n8n.cloud/form/c5fce9d1-7f4f-46c2-a09c-6306b81e3df6  
   (Current as of 2026-05; if the form has moved, check https://docs.n8n.io/integrations/community-nodes/.)
   - Provide the npm package name (`n8n-nodes-plaud-cloud`) and the GitHub URL.
   - In the description, link to the README and call out the **unofficial Plaud API** caveat — n8n's review team needs to know it's reverse-engineered before approving.
3. **Replace the placeholder icon** with a Plaud-authorized asset OR commit to keeping the placeholder by explicitly stating it in the submission. n8n usually wants to know brand assets are cleared.
4. **Optional but appreciated**: add a few smoke tests under `__tests__/` covering the request-envelope unwrap, region derivation, and the file/detail → S3 transcript fetch path.

## Things to check before each new npm publish

```bash
npm run lint        # eslint-plugin-n8n-nodes-base, all three rule sets
npm run typecheck   # tsc --noEmit
npm run build       # tsc + gulp icons → dist/
npm pack --dry-run  # verify tarball contents
```
