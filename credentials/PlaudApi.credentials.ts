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
 * feasible. Instead, the user pastes a long-lived bearer JWT extracted from a
 * logged-in browser session (typical lifetime: ~10 months).
 *
 * The regional API host is derived from the JWT's `region` claim — no second
 * field needed. Plaud's known regions map cleanly:
 *   aws:eu-central-1   → api-euc1.plaud.ai
 *   aws:us-east-1      → api-use1.plaud.ai
 *   aws:ap-southeast-1 → api-apse1.plaud.ai
 * Unknown regions fall back to api.plaud.ai (the discovery host).
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
        'token typically lasts ~10 months before you need to re-paste. The regional ' +
        'API host is detected automatically from the token.',
    },
  ];

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

  // The expression below decodes the JWT payload, reads the `region` claim, and
  // maps it to a Plaud regional host. Falls back to api.plaud.ai if anything
  // throws (malformed token, unknown region) — the discovery host will then
  // return status:-302 with the correct URL, surfaced via the rule below.
  test: ICredentialTestRequest = {
    request: {
      method: 'GET',
      baseURL: `={{ (() => { try { const p = JSON.parse(Buffer.from($credentials.accessToken.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8')); const map = {'aws:eu-central-1':'api-euc1','aws:eu-west-1':'api-euw1','aws:us-east-1':'api-use1','aws:us-east-2':'api-use2','aws:us-west-1':'api-usw1','aws:us-west-2':'api-usw2','aws:ap-southeast-1':'api-apse1','aws:ap-southeast-2':'api-apse2','aws:ap-northeast-1':'api-apne1','aws:ap-south-1':'api-aps1'}; return 'https://' + (map[p.region] || 'api') + '.plaud.ai'; } catch (_e) { return 'https://api.plaud.ai'; } })() }}`,
      url: '/user/me',
    },
    rules: [
      {
        type: 'responseSuccessBody',
        properties: {
          key: 'status',
          value: 0,
          message:
            'Plaud rejected the token. The JWT may be expired, revoked, or come from a region this node does not know. Verify the token by logging in fresh at web.plaud.ai and copying a new Authorization header.',
        },
      },
    ],
  };
}
