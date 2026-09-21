import { createSign } from 'node:crypto';

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function createAppJwt({ appId, privateKey, now = Math.floor(Date.now() / 1000) }) {
  const header = base64url({ alg: 'RS256', typ: 'JWT' });
  const payload = base64url({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: String(appId),
  });
  const input = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(input);
  signer.end();
  const signature = signer.sign(privateKey).toString('base64url');
  return `${input}.${signature}`;
}

export class GitHubAppClient {
  constructor({
    appId,
    privateKey,
    apiUrl = 'https://api.github.com',
    apiVersion = '2026-03-10',
    fetchImpl = fetch,
  }) {
    this.appId = appId;
    this.privateKey = privateKey;
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.apiVersion = apiVersion;
    this.fetch = fetchImpl;
    this.installationTokens = new Map();
  }

  async request(path, { token, method = 'GET', body } = {}) {
    const response = await this.fetch(`${this.apiUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': this.apiVersion,
        'User-Agent': 'viewportable-github-app',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API ${method} ${path} failed: ${response.status} ${text}`);
    }

    return response.status === 204 ? null : response.json();
  }

  async installationToken(installationId) {
    const cached = this.installationTokens.get(installationId);
    if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;

    const jwt = createAppJwt({
      appId: this.appId,
      privateKey: this.privateKey,
    });
    const result = await this.request(
      `/app/installations/${installationId}/access_tokens`,
      { token: jwt, method: 'POST' },
    );
    const expiresAt = Date.parse(result.expires_at);
    this.installationTokens.set(installationId, {
      token: result.token,
      expiresAt,
    });
    return result.token;
  }

  async installationRequest(installationId, path, options = {}) {
    const token = await this.installationToken(installationId);
    return this.request(path, { ...options, token });
  }

  async createCheckRun({
    installationId,
    repositoryFullName,
    headSha,
    externalId,
    detailsUrl,
  }) {
    const body = {
      name: 'Viewportable Engine',
      head_sha: headSha,
      status: 'queued',
      external_id: externalId,
      ...(detailsUrl ? { details_url: detailsUrl } : {}),
      output: {
        title: 'Structural comparison queued',
        summary: 'Viewportable accepted this pull request and queued structural comparison.',
      },
    };

    return this.installationRequest(
      installationId,
      `/repos/${repositoryFullName}/check-runs`,
      { method: 'POST', body },
    );
  }

  async completeCheckRun({
    installationId,
    repositoryFullName,
    checkRunId,
    conclusion,
    title,
    summary,
    detailsUrl,
  }) {
    return this.installationRequest(
      installationId,
      `/repos/${repositoryFullName}/check-runs/${checkRunId}`,
      {
        method: 'PATCH',
        body: {
          name: 'Viewportable Engine',
          status: 'completed',
          conclusion,
          ...(detailsUrl ? { details_url: detailsUrl } : {}),
          output: { title, summary },
        },
      },
    );
  }
}
