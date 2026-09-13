import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import worker from '../apps/worker/src/index.js';

function createD1Mock() {
  const rawDb = new DatabaseSync(':memory:');
  rawDb.exec(fs.readFileSync('apps/worker/migrations/0001_secure_vault.sql', 'utf8'));
  rawDb.exec(fs.readFileSync('apps/worker/migrations/0002_agent_execution.sql', 'utf8'));
  rawDb.exec(fs.readFileSync('apps/worker/migrations/0003_agent_requirements.sql', 'utf8'));
  rawDb.exec(fs.readFileSync('apps/worker/migrations/0004_account_integrity.sql', 'utf8'));
  return {
    rawDb,
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        first() { return rawDb.prepare(sql).get(...args) || null; },
        all() { return { results: rawDb.prepare(sql).all(...args) }; },
        run() { const result = rawDb.prepare(sql).run(...args); return { success: true, meta: { changes: result.changes } }; },
      };
    },
  };
}

function requestJson(port, url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ port, path: url, method: options.method || 'GET', headers: options.headers || {} }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text || '{}') }));
    });
    request.on('error', reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

const d1 = createD1Mock();
const secret = 'e2e-runner-secret';
const token = 'tok_e2e_user';
const userId = 'usr_e2e_user';
d1.rawDb.prepare(
  `INSERT INTO vault_users (id, email, username, password_hash, verified, created_at) VALUES (?, ?, ?, ?, 1, ?)`
).run(userId, 'e2e@klizonion.dev', 'e2e-user', 'fixture-hash', Date.now());
d1.rawDb.prepare(
  `INSERT INTO vault_auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`
).run(crypto.createHash('sha256').update(token).digest('hex'), userId, Date.now(), Date.now() + 600000);

let plannerCalls = 0;
const env = {
  DB: d1,
  RUNNER_SHARED_SECRET: secret,
  BUILDER_PROTOCOL_VERSION: '0.2',
  AI: {
    run: async () => {
      plannerCalls += 1;
      if (plannerCalls === 1) {
        return {
          response: JSON.stringify({
            message: 'I will create the requested HTML file.',
            actions: [{ operation: 'file.write', payload: { path: 'index.html', content: '<!doctype html><title>E2E</title><button>Go</button>' } }],
          }),
        };
      }
      return { response: JSON.stringify({ message: 'The file was created and verified.', actions: [] }) };
    },
  },
};

const server = http.createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const headers = new Headers(request.headers);
  const result = await worker.fetch(new Request(`http://127.0.0.1${request.url}`, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : body,
  }), env);
  response.writeHead(result.status, Object.fromEntries(result.headers));
  response.end(await result.text());
});

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'klizonion-e2e-'));
const runnerId = 'runner_e2e';
const serverPort = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const runner = spawn('python', ['packages/agent/runner.py', '--workspace', workspace, '--worker-url', `http://127.0.0.1:${serverPort}`, '--runner-id', runnerId, '--interval', '0.05'], {
  cwd: process.cwd(),
  env: { ...process.env, RUNNER_SHARED_SECRET: secret },
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  const authHeaders = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  let result;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    result = await requestJson(serverPort, '/api/builder/status');
    if (result.body.runner) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!result?.body.runner) throw new Error('Runner did not become available');

  result = await requestJson(serverPort, '/api/builder/missions', {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ prompt: 'Create index.html with a button.' }),
  });
  if (result.status !== 201) throw new Error(`Mission creation failed: ${JSON.stringify(result.body)}`);
  const missionId = result.body.mission.id;

  let content = '';
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (fs.existsSync(path.join(workspace, 'index.html'))) {
      content = fs.readFileSync(path.join(workspace, 'index.html'), 'utf8');
      if (content.includes('<title>E2E</title>') && content.includes('<button>')) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!content.includes('<title>E2E</title>') || !content.includes('<button>')) throw new Error('Runner did not write the requested button');

  result = await requestJson(serverPort, `/api/builder/missions/${missionId}`, { headers: authHeaders });
  if (result.status !== 200 || result.body.mission.status !== 'completed') {
    throw new Error(`Mission did not complete: ${JSON.stringify(result.body)}`);
  }
  const duplicate = await requestJson(serverPort, '/api/runner/result', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-runner-secret': secret },
    body: JSON.stringify({
      missionId,
      actionId: result.body.mission.actions[0].actionId,
      runnerId,
      workspaceId: result.body.mission.workspaceId,
      success: true,
      result: { path: 'index.html', bytes: content.length },
    }),
  });
  if (duplicate.status !== 200 || duplicate.body.duplicate !== true) throw new Error('Duplicate result was not idempotently acknowledged');
  if (plannerCalls !== 2) throw new Error(`Expected planner selection plus verification call, got ${plannerCalls}`);
  console.log('PASS real file.write round trip:', JSON.stringify({ missionId, workspace, status: result.body.mission.status }));
} finally {
  runner.kill();
  await new Promise((resolve) => runner.once('close', resolve));
  server.close();
  fs.rmSync(workspace, { recursive: true, force: true });
}
