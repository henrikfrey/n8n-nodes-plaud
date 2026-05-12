import {
  type IAuthenticateGeneric,
  type ICredentialTestRequest,
  type ICredentialType,
  type INodeProperties,
} from 'n8n-workflow';

/**
 * Plaud API credential.
 *
 * Plaud has no public API. The web app encrypts the user's password client-side
 * before login, so reproducing the login flow from a generic HTTP client is not
 * feasible without reverse-engineering the obfuscated JS. Instead, the user
 * pastes a long-lived bearer JWT extracted from a logged-in browser session
 * (typical lifetime: ~10 months).
 *
 * Two fields:
 *   - accessToken: the JWT
 *   - region:      which regional API host to call (encoded in the JWT's
 *                  `region` claim — user picks the matching dropdown entry)
 */
export class PlaudApi implements ICredentialType {
  name = 'plaudApi';
  displayName = 'Plaud API';
  documentationUrl = 'https://github.com/henrikfrey/n8n-nodes-plaud#credentials';

  properties: INodeProperties[] = [
    {
      displayName: 'Access Token (JWT)',
      name: 'accessToken',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description:
        'Bearer JWT extracted from a logged-in browser session of web.plaud.ai. ' +
        'Open DevTools → Network → any request to api-*.plaud.ai → copy the value of ' +
        'the "authorization" request header (drop the leading "bearer " prefix). The ' +
        'token typically lasts ~10 months before you need to re-paste.',
    },
    {
      displayName: 'Region',
      name: 'region',
      type: 'options',
      default: 'euc1',
      description:
        'Plaud routes accounts to a regional API. The JWT encodes the home region in the ' +
        '`region` claim — pick the matching entry. EU Central (Frankfurt) is the default.',
      options: [
        { name: 'EU Central (Frankfurt) — api-euc1.plaud.ai', value: 'euc1' },
        { name: 'US East (N. Virginia) — api-use1.plaud.ai', value: 'use1' },
        { name: 'Asia Pacific (Singapore) — api-apse1.plaud.ai', value: 'apse1' },
        { name: 'Custom host (advanced)', value: 'custom' },
      ],
    },
    {
      displayName: 'Custom API Host',
      name: 'customHost',
      type: 'string',
      default: '',
      placeholder: 'api-xxx.plaud.ai',
      description: 'Used only when Region is "Custom host". Hostname only — no scheme, no path.',
      displayOptions: { show: { region: ['custom'] } },
    },
  ];

  // Sets just the Authorization header + Origin/Referer (which web.plaud.ai sends
  // on every request and which some endpoints CORS-validate). The rest of the
  // request-tracing headers (x-device-id, x-pld-user, x-request-id) are computed
  // in the node's transport helper because they need real JS (sha256, JWT decode)
  // that n8n's expression sandbox doesn't expose.
  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=bearer {{$credentials.accessToken}}',
        Origin: 'https://web.plaud.ai',
        Referer: 'https://web.plaud.ai/',
      },
    },
  };

  // /user/me is the cheapest authenticated GET. Plaud envelopes successful responses
  // with `status: 0` — the rule below catches "auth succeeded HTTP-wise but the
  // token was rejected at the application layer".
  test: ICredentialTestRequest = {
    request: {
      method: 'GET',
      baseURL:
        '={{ $credentials.region === "custom" ? "https://" + $credentials.customHost : "https://api-" + $credentials.region + ".plaud.ai" }}',
      url: '/user/me',
    },
    rules: [
      {
        type: 'responseSuccessBody',
        properties: {
          key: 'status',
          value: 0,
          message:
            'Plaud rejected the token (status != 0). The JWT may be expired, revoked, or the Region setting may not match the token.',
        },
      },
    ],
  };
}
