/**
 * Every operation of the H-POD API v3 (https://api-uk.h-pod.co.uk/v3/docs/), described so the web page can build a form for it and the server can check
 * what it is sent. The paths, parameters and bodies are those of the API's OpenAPI file.
 */
import type { HpodMethod } from '../../../ingest/src/hpod/client.js';

export const GROUPS = ['Authenticate', 'Print', 'Job', 'Pack', 'Blob', 'Framework', 'OIDC provider'] as const;
export type OperationGroup = (typeof GROUPS)[number];

export interface ParamDef {
  name: string; label: string; required?: boolean; example?: string;
  /** Filled from the H-POD settings when left empty. */
  fromSettings?: 'instance';
}
export interface OperationDef {
  id: string; group: OperationGroup; method: HpodMethod; path: string; summary: string; description: string;
  /** "bearer": needs the sign-in token. "none": sent without one. "settings": signs in with the H-POD settings (the body is built here, so the password never reaches the browser). */
  auth: 'bearer' | 'none' | 'settings';
  pathParams?: ParamDef[]; query?: ParamDef[];
  body?: { kind: 'json' | 'form'; sample: Record<string, unknown> };
  /** Set when the call changes live data or sends mail: the page asks for a confirmation and the server insists on one. */
  live?: string;
  deprecated?: boolean;
  /** The page offers a file chooser that fills data, filename and mimeType. */
  filePicker?: boolean;
  /** H-POD's call limit for it. */
  throttle?: string;
}

const G0 = '00000000-0000-0000-0000-000000000000';
const guidOpt = { name: '', guid: G0 };

export const OPERATIONS: OperationDef[] = [
  { id: 'authenticate', group: 'Authenticate', method: 'POST', path: '/authenticate', auth: 'settings', throttle: '5 per minute', summary: 'Acquire a token',
    description: 'Signs in with the instance, account code, username and password from Settings > Connectivity and keeps the token for the other calls. The password is added on the server and never reaches this page.' },
  { id: 'authenticateMe', group: 'Authenticate', method: 'GET', path: '/authenticate/me', auth: 'bearer', throttle: '5 per minute', summary: 'Who am I', description: 'Details of the signed-in user.' },
  { id: 'authenticateRefresh', group: 'Authenticate', method: 'POST', path: '/authenticate/refresh', auth: 'bearer', throttle: '5 per minute', summary: 'Refresh the token',
    description: 'Asks for a fresh token. When H-POD sends one back it replaces the one held.' },
  { id: 'authenticateFocus', group: 'Authenticate', method: 'POST', path: '/authenticate/focus/{accountGuid}', auth: 'bearer', throttle: '5 per minute', summary: 'Focus on another account',
    description: 'Switches the session to another account the user can reach.', pathParams: [{ name: 'accountGuid', label: 'Account GUID', required: true, example: G0 }] },
  { id: 'authenticateAuthcode', group: 'Authenticate', method: 'POST', path: '/authenticate/authcode', auth: 'none', throttle: '5 per minute', summary: 'Sign in with an authorisation code',
    description: 'Exchanges an external identity provider\'s authorisation code for a token.', body: { kind: 'json', sample: { provider: '', code: '', verifier: '', redirectUrl: '' } } },
  { id: 'authenticateKeysInstance', group: 'Authenticate', method: 'GET', path: '/authenticate/keys/{instance}', auth: 'none', throttle: '5 per minute', summary: 'Token signing keys (JWKS)',
    description: 'The keys that sign this instance\'s tokens, for checking a token.', pathParams: [{ name: 'instance', label: 'Instance', required: true, fromSettings: 'instance' }] },
  { id: 'authenticateKeys', group: 'Authenticate', method: 'GET', path: '/authenticate/keys', auth: 'none', deprecated: true, throttle: '5 per minute', summary: 'Token signing keys (deprecated)',
    description: 'Deprecated: keys are now per instance, so use "Token signing keys (JWKS)" instead.' },

  { id: 'printConfiguration', group: 'Print', method: 'GET', path: '/print/configuration', auth: 'bearer', throttle: '10 per second', summary: 'Get configuration',
    description: 'The papers, envelopes, ink, duplex, pack modes, delivery methods, inserts, stationery and defaults set up for the account. Their GUIDs go into a submission. They change very rarely, so do not call this for every submission.' },
  { id: 'printInit', group: 'Print', method: 'POST', path: '/print/init', auth: 'bearer', throttle: '10 per second', summary: 'Initialise a submission',
    description: 'Starts a submission with its print options and returns the job GUID the next calls use. Nothing is printed until it is committed.',
    body: { kind: 'json', sample: { name: 'Demo letter', clientId: 'demo-1', paper: guidOpt, envelope: guidOpt, ink: guidOpt, duplex: guidOpt, packMode: guidOpt, delivery: guidOpt } } },
  { id: 'printDocpart', group: 'Print', method: 'POST', path: '/print/docpart', auth: 'bearer', throttle: '10 per second', summary: 'Send a part of the document',
    description: 'One part of the file, base-64 encoded. A part is at most 500 KB by default; later parts say where they start in the file (startByteIndex). fileIndex 0 is the document, higher numbers are attachments. The Submit tab does all of this for a whole file.',
    body: { kind: 'json', sample: { jobGUID: G0, fileIndex: 0, partIndex: 0, fileType: 'pdf', filename: 'letter.pdf', data: '', startByteIndex: 0 } } },
  { id: 'printCommit', group: 'Print', method: 'POST', path: '/print/commit', auth: 'bearer', throttle: '10 per second', summary: 'Commit a submission',
    description: 'Says all the document data is there and the job should go into H-POD for processing.',
    live: 'This commits the job to H-POD. Depending on the account\'s settings it can be printed and posted to the recipients.',
    body: { kind: 'json', sample: { jobGUID: G0, extractAddress: true, abortOnValidationFailure: true, exportReady: false, recipients: [{ address: ['1 High Street', 'Anytown'], addressType: 'Postal', postcode: 'AB1 2CD', countryCode: 'GB', forename: 'Jo', surname: 'Smith' }] } } },

  { id: 'jobStatus', group: 'Job', method: 'GET', path: '/job/status/{jobGuid}', auth: 'bearer', throttle: '30 per minute', summary: 'Get a job\'s status',
    description: 'How far a job has got, and the packs (letters) found in it.', pathParams: [{ name: 'jobGuid', label: 'Job GUID', required: true, example: G0 }] },

  { id: 'packGet', group: 'Pack', method: 'GET', path: '/pack/{packGuid}', auth: 'bearer', throttle: '30 per minute', summary: 'Get a pack',
    description: 'Everything about one letter: the PDF versions, the status changes, the recipient and the delivery.', pathParams: [{ name: 'packGuid', label: 'Pack GUID', required: true, example: G0 }] },
  { id: 'packBatch', group: 'Pack', method: 'POST', path: '/pack/batch', auth: 'bearer', throttle: '30 per minute', summary: 'Update pack statuses',
    description: 'Sets the status of up to 100 packs: printed, rejected, posted, delivered, returned, userActionRequired, failed or confirmedDownloadedForPrinting. For failed, the context is the reason; for posted it can be a tracking number.',
    live: 'This changes the status of live packs in H-POD, which the sender sees and which can set off notifications.',
    body: { kind: 'json', sample: { permitPartialUpdate: false, packs: [{ packGUID: G0, status: 'printed', notificationDateUTC: '', context: '' }] } } },

  { id: 'blobUpload', group: 'Blob', method: 'POST', path: '/blob', auth: 'bearer', filePicker: true, summary: 'Upload a file (blob)',
    description: 'Stores a file (base-64 encoded) and returns its blob GUID, for calls that refer to an uploaded file, such as a framework\'s data file.', body: { kind: 'json', sample: { data: '', filename: 'data.csv', mimeType: 'text/csv' } } },

  { id: 'frameworkSubmit', group: 'Framework', method: 'POST', path: '/framework/submit', auth: 'bearer', summary: 'Submit a framework',
    description: 'Starts framework processing for a data file uploaded with "Upload a file (blob)". H-POD creates the job itself.',
    live: 'This starts framework processing, which creates packs that can be printed and posted.',
    body: { kind: 'json', sample: { templateName: '', multiple: false, dataBlobGUID: G0, dataFilename: 'data.csv', requestedHold: true, advanced: false } } },

  { id: 'oidcDiscovery', group: 'OIDC provider', method: 'GET', path: '/oidc/.well-known/openid-configuration', auth: 'none', summary: 'OpenID discovery document', description: 'H-POD can act as an OpenID Connect identity provider. This is its discovery document.' },
  { id: 'oidcAuthorize', group: 'OIDC provider', method: 'GET', path: '/oidc/authorize', auth: 'none', summary: 'Authorize',
    description: 'Starts an authorisation. H-POD answers with a page or a redirect (the Location header is shown, and redirects are not followed).',
    query: [{ name: 'client_id', label: 'client_id', required: true }, { name: 'redirect_uri', label: 'redirect_uri', required: true }, { name: 'response_type', label: 'response_type', required: true, example: 'code' },
      { name: 'scope', label: 'scope', example: 'openid' }, { name: 'state', label: 'state' }, { name: 'nonce', label: 'nonce' }, { name: 'code_challenge', label: 'code_challenge' }, { name: 'code_challenge_method', label: 'code_challenge_method', example: 'S256' }] },
  { id: 'oidcLogin', group: 'OIDC provider', method: 'POST', path: '/oidc/login', auth: 'none', summary: 'Login (form)', description: 'Signs a user in from the login form.', body: { kind: 'form', sample: { email: '', account: '', password: '', return_url: '' } } },
  { id: 'oidcLoginDirect', group: 'OIDC provider', method: 'POST', path: '/oidc/login-direct', auth: 'none', summary: 'Login (direct)', description: 'Signs a user in and asks for the authorisation in one call.',
    body: { kind: 'json', sample: { email: '', account: '', password: '', client_id: '', redirect_uri: '', response_type: 'code', scope: 'openid', state: '', nonce: '', code_challenge: '', code_challenge_method: 'S256' } } },
  { id: 'oidcToken', group: 'OIDC provider', method: 'POST', path: '/oidc/token', auth: 'none', summary: 'Token', description: 'Exchanges an authorisation code or refresh token for tokens.',
    body: { kind: 'form', sample: { grant_type: 'authorization_code', code: '', redirect_uri: '', client_id: '', client_secret: '', code_verifier: '', refresh_token: '', instance: '' } } },
  { id: 'oidcUserinfoGet', group: 'OIDC provider', method: 'GET', path: '/oidc/userinfo', auth: 'bearer', summary: 'User info (GET)', description: 'The signed-in user\'s claims. Use the token override to send an access token from "Token".' },
  { id: 'oidcUserinfoPost', group: 'OIDC provider', method: 'POST', path: '/oidc/userinfo', auth: 'bearer', summary: 'User info (POST)', description: 'The same as GET.' },
];

export const BY_ID = new Map(OPERATIONS.map((o) => [o.id, o]));
