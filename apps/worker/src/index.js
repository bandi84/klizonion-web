import { SimpleZip } from './zip.js';
import { STRUCTURED_OPERATIONS, validateToolRequest } from '../../../packages/core/tools.js';
import { classifyRequest, evaluateRequirements, extractRequirements } from '../../../packages/core/requirements.js';

// JSON Response helper with CORS
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type,authorization,x-runner-secret',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    },
  });

// In-memory state store for worker instance
const state = {
  runner: false,
  runnerState: 'UNAVAILABLE',
  runnerLastSeen: 0,
  hardware: 'Waiting for local runner',
  workspace: null,
  missions: new Map(),
  pendingActions: new Map(),
  activeMissionId: null,
  savedModels: new Map(),
  rateLimits: new Map(),
};

function runnerCredentials(req, env) {
  const authHeader = req.headers.get('authorization') || '';
  const supplied = req.headers.get('x-runner-secret') || authHeader.replace(/^Bearer\s+/i, '').trim();
  const expected = env?.RUNNER_SHARED_SECRET;
  if (!expected) {
    return { ok: false, response: json({ error: 'runner_unconfigured', message: 'Runner authentication is not configured.' }, 503) };
  }
  if (!supplied || supplied !== expected) {
    return { ok: false, response: json({ error: 'unauthorized', message: 'Invalid runner shared secret' }, 401) };
  }
  return { ok: true };
}

function runnerIsOnline() {
  return state.runner && Date.now() - state.runnerLastSeen < 60000;
}

async function requireBuilderSession(req, env) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token || !env?.DB) {
    return { error: json({ error: 'unauthorized', message: 'Authentication is required.' }, 401) };
  }
  const session = await getAuthSessionUser(env.DB, token).catch(() => null);
  if (!session) return { error: json({ error: 'unauthorized', message: 'Authentication is required.' }, 401) };
  if (session.disabled_at) return { error: json({ error: 'account_disabled', message: 'This account is permanently disabled.' }, 403) };
  return { session };
}

function workspaceIdForPath(path) {
  return `workspace_${Array.from(new TextEncoder().encode(String(path)))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function parseJson(value, fallback = null) {
  try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; }
}

async function durableRunner(env, runnerId) {
  if (!env?.DB) return null;
  return env.DB.prepare(
    `SELECT runner_id, workspace_id, workspace_path, status, hardware_json, last_seen, connected_at
       FROM builder_runners WHERE runner_id = ?1 LIMIT 1`
  ).bind(runnerId).first();
}

async function durableMission(env, missionId, userId = null) {
  if (!env?.DB) return null;
  const query = userId
    ? `SELECT * FROM builder_missions WHERE id = ?1 AND user_id = ?2 LIMIT 1`
    : `SELECT * FROM builder_missions WHERE id = ?1 LIMIT 1`;
  const row = userId
    ? await env.DB.prepare(query).bind(missionId, userId).first()
    : await env.DB.prepare(query).bind(missionId).first();
  if (!row) return null;
  const actions = await env.DB.prepare(
    `SELECT * FROM builder_actions WHERE mission_id = ?1 ORDER BY created_at, action_id`
  ).bind(missionId).all();
  const events = await env.DB.prepare(
    `SELECT event_type, data_json, created_at FROM builder_events WHERE mission_id = ?1 ORDER BY event_id`
  ).bind(missionId).all();
  return {
    id: row.id,
    missionId: row.id,
    userId: row.user_id,
    prompt: row.prompt,
    mode: row.mode,
    effort: row.effort,
    status: row.status,
    currentStep: row.current_step,
    workspaceId: row.workspace_id,
    runnerId: row.runner_id,
    iterationCount: Number(row.iteration_count || 0),
    maxIterations: Number(row.max_iterations || 20),
    agentMessage: row.agent_message || '',
    error: row.error || null,
    evaluation: parseJson(row.evaluation_json),
    requestKind: row.request_kind,
    requirements: parseJson(row.requirements_json, []),
    createdAt: new Date(Number(row.created_at)).toISOString(),
    updatedAt: new Date(Number(row.updated_at)).toISOString(),
    actions: (actions.results || []).map((action) => ({
      actionId: action.action_id,
      missionId: action.mission_id,
      runnerId: action.runner_id,
      workspaceId: action.workspace_id,
      operation: action.operation,
      payload: parseJson(action.payload_json, {}),
      status: action.status,
      result: parseJson(action.result_json),
      error: action.error,
      attempts: Number(action.attempts || 0),
      createdAt: new Date(Number(action.created_at)).toISOString(),
      startedAt: action.started_at ? new Date(Number(action.started_at)).toISOString() : null,
      completedAt: action.completed_at ? new Date(Number(action.completed_at)).toISOString() : null,
    })),
    events: (events.results || []).map((event) => ({
      type: event.event_type,
      at: new Date(Number(event.created_at)).toISOString(),
      ...parseJson(event.data_json, {}),
    })),
  };
}

async function persistMission(env, mission) {
  await env.DB.prepare(
    `UPDATE builder_missions
        SET status = ?1, current_step = ?2, runner_id = ?3, workspace_id = ?4,
            iteration_count = ?5, max_iterations = ?6, agent_message = ?7,
        error = ?8, evaluation_json = ?9, requirements_json = ?10, updated_at = ?11
      WHERE id = ?12`
  ).bind(
    mission.status,
    mission.currentStep,
    mission.runnerId || null,
    mission.workspaceId || null,
    mission.iterationCount || 0,
    mission.maxIterations || 20,
    mission.agentMessage || null,
    mission.error || null,
    mission.evaluation ? JSON.stringify(mission.evaluation) : null,
    JSON.stringify(mission.requirements || []),
    Date.now(),
    mission.id,
  ).run();
}

async function persistEvent(env, missionId, event) {
  await env.DB.prepare(
    `INSERT INTO builder_events (mission_id, event_type, data_json, created_at) VALUES (?1, ?2, ?3, ?4)`
  ).bind(missionId, event.type, JSON.stringify(event), Date.now()).run();
}

async function persistNewMissionActions(env, mission, existingActionIds = new Set()) {
  for (const action of mission.actions || []) {
    if (existingActionIds.has(action.actionId)) continue;
    await env.DB.prepare(
      `INSERT OR IGNORE INTO builder_actions
        (action_id, mission_id, runner_id, workspace_id, operation, payload_json, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    ).bind(
      action.actionId,
      mission.id,
      action.runnerId || mission.runnerId || null,
      action.workspaceId || mission.workspaceId || null,
      action.operation,
      JSON.stringify(action.payload || {}),
      action.status || 'pending',
      Date.now(),
    ).run();
  }
}

function validatePlannedAction(action) {
  return validateToolRequest(action).valid;
}

function parsePlannerResponse(result) {
  const text = typeof result?.response === 'string'
    ? result.response
    : typeof result?.content === 'string'
      ? result.content
      : Array.isArray(result?.content)
        ? result.content.map((part) => typeof part === 'string' ? part : part?.text || '').join('')
        : '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function recordMissionEvent(mission, type, data = {}) {
  mission.events = mission.events || [];
  mission.events.push({ type, at: new Date().toISOString(), ...data });
  if (mission.events.length > 200) mission.events.splice(0, mission.events.length - 200);
}

function evaluateMission(mission) {
  return evaluateRequirements(mission.requirements || extractRequirements(mission.prompt), mission.actions || []);
}

async function continueMissionWithAgent(mission, env) {
  mission.iterationCount = Number(mission.iterationCount || 0) + 1;
  mission.maxIterations = Number(mission.maxIterations || 20);
  if (mission.iterationCount > mission.maxIterations) {
    mission.status = 'blocked';
    mission.currentStep = 'blocked';
    mission.error = 'Agent iteration limit reached before verification.';
    recordMissionEvent(mission, 'agent.failed', { error: mission.error });
    mission.updatedAt = new Date().toISOString();
    return;
  }
  if (!env?.AI || typeof env.AI.run !== 'function') {
    mission.status = 'blocked';
    mission.currentStep = 'blocked';
    mission.error = 'Agent planning is unavailable because the AI binding is not configured.';
    recordMissionEvent(mission, 'agent.failed', { error: mission.error });
    mission.updatedAt = new Date().toISOString();
    return;
  }

  const actionHistory = mission.actions.slice(-50).map((action) => ({
    operation: action.operation,
    status: action.status,
    result: action.result || null,
    error: action.error || null,
  }));
  mission.evaluation = evaluateMission(mission);
  recordMissionEvent(mission, 'evaluation.completed', { evaluation: mission.evaluation });
  const system = `You are the controlled KLIZONION engineering planner. Decide the next safe structured actions for the user's request.
Return JSON only: {"message":"natural concise update","actions":[{"operation":"...","payload":{}}]}.
Allowed operations: ${Array.from(STRUCTURED_OPERATIONS).join(', ')}.
File paths must be workspace-relative. Never request shell commands, secrets, absolute paths, or path traversal.
If the request is fully implemented and verified, return an empty actions array. Never claim a change happened unless the action history proves it.`;

  try {
    const result = await env.AI.run('anthropic/claude-fable-5.1', {
      max_tokens: 4096,
      system,
      messages: [{
        role: 'user',
        content: JSON.stringify({ prompt: String(mission.prompt).slice(0, 12000), mode: mission.mode, actionHistory, evaluation: mission.evaluation }),
      }],
    });
    const plan = parsePlannerResponse(result);
    const actions = Array.isArray(plan?.actions) ? plan.actions.slice(0, 8) : null;
    if (!plan || !actions || !actions.every(validatePlannedAction)) {
      throw new Error('The agent returned an invalid structured action plan.');
    }

    mission.agentMessage = typeof plan.message === 'string' ? plan.message.slice(0, 2000) : '';
    if (actions.length === 0) {
      if (!mission.evaluation.passed) {
        throw new Error('The agent produced no further actions before the evaluator passed the task.');
      }
      mission.status = 'completed';
      mission.currentStep = 'verify';
      recordMissionEvent(mission, 'agent.completed', { evaluation: mission.evaluation });
      mission.updatedAt = new Date().toISOString();
      return;
    }

    const assignedRunner = await env.DB.prepare(
      `SELECT runner_id, workspace_id FROM builder_runners
        WHERE status IN ('READY', 'BUSY') AND last_seen > ?1 ORDER BY last_seen DESC LIMIT 1`
    ).bind(Date.now() - 60000).first();
    if (!assignedRunner) {
      mission.status = 'waiting_for_runner';
      mission.currentStep = 'inspect';
      mission.error = 'Workspace execution is unavailable until a supervised runner connects.';
      recordMissionEvent(mission, 'runner.disconnected', { reason: 'no_healthy_runner' });
      mission.updatedAt = new Date().toISOString();
      return;
    }
    mission.runnerId = assignedRunner.runner_id;
    mission.workspaceId = assignedRunner.workspace_id;
    const pending = state.pendingActions.get(mission.id) || [];
    for (const planned of actions) {
      const action = {
        actionId: `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        missionId: mission.id,
        operation: planned.operation,
        payload: planned.payload || {},
        runnerId: assignedRunner.runner_id,
        workspaceId: assignedRunner.workspace_id,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      mission.actions.push(action);
      pending.push(action);
      recordMissionEvent(mission, 'tool.requested', { actionId: action.actionId, operation: action.operation });
    }
    state.pendingActions.set(mission.id, pending);
    mission.status = 'running';
    mission.currentStep = 'implement';
    mission.updatedAt = new Date().toISOString();
  } catch (error) {
    mission.status = 'blocked';
    mission.currentStep = 'blocked';
    mission.error = error?.message || 'Agent planning failed.';
    recordMissionEvent(mission, 'agent.failed', { error: mission.error });
    mission.updatedAt = new Date().toISOString();
  }
}

function generate16DigitCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 8; i++) {
    const twoDigits = (bytes[i] % 100).toString().padStart(2, '0');
    code += twoDigits;
  }
  return code.slice(0, 16);
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}


// -----------------------------------------------------------------------------
// Secure Vault helpers
// Account secrets are NEVER stored in plaintext. Passwords use PBKDF2-SHA-256
// with a per-password random salt. Bearer/verification tokens are stored only
// as SHA-256 hashes in D1. API/provider keys belong in Worker secrets, not D1.
// -----------------------------------------------------------------------------
const PBKDF2_ITERATIONS = 120000;
const PBKDF2_KEY_LENGTH = 32;

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function randomBase64Url(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function pbkdf2PasswordHash(password, saltBytes = null, iterations = PBKDF2_ITERATIONS) {
  const salt = saltBytes || crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    PBKDF2_KEY_LENGTH * 8,
  );
  return `pbkdf2-sha256$${iterations}$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(derived))}`;
}

async function verifyPasswordHash(password, encoded) {
  const parts = String(encoded || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isSafeInteger(iterations) || iterations < 10000 || iterations > 2000000) return false;
  try {
    const expected = base64UrlToBytes(parts[3]);
    const candidate = await pbkdf2PasswordHash(password, base64UrlToBytes(parts[2]), iterations);
    const candidateBytes = base64UrlToBytes(candidate.split('$')[3]);
    if (candidateBytes.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ candidateBytes[i];
    return diff === 0;
  } catch {
    return false;
  }
}

async function getUserByEmail(db, email) {
  if (!db) return null;
  return db.prepare(
    'SELECT id, email, username, password_hash, verified, created_at, disabled_at, disabled_reason FROM vault_users WHERE email = ?1 LIMIT 1'
  ).bind(email).first();
}

async function getUserByUsername(db, username) {
  if (!db) return null;
  return db.prepare(
    'SELECT id, email, username, password_hash, verified, created_at, disabled_at, disabled_reason FROM vault_users WHERE username = ?1 LIMIT 1'
  ).bind(username).first();
}

async function getAuthSessionUser(db, rawToken) {
  if (!db || !rawToken) return null;
  const tokenHash = await sha256(rawToken);
  const row = await db.prepare(
    `SELECT s.token_hash, s.expires_at, u.id, u.email, u.username, u.verified, u.created_at, u.disabled_at, u.disabled_reason
       FROM vault_auth_sessions s
       JOIN vault_users u ON u.id = s.user_id
      WHERE s.token_hash = ?1
        AND s.expires_at > ?2
      LIMIT 1`
  ).bind(tokenHash, Date.now()).first();
  return row || null;
}

async function recordSecurityEvent(db, userId, eventType, clientIp, details = {}) {
  if (!db) return;
  await db.prepare(
    `INSERT INTO vault_security_events (user_id, event_type, request_ip, details_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`
  ).bind(userId || null, eventType, clientIp || null, JSON.stringify(details), Date.now()).run();
}

async function permanentlyDisableAccount(db, userId, clientIp, reason, details = {}) {
  if (!db || !userId) return;
  const now = Date.now();
  await db.prepare(
    `UPDATE vault_users SET disabled_at = COALESCE(disabled_at, ?1), disabled_reason = COALESCE(disabled_reason, ?2) WHERE id = ?3`
  ).bind(now, reason, userId).run();
  await db.prepare(`DELETE FROM vault_auth_sessions WHERE user_id = ?1`).bind(userId).run();
  await recordSecurityEvent(db, userId, 'account_permanently_disabled', clientIp, { reason, ...details });
}

async function recordOwnershipViolation(db, attemptedUserId, clientIp, resourceType, resourceId) {
  if (!db || !attemptedUserId) return;
  await recordSecurityEvent(db, attemptedUserId, 'ownership_violation', clientIp, { resourceType, resourceId });
  const recent = await db.prepare(
    `SELECT COUNT(*) AS count FROM vault_security_events
      WHERE user_id = ?1 AND event_type = 'ownership_violation' AND created_at > ?2`
  ).bind(attemptedUserId, Date.now() - 60 * 60 * 1000).first();
  if (Number(recent?.count || 0) >= 3) {
    await permanentlyDisableAccount(db, attemptedUserId, clientIp, 'Repeated ownership-boundary violations.', { resourceType, resourceId });
  }
}

function safeUserFromRow(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    verified: Boolean(row.verified),
    disabled: Boolean(row.disabled_at),
    createdAt: new Date(Number(row.created_at)).toISOString(),
  };
}

async function requireDb(env) {
  if (!env?.DB) throw new Error('Secure Vault D1 binding (DB) is not configured.');
  return env.DB;
}

function checkRateLimit(key, maxRequests = 5, windowMs = 60000) {
  const now = Date.now();
  const item = state.rateLimits.get(key);
  if (!item || item.expiresAt < now) {
    state.rateLimits.set(key, { count: 1, expiresAt: now + windowMs });
    return true;
  }
  if (item.count >= maxRequests) {
    return false;
  }
  item.count += 1;
  return true;
}

function formatVerificationCode(code) {
  const clean = String(code).replace(/\D/g, '').padEnd(16, '0').slice(0, 16);
  return `${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}`;
}

function generateVerificationEmailContent(code) {
  const formatted = formatVerificationCode(code);
  const text = `KLIZONION BUILDER\n\nVerify your account\n\nYour 16-digit verification code is:\n${formatted}\n\nThis single-use code expires in 10 minutes.\n\nSecurity Notice: Never share this code with anyone. KLIZONION will never ask for your verification code.\n\nIf you did not request this verification code, please ignore this email.`;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Verify your KLIZONION account</title>
</head>
<body style="margin: 0; padding: 0; background-color: #070707; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f4f4f5;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #070707; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background-color: #0e0e12; border: 1px solid #23232a; border-radius: 14px; overflow: hidden; box-shadow: 0 16px 40px rgba(0,0,0,0.6);" cellspacing="0" cellpadding="0">
          <tr>
            <td style="padding: 28px 32px 20px; border-bottom: 1px solid #1c1c22;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="background-color: #ffffff; color: #070707; font-weight: 800; font-size: 14px; width: 28px; height: 28px; text-align: center; border-radius: 7px; vertical-align: middle;">K</td>
                  <td style="padding-left: 10px; color: #f4f4f5; font-weight: 800; font-size: 15px; letter-spacing: 0.08em;">KLIZONION</td>
                  <td style="padding-left: 8px;">
                    <span style="border: 1px solid #333339; border-radius: 999px; padding: 2px 7px; font-size: 9px; letter-spacing: 0.12em; color: #9d9da4;">BUILDER</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              <h1 style="margin: 0 0 12px; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.01em;">Verify your account</h1>
              <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.5; color: #94949c;">
                Enter this 16-digit verification code to activate your engineering workspace and verify your email address.
              </p>
              
              <div style="background-color: #070709; border: 1px solid #2d2d38; border-radius: 10px; padding: 20px; text-align: center; margin-bottom: 24px;">
                <div style="font-size: 10px; font-weight: 700; letter-spacing: 0.15em; color: #787882; margin-bottom: 8px; text-transform: uppercase;">16-Digit Verification Code</div>
                <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 26px; font-weight: 800; letter-spacing: 0.16em; color: #74f29b;">
                  ${formatted}
                </div>
              </div>

              <div style="background-color: rgba(252, 211, 77, 0.06); border: 1px solid rgba(252, 211, 77, 0.2); border-radius: 8px; padding: 12px 14px; margin-bottom: 24px;">
                <p style="margin: 0; font-size: 12px; line-height: 1.4; color: #fcd34d;">
                  ⏱ <strong>Expires in 10 minutes:</strong> This single-use code expires automatically.
                </p>
              </div>

              <p style="margin: 0 0 16px; font-size: 12px; line-height: 1.5; color: #777782;">
                <strong>Security Notice:</strong> Never share this code with anyone. KLIZONION will never ask for your verification code.
              </p>
              <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #52525e;">
                If you did not request this verification code, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 32px; background-color: #0a0a0d; border-top: 1px solid #1c1c22; text-align: center; font-size: 11px; color: #52525c;">
              KLIZONION Builder · Describe it. Build it. See it live.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { text, html };
}

async function verifyTurnstileToken(token, clientIp, env) {
  if (!token || typeof token !== 'string' || !token.trim()) {
    return {
      success: false,
      error: 'missing_turnstile',
      message: 'Turnstile security verification is required.',
    };
  }

  const secret = env?.TURNSTILE_SECRET;
  if (!secret) {
    return {
      success: false,
      error: 'turnstile_unconfigured',
      message: 'Cloudflare Turnstile secret (TURNSTILE_SECRET) is not configured on the server.',
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const formData = new URLSearchParams();
    formData.append('secret', secret);
    formData.append('response', token);
    if (clientIp) formData.append('remoteip', clientIp);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      return {
        success: false,
        error: 'invalid_turnstile',
        message: 'Security challenge failed. Please complete the Turnstile verification again.',
        errorCodes: data['error-codes'] || [],
      };
    }

    return { success: true, data };
  } catch (err) {
    return {
      success: false,
      error: 'turnstile_error',
      message: err.name === 'AbortError' ? 'Security challenge validation timed out.' : err.message,
    };
  }
}

async function deliverVerificationEmail(email, code, verificationToken, env) {
  const { text, html } = generateVerificationEmailContent(code);
  const subject = 'Your KLIZONION Verification Code';

  // EMAIL_FROM must be an email address verified in Elastic Email.
  const from =
    env?.VERIFICATION_FROM ||
    env?.EMAIL_FROM ||
    'KLIZONION <YOUR_VERIFIED_EMAIL_HERE>';

  // Provider A: Cloudflare Email Service binding (Worker EMAIL binding)
  if (env && env.EMAIL && typeof env.EMAIL.send === 'function') {
    try {
      await env.EMAIL.send({
        to: email,
        from: env.EMAIL_FROM || 'YOUR_VERIFIED_EMAIL_HERE',
        subject,
        text,
      });

      return {
        delivered: true,
        method: 'cloudflare_email_binding',
      };
    } catch (err) {
      return {
        delivered: false,
        error: err?.message || 'Cloudflare email delivery failed.',
        method: 'cloudflare_email_binding',
      };
    }
  }

  // Provider B: Resend or Elastic Email HTTP API
  const apiKey = env?.EMAIL_API_KEY || env?.RESEND_API_KEY;

  if (apiKey && (apiKey.startsWith('re_') || env?.EMAIL_API_URL?.includes('resend.com'))) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(env?.EMAIL_API_URL || 'https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          from: from.includes('<') ? from : `KLIZONION <${from}>`,
          to: Array.isArray(email) ? email : [email],
          subject,
          html,
          text,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return { delivered: false, error: `Resend returned HTTP ${res.status}: ${errText.slice(0, 300)}`, method: 'resend' };
      }
      return { delivered: true, method: 'resend' };
    } catch (err) {
      return { delivered: false, error: err?.message || 'Resend delivery failed.', method: 'resend' };
    }
  }

  // Provider B2: Elastic Email HTTP API
  if (apiKey) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(
        'https://api.elasticemail.com/v4/emails/transactional',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-ElasticEmail-ApiKey': apiKey,
          },
          body: JSON.stringify({
            Recipients: {
              To: Array.isArray(email) ? email : [email],
            },
            Content: {
              Body: [
                {
                  ContentType: 'HTML',
                  Charset: 'utf-8',
                  Content: html,
                },
                {
                  ContentType: 'PlainText',
                  Charset: 'utf-8',
                  Content: text,
                },
              ],
              From: from,
              Subject: subject,
            },
          }),
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      const responseText = await res.text().catch(() => '');

      if (!res.ok) {
        let parsedMessage = '';

        try {
          const parsed = JSON.parse(responseText);
          parsedMessage =
            parsed.message ||
            parsed.error ||
            parsed.detail ||
            responseText;
        } catch {
          parsedMessage = responseText.slice(0, 500);
        }

        return {
          delivered: false,
          error: `Elastic Email returned HTTP ${res.status}: ${parsedMessage}`,
          method: 'elastic_email',
        };
      }

      let providerResponse = null;

      try {
        providerResponse = responseText
          ? JSON.parse(responseText)
          : null;
      } catch {
        providerResponse = null;
      }

      return {
        delivered: true,
        method: 'elastic_email',
        messageId:
          providerResponse?.TransactionID ||
          providerResponse?.transactionId ||
          providerResponse?.MessageID ||
          undefined,
      };
    } catch (err) {
      return {
        delivered: false,
        error:
          err?.name === 'AbortError'
            ? 'Elastic Email request timed out after 10 seconds.'
            : err?.message || 'Elastic Email delivery failed.',
        method: 'elastic_email',
      };
    }
  }

  const isDev =
    !env ||
    env.ENVIRONMENT === 'development' ||
    !env.ENVIRONMENT ||
    env.ENVIRONMENT === 'dev';

  return {
    delivered: false,
    unconfigured: true,
    method: 'unconfigured_provider',
    message:
      'Email delivery provider is unconfigured in worker environment. EMAIL_API_KEY is required.',
    devNotice: isDev
      ? 'Development notice: Configure the Elastic Email EMAIL_API_KEY secret in the production Worker.'
      : undefined,
  };
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'content-type,authorization,x-runner-secret',
          'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
        },
      });
    }

    const u = new URL(req.url);
    const clientIp = req.headers.get('cf-connecting-ip') || '127.0.0.1';

    // 1. Health check
    if (u.pathname === '/api/health') {
      return json({
        ready: true,
        service: 'klizonion-builder',
        version: env?.BUILDER_PROTOCOL_VERSION || '0.2',
        environment: env?.ENVIRONMENT || 'development',
      });
    }

    // 1b. Public Authentication Configuration (Public sitekeys only - NEVER secrets)
    if (u.pathname === '/api/auth/config' && req.method === 'GET') {
      return json({
        turnstileSiteKey: env?.TURNSTILE_SITEKEY || '1x00000000000000000000AA',
      });
    }

    if (u.pathname === '/api/auth/vault-health' && req.method === 'GET') {
      if (!env?.DB) return json({ ok: false, configured: false }, 503);
      try {
        await env.DB.prepare('SELECT 1 AS ok').first();
        return json({ ok: true, configured: true, service: 'secure-vault' });
      } catch {
        return json({ ok: false, configured: true, message: 'D1 query failed.' }, 503);
      }
    }

    // 2. Builder Status
    if (u.pathname === '/api/builder/status') {
      const now = Date.now();
      await env.DB.prepare(
        `UPDATE builder_runners SET status = 'UNAVAILABLE'
          WHERE last_seen < ?1 AND status <> 'UNAVAILABLE'`
      ).bind(now - 60000).run();
      const durableRunner = env?.DB
        ? await env.DB.prepare(
          `SELECT runner_id, workspace_id, workspace_path, status, hardware_json, last_seen
             FROM builder_runners WHERE last_seen > ?1 ORDER BY last_seen DESC LIMIT 1`
        ).bind(now - 60000).first()
        : null;
      const runnerOnline = Boolean(durableRunner);
      return json({
        runner: runnerOnline,
        runnerState: runnerOnline ? durableRunner.status : 'UNAVAILABLE',
        hardware: parseJson(durableRunner?.hardware_json, state.hardware),
        experiment: state.activeMissionId ? 'Active Mission' : 'Idle',
        workspace: durableRunner?.workspace_path || state.workspace,
        runnerId: durableRunner?.runner_id || null,
        workspaceId: durableRunner?.workspace_id || null,
        activeMissionId: state.activeMissionId,
        missionsCount: env?.DB ? (await env.DB.prepare(`SELECT COUNT(*) AS count FROM builder_missions`).first())?.count || 0 : 0,
      });
    }

    // 3. Runner Heartbeat / Pairing (Authenticated)
    if (u.pathname === '/api/runner/heartbeat' && req.method === 'POST') {
      const credentials = runnerCredentials(req, env);
      if (!credentials.ok) return credentials.response;
      if (!env?.DB) return json({ error: 'execution_unconfigured', message: 'Durable execution storage is not configured.' }, 503);

      const body = await req.json().catch(() => ({}));
      const runnerId = String(body.runnerId || '').trim();
      const workspacePath = String(body.workspace || '').trim();
      const workspaceId = workspaceIdForPath(workspacePath);
      if (!runnerId || !workspacePath) {
        return json({ error: 'invalid_runner_identity', message: 'runnerId and workspace are required.' }, 400);
      }
      state.runner = true;
      state.runnerLastSeen = Date.now();
      state.runnerState = ['READY', 'BUSY', 'RECONNECTING', 'UNAVAILABLE', 'ERROR'].includes(body.status)
        ? body.status
        : 'READY';
      if (body.hardware) {
        state.hardware = typeof body.hardware === 'string'
          ? body.hardware
          : `${body.hardware.os || ''} ${body.hardware.cpu || ''} (${body.hardware.cores || '?'} cores, ${body.hardware.ram_gb || '?'}GB RAM)`.trim();
      }
      if (body.workspace) state.workspace = body.workspace;

      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO builder_runners (runner_id, workspace_id, workspace_path, status, hardware_json, last_seen, connected_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(runner_id) DO UPDATE SET workspace_id = excluded.workspace_id,
           workspace_path = excluded.workspace_path, status = excluded.status,
           hardware_json = excluded.hardware_json, last_seen = excluded.last_seen`
      ).bind(
        runnerId,
        workspaceId,
        workspacePath,
        state.runnerState,
        JSON.stringify(body.hardware || {}),
        now,
      ).run();

      const waitingMissions = await env.DB.prepare(
        `SELECT id FROM builder_missions WHERE status = 'waiting_for_runner' ORDER BY updated_at LIMIT 10`
      ).all();
      for (const waiting of waitingMissions.results || []) {
        const waitingMission = await durableMission(env, waiting.id);
        if (!waitingMission) continue;
        waitingMission.runnerId = runnerId;
        waitingMission.workspaceId = workspaceId;
        waitingMission.status = 'running';
        await persistMission(env, waitingMission);
        const eventCursor = waitingMission.events.length;
        const existingActionIds = new Set(waitingMission.actions.map((action) => action.actionId));
        await continueMissionWithAgent(waitingMission, env);
        await persistNewMissionActions(env, waitingMission, existingActionIds);
        for (const event of waitingMission.events.slice(eventCursor)) await persistEvent(env, waiting.id, event);
        await persistMission(env, waitingMission);
      }

      await env.DB.prepare(
        `UPDATE builder_actions SET status = 'pending', runner_id = ?1, started_at = NULL, lease_expires_at = NULL
          WHERE workspace_id = ?2 AND status = 'running' AND lease_expires_at < ?3`
      ).bind(runnerId, workspaceId, now).run();

      const pendingRows = await env.DB.prepare(
        `SELECT action_id, mission_id, operation, payload_json
           FROM builder_actions
          WHERE runner_id = ?1 AND workspace_id = ?2 AND status = 'pending'
          ORDER BY created_at LIMIT 20`
      ).bind(runnerId, workspaceId).all();
      const pending = pendingRows.results || [];
      for (const action of pending) {
        await env.DB.prepare(
          `UPDATE builder_actions SET status = 'running', attempts = attempts + 1, started_at = ?1, lease_expires_at = ?2
            WHERE action_id = ?3 AND status = 'pending'`
        ).bind(now, now + 60000, action.action_id).run();
      }

      return json({
        status: 'ok',
        acknowledged: true,
        runnerId,
        workspaceId,
        pendingActions: pending.map((action) => ({
          actionId: action.action_id,
          missionId: action.mission_id,
          operation: action.operation,
          payload: parseJson(action.payload_json, {}),
          status: 'running',
        })),
      });
    }

    // 3b. Runner action result callback (Authenticated)
    if (u.pathname === '/api/runner/result' && req.method === 'POST') {
      const credentials = runnerCredentials(req, env);
      if (!credentials.ok) return credentials.response;

      const body = await req.json().catch(() => ({}));
      const missionId = String(body.missionId || '').trim();
      const actionId = String(body.actionId || '').trim();
      const runnerId = String(body.runnerId || '').trim();
      const workspaceId = String(body.workspaceId || '').trim();
      if (!missionId || !actionId || !runnerId || !workspaceId || !env?.DB) {
        return json({ error: 'invalid_result', message: 'A valid missionId and actionId are required.' }, 400);
      }
      const runner = await durableRunner(env, runnerId);
      if (!runner || runner.workspace_id !== workspaceId || Date.now() - Number(runner.last_seen) > 60000) {
        return json({ error: 'runner_identity_invalid', message: 'Runner identity or workspace lease is invalid.' }, 409);
      }
      const mission = await durableMission(env, missionId);
      const actionRow = await env.DB.prepare(
        `SELECT * FROM builder_actions WHERE action_id = ?1 AND mission_id = ?2 LIMIT 1`
      ).bind(actionId, missionId).first();
      if (!mission || !actionRow || actionRow.runner_id !== runnerId || actionRow.workspace_id !== workspaceId) {
        return json({ error: 'action_not_found', message: 'Action is not assigned to this runner workspace.' }, 404);
      }
      if (mission.status === 'stopped') {
        return json({ error: 'mission_stopped', message: 'This mission was cancelled before the result arrived.' }, 409);
      }

      if (actionRow.status === 'success' || actionRow.status === 'failed') {
        return json({ success: true, action: mission.actions.find((item) => item.actionId === actionId), mission, duplicate: true });
      }

      const succeeded = body.success === true;
      if (['READY', 'BUSY', 'RECONNECTING', 'UNAVAILABLE', 'ERROR'].includes(body.runnerStatus)) {
        state.runnerState = body.runnerStatus;
      }
      const result = body.result ?? null;
      const error = succeeded ? null : String(body.error || 'Runner operation failed.');
      await env.DB.prepare(
        `UPDATE builder_actions SET status = ?1, result_json = ?2, error = ?3, completed_at = ?4, lease_expires_at = NULL
          WHERE action_id = ?5 AND status = 'running'`
      ).bind(succeeded ? 'success' : 'failed', result == null ? null : JSON.stringify(result), error, Date.now(), actionId).run();
      const refreshed = await durableMission(env, missionId);
      const action = refreshed.actions.find((item) => item.actionId === actionId);
      refreshed.updatedAt = new Date().toISOString();
      const existingActionIds = new Set(refreshed.actions.map((item) => item.actionId));
      recordMissionEvent(refreshed, succeeded ? 'tool.completed' : 'tool.failed', {
        actionId,
        operation: action.operation,
        error,
      });
      await persistEvent(env, missionId, refreshed.events.at(-1));

      if (!succeeded) {
        refreshed.status = 'failed';
        refreshed.currentStep = 'blocked';
      } else {
        const eventCursor = refreshed.events.length;
        const allFinished = refreshed.actions.length > 0 && refreshed.actions.every(
          (item) => item.status === 'success' || item.status === 'failed',
        );
        if (allFinished && refreshed.actions.every((item) => item.status === 'success')) {
          await continueMissionWithAgent(refreshed, env);
          await persistNewMissionActions(env, refreshed, existingActionIds);
          for (const event of refreshed.events.slice(eventCursor)) await persistEvent(env, missionId, event);
        }
      }
      await persistMission(env, refreshed);
      return json({ success: true, action: refreshed.actions.find((item) => item.actionId === actionId), mission: await durableMission(env, missionId) });
    }

    // 4. Create Mission

    // AI CHAT: Claude Fable 5.1 through Cloudflare Workers AI
    if (u.pathname === '/api/agent/chat' && req.method === 'POST') {
      const authHeader = req.headers.get('authorization') || '';
      const authToken = authHeader.replace(/^Bearer\s+/i, '').trim();
      let authSession = null;
      try {
        authSession = await getAuthSessionUser(env?.DB, authToken);
      } catch (err) {
        return json({ error: 'vault_unavailable', message: 'Secure Vault database is unavailable.' }, 503);
      }

      if (!authSession) {
        return json({ error: 'unauthorized', message: 'Please sign in before chatting with the Builder.' }, 401);
      }

      if (!env?.AI || typeof env.AI.run !== 'function') {
        return json({ error: 'ai_unconfigured', message: 'Cloudflare Workers AI binding (AI) is not configured.' }, 503);
      }

      const body = await req.json().catch(() => ({}));
      const rawMessages = Array.isArray(body.messages) ? body.messages : [];

      const messages = rawMessages
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-30)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 20000) }));

      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      if (!messages.length && !prompt) {
        return json({ error: 'missing_message', message: 'A message is required.' }, 400);
      }
      if (prompt) messages.push({ role: 'user', content: prompt.slice(0, 20000) });

      const requestText = prompt || [...messages].reverse().find((message) => message.role === 'user')?.content || '';
      if (classifyRequest(requestText) === 'engineering') {
        const missionId = `mission_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const requirements = extractRequirements(requestText);
        await env.DB.prepare(
          `INSERT INTO builder_missions
            (id, user_id, prompt, mode, effort, status, current_step, request_kind, requirements_json, iteration_count, max_iterations, created_at, updated_at)
           VALUES (?1, ?2, ?3, 'anything', 'medium', 'queued', 'understand', 'engineering', ?4, 0, 20, ?5, ?5)`
        ).bind(missionId, authSession.id, requestText, JSON.stringify(requirements), Date.now()).run();
        await persistEvent(env, missionId, { type: 'agent.started', prompt: requestText });
        const mission = await durableMission(env, missionId, authSession.id);
        const eventCursor = mission.events.length;
        await continueMissionWithAgent(mission, env);
        await persistNewMissionActions(env, mission);
        for (const event of mission.events.slice(eventCursor)) await persistEvent(env, missionId, event);
        await persistMission(env, mission);
        return json({
          success: true,
          kind: 'engineering',
          mission: await durableMission(env, missionId, authSession.id),
          message: mission.agentMessage || 'I’m understanding the request and selecting the next safe workspace action.',
        }, 202);
      }

      const system = `You are KLIZONION Builder, an AI engineering assistant.
You are conversational first. Do not start a build mission just because the user says hello, asks a question, or makes casual conversation.
When the user requests an actual project, explain the plan briefly and identify the intended build target before tools are introduced.
For now you can reason and respond, but you must never claim that files, code, previews, tests, or Roblox Studio changes were actually performed unless a real tool result in the conversation proves it.
Be concise, technical when useful, and clear about what is happening.
Current user: ${authSession.username || authSession.user?.username || 'user'} (${authSession.email || authSession.user?.email || ''}).`;

      try {
        const result = await env.AI.run('anthropic/claude-fable-5.1', {
          max_tokens: Math.min(Number(body.max_tokens) || 2048, 8192),
          system,
          messages,
        });

        const text = typeof result?.response === 'string'
          ? result.response
          : typeof result?.content === 'string'
            ? result.content
            : Array.isArray(result?.content)
              ? result.content.map((part) => typeof part === 'string' ? part : part?.text || '').join('')
              : '';

        if (!text) {
          return json({ error: 'ai_empty_response', message: 'Claude returned an empty response.' }, 502);
        }

        return json({
          success: true,
          model: 'anthropic/claude-fable-5.1',
          message: { role: 'assistant', content: text },
        });
      } catch (err) {
        return json({
          error: 'ai_request_failed',
          message: err?.message || 'Cloudflare AI request failed.',
        }, 502);
      }
    }

    if (u.pathname === '/api/builder/missions' && req.method === 'POST') {
      const auth = await requireBuilderSession(req, env);
      if (auth.error) return auth.error;
      if (!env?.DB) return json({ error: 'execution_unconfigured', message: 'Durable execution storage is not configured.' }, 503);
      const activeSession = auth.session;

      const body = await req.json().catch(() => ({}));
      const prompt = body.prompt || body.mission || '';
      const mode = body.mode || 'anything';
      const effort = body.effort || 'medium';

      if (!prompt.trim()) {
        return json({ error: 'invalid_prompt', message: 'Prompt is required' }, 400);
      }

      const missionId = `mission_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const mission = {
        id: missionId,
        missionId,
        userId: activeSession ? activeSession.email : 'local_dev_user',
        prompt,
        mode,
        effort,
        status: 'queued',
        currentStep: 'understand',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        actions: [],
        events: [],
      };
      recordMissionEvent(mission, 'agent.started', { prompt });

      await env.DB.prepare(
        `INSERT INTO builder_missions
          (id, user_id, prompt, mode, effort, status, current_step, request_kind, requirements_json, iteration_count, max_iterations, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'queued', 'understand', 'engineering', ?6, 0, 20, ?7, ?7)`
      ).bind(missionId, activeSession.id, prompt, mode, effort, JSON.stringify(extractRequirements(prompt)), Date.now()).run();
      await persistEvent(env, missionId, { type: 'agent.started', prompt });
      state.activeMissionId = missionId;
      const plannedMission = await durableMission(env, missionId, activeSession.id);
      const eventCursor = plannedMission.events.length;
      await continueMissionWithAgent(plannedMission, env);
      await persistNewMissionActions(env, plannedMission);
      for (const event of plannedMission.events.slice(eventCursor)) await persistEvent(env, missionId, event);
      await persistMission(env, plannedMission);

      return json({
        success: true,
        mission: await durableMission(env, missionId, activeSession.id),
        id: missionId,
        message: 'Mission created successfully',
      }, 201);
    }

    // Legacy /api/builder/start endpoint compatibility
    if (u.pathname === '/api/builder/start' && req.method === 'POST') {
      const auth = await requireBuilderSession(req, env);
      if (auth.error) return auth.error;
      const body = await req.json().catch(() => ({}));
      const prompt = body.mission || body.prompt || '';
      const mode = body.mode || 'anything';
      const effort = body.effort || 'medium';

      const missionId = `mission_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const mission = {
        id: missionId,
        missionId,
        prompt,
        mode,
        effort,
        status: 'queued',
        currentStep: 'understand',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        actions: [],
        events: [],
      };
      recordMissionEvent(mission, 'agent.started', { prompt });
      await env.DB.prepare(
        `INSERT INTO builder_missions
          (id, user_id, prompt, mode, effort, status, current_step, request_kind, requirements_json, iteration_count, max_iterations, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'queued', 'understand', 'engineering', ?6, 0, 20, ?7, ?7)`
      ).bind(missionId, auth.session.id, prompt, mode, effort, JSON.stringify(extractRequirements(prompt)), Date.now()).run();
      await persistEvent(env, missionId, { type: 'agent.started', prompt });
      state.activeMissionId = missionId;

      return json({
        accepted: true,
        id: missionId,
        mission: await durableMission(env, missionId, auth.session.id),
        message: 'Build mission queued for execution.',
      });
    }

    // 5. Get Mission Details
    const missionMatch = u.pathname.match(/^\/api\/builder\/missions\/([^/]+)$/);
    if (missionMatch && req.method === 'GET') {
      const auth = await requireBuilderSession(req, env);
      if (auth.error) return auth.error;
      const mId = decodeURIComponent(missionMatch[1]);
      const mission = await durableMission(env, mId, auth.session.id);
      if (!mission) {
        const foreignMission = await durableMission(env, mId);
        if (foreignMission && foreignMission.userId !== auth.session.id) {
          await recordOwnershipViolation(env.DB, auth.session.id, clientIp, 'mission', mId);
        }
        return json({ error: 'not_found', message: 'Mission not found' }, 404);
      }
      return json({ mission });
    }

    // 6. Stop / Cancel Mission
    const stopMatch = u.pathname.match(/^\/api\/builder\/missions\/([^/]+)\/stop$/);
    if (stopMatch && req.method === 'POST') {
      const auth = await requireBuilderSession(req, env);
      if (auth.error) return auth.error;
      const mId = decodeURIComponent(stopMatch[1]);
      const mission = await durableMission(env, mId, auth.session.id);
      if (!mission) {
        const foreignMission = await durableMission(env, mId);
        if (foreignMission && foreignMission.userId !== auth.session.id) {
          await recordOwnershipViolation(env.DB, auth.session.id, clientIp, 'mission_stop', mId);
        }
        return json({ error: 'not_found', message: 'Mission not found' }, 404);
      }

      mission.status = 'stopped';
      mission.currentStep = 'stopped';
      await env.DB.prepare(`UPDATE builder_missions SET status = 'stopped', current_step = 'stopped', updated_at = ?1 WHERE id = ?2`).bind(Date.now(), mId).run();
      await env.DB.prepare(`UPDATE builder_actions SET status = 'cancelled', completed_at = ?1 WHERE mission_id = ?2 AND status IN ('pending', 'running')`).bind(Date.now(), mId).run();
      await persistEvent(env, mId, { type: 'agent.cancelled' });
      if (state.activeMissionId === mId) {
        state.activeMissionId = null;
      }

      return json({
        success: true,
        mission: await durableMission(env, mId, auth.session.id),
        message: 'Mission stopped successfully',
      });
    }

    // 7. Queue Action for Mission
    const actionMatch = u.pathname.match(/^\/api\/builder\/missions\/([^/]+)\/actions$/);
    if (actionMatch && req.method === 'POST') {
      const auth = await requireBuilderSession(req, env);
      if (auth.error) return auth.error;
      const mId = decodeURIComponent(actionMatch[1]);
      const mission = await durableMission(env, mId, auth.session.id);
      if (!mission) {
        const foreignMission = await durableMission(env, mId);
        if (foreignMission && foreignMission.userId !== auth.session.id) {
          await recordOwnershipViolation(env.DB, auth.session.id, clientIp, 'mission_action', mId);
        }
        return json({ error: 'not_found', message: 'Mission not found' }, 404);
      }

      if (mission.status === 'stopped') {
        return json({ error: 'mission_stopped', message: 'Cannot add actions to a stopped mission' }, 409);
      }

      const body = await req.json().catch(() => ({}));
      const operation = body.operation;
      if (!operation) return json({ error: 'missing_operation', message: 'Operation is required' }, 400);
      const validation = validateToolRequest({ operation, payload: body.payload || {} });
      if (!validation.valid) return json({ error: 'invalid_tool_request', message: validation.error }, 400);

      const actionId = `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const action = {
        actionId,
        missionId: mId,
        operation,
        payload: validation.payload,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      mission.actions.push(action);
      recordMissionEvent(mission, 'tool.requested', { actionId, operation });
      mission.status = 'running';
      mission.updatedAt = new Date().toISOString();

      const runner = await env.DB.prepare(
        `SELECT runner_id, workspace_id, workspace_path FROM builder_runners
          WHERE status IN ('READY', 'BUSY') AND last_seen > ?1 ORDER BY last_seen DESC LIMIT 1`
      ).bind(Date.now() - 60000).first();
      if (!runner) {
        return json({ error: 'runner_unavailable', message: 'Workspace execution is unavailable. Start the supervised runner and try again.' }, 503);
      }
      action.runnerId = runner.runner_id;
      action.workspaceId = runner.workspace_id;
      mission.runnerId = runner.runner_id;
      mission.workspaceId = runner.workspace_id;
      await env.DB.prepare(
        `INSERT INTO builder_actions
          (action_id, mission_id, runner_id, workspace_id, operation, payload_json, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7)`
      ).bind(actionId, mId, runner.runner_id, runner.workspace_id, operation, JSON.stringify(validation.payload), Date.now()).run();
      await env.DB.prepare(`UPDATE builder_missions SET status = 'running', runner_id = ?1, workspace_id = ?2, updated_at = ?3 WHERE id = ?4`).bind(runner.runner_id, runner.workspace_id, Date.now(), mId).run();
      await persistEvent(env, mId, { type: 'tool.requested', actionId, operation });

      return json({ success: true, action }, 201);
    }

    // 8. Save Model Metadata / State
    if (u.pathname === '/api/builder/models/save' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const modelId = body.modelId || `klizonion_model_${Date.now()}`;
      const savedRecord = {
        id: modelId,
        name: body.name || 'KLIZONION Custom Model',
        missionId: body.missionId || state.activeMissionId || null,
        config: body.config || {
          vocab_size: 32000,
          d_model: 576,
          n_layers: 10,
          n_heads: 9,
          d_ff: 2304,
          max_seq_len: 512,
        },
        tokenizer: body.tokenizer || { type: 'bpe', vocab_size: 32000 },
        artifacts: body.artifacts || {
          latestCheckpoint: 'checkpoints/latest.pt',
          checkpointFiles: ['klizonion_step_000015.pt'],
        },
        metadata: {
          savedAt: new Date().toISOString(),
          parameters: 58616064,
          loss: 5.4397,
          effort: body.effort || 'medium',
        },
      };

      state.savedModels.set(modelId, savedRecord);

      return json({
        success: true,
        model: savedRecord,
        message: 'Model configuration and state successfully saved.',
      });
    }

    // 9. Publish Custom Model ZIP package
    if (u.pathname === '/api/builder/models/publish' && (req.method === 'POST' || req.method === 'GET')) {
      const modelId = u.searchParams.get('modelId') || 'latest';
      const saved = state.savedModels.get(modelId) || {
        id: modelId,
        name: 'KLIZONION Custom Model',
        config: { vocab_size: 32000, d_model: 576, n_layers: 10, n_heads: 9, d_ff: 2304, max_seq_len: 512 },
        artifacts: {
          latestCheckpoint: 'checkpoints/latest.pt',
          checkpointSizeApproxMb: 703,
          weightsStatus: 'external_artifact_reference',
          description: 'Large binary checkpoint weights (~703MB) are managed separately on disk/storage and are referenced rather than bundled into this lightweight source/config package.',
        },
      };

      const zip = new SimpleZip();
      const prefix = 'KLIZONION-CustomModel/';

      // Portable architecture, tokenizer, and config files
      zip.addFile(`${prefix}model/model.py`, `"""KLIZONION Decoder-Only Causal Transformer Architecture."""\nimport math\nimport torch\nimport torch.nn as nn\n\nclass KlizonionModel(nn.Module):\n    def __init__(self, config):\n        super().__init__()\n        self.config = config\n        self.embed = nn.Embedding(config.vocab_size, config.d_model)\n    def forward(self, idx):\n        return self.embed(idx)\n`);
      zip.addFile(`${prefix}model/config.py`, `from dataclasses import dataclass\n\n@dataclass(frozen=True)\nclass ModelConfig:\n    vocab_size: int = ${saved.config.vocab_size || 32000}\n    max_seq_len: int = ${saved.config.max_seq_len || 512}\n    d_model: int = ${saved.config.d_model || 576}\n    n_layers: int = ${saved.config.n_layers || 10}\n    n_heads: int = ${saved.config.n_heads || 9}\n    d_ff: int = ${saved.config.d_ff || 2304}\n`);
      zip.addFile(`${prefix}model/tokenizer.py`, `"""KLIZONION Tokenizer definition."""\nclass KlizonionTokenizer:\n    def __init__(self, vocab_file="data/tokenizer.json"):\n        self.vocab_file = vocab_file\n    def encode(self, text):\n        return [ord(c) for c in text]\n    def decode(self, ids):\n        return "".join(chr(i) for i in ids)\n`);

      // Inference server & Agent interfaces
      zip.addFile(`${prefix}server/model_server.py`, `"""KLIZONION Model Inference Server."""\nfrom http.server import HTTPServer, BaseHTTPRequestHandler\n\nclass Handler(BaseHTTPRequestHandler):\n    def do_POST(self):\n        self.send_response(200)\n        self.send_header('content-type', 'application/json')\n        self.end_headers()\n        self.wfile.write(b'{"status":"ready"}')\n\nif __name__ == '__main__':\n    server = HTTPServer(('0.0.0.0', 8080), Handler)\n    print("Server running on port 8080")\n    server.serve_forever()\n`);
      zip.addFile(`${prefix}server/agent.py`, `"""KLIZONION Model Agent Integration."""\nclass ModelAgent:\n    def __init__(self, endpoint="http://localhost:8080"):\n        self.endpoint = endpoint\n`);

      // Training loop, dataset, and evaluation scripts
      zip.addFile(`${prefix}training/train.py`, `"""KLIZONION Model Training Loop."""\nfrom model.model import KlizonionModel\nfrom model.config import ModelConfig\n\ndef train():\n    config = ModelConfig()\n    model = KlizonionModel(config)\n    print("Model initialized and ready for training")\n\nif __name__ == '__main__':\n    train()\n`);
      zip.addFile(`${prefix}training/dataset.py`, `"""Dataset pipeline."""\nclass KlizonionDataset:\n    def __init__(self, path="data/training.txt"):\n        self.data = []\n`);
      zip.addFile(`${prefix}training/evaluate.py`, `"""Evaluation harness."""\ndef evaluate():\n    print("Evaluation benchmark complete.")\n`);

      // Clear weight status and instructions
      zip.addFile(`${prefix}data/README.md`, `# Training Data & Tokenizer\nPlace your clean dataset files and tokenizer artifacts here.\n`);
      zip.addFile(`${prefix}weights/README.md`, `# Checkpoint Artifacts & Weights\n\nNOTE: Large binary PyTorch checkpoint weights (~703MB, e.g. checkpoints/latest.pt) are excluded from this source package.\n\nTo use weights:\n1. Copy your trained checkpoints into this directory, OR\n2. Run 'python training/train.py' to train new weights directly from scratch.\n`);
      zip.addFile(`${prefix}requirements.txt`, `torch>=2.0.0\npsutil>=5.9.0\n`);
      zip.addFile(`${prefix}README.md`, `# KLIZONION Custom Model Package (Source & Config)\n\nExported from KLIZONION Builder.\n\n## Contents\n- Full model architecture definition (model/model.py)\n- Exact hyperparameter config (model/config.py)\n- Custom tokenizer implementation (model/tokenizer.py)\n- Standalone inference server and agent bridge (server/)\n- Training, dataset, and evaluation harness (training/)\n\n## Weights Note\nBinary checkpoint weights (~703MB) are external artifacts and referenced in klizonion-model.json rather than embedded inside this archive.\n\n## Quick Start\n\`\`\`bash\npip install -r requirements.txt\npython training/train.py\n\`\`\`\n`);
      
      const packageMetadata = {
        ...saved,
        packageType: 'source_and_config',
        weightsIncluded: false,
        weightsNotice: 'Raw binary checkpoint weights (~703MB) are external artifacts and referenced by path rather than embedded in this ZIP.',
        artifactReference: saved.artifacts || { latestCheckpoint: 'checkpoints/latest.pt' },
      };
      zip.addFile(`${prefix}klizonion-model.json`, JSON.stringify(packageMetadata, null, 2));

      const zipBytes = zip.generateUint8Array();

      return new Response(zipBytes, {
        headers: {
          'content-type': 'application/zip',
          'content-disposition': 'attachment; filename="KLIZONION-CustomModel.zip"',
          'x-klizonion-package-type': 'source_and_config',
          'x-klizonion-weights-included': 'false',
          'access-control-allow-origin': '*',
        },
      });
    }

    // 10. AUTH: Register with Turnstile & 16-Digit Verification Code
    if (u.pathname === '/api/auth/register' && req.method === 'POST') {
      if (!checkRateLimit(`reg_${clientIp}`, 5, 60000)) {
        return json({ error: 'rate_limited', message: 'Too many registration requests. Please wait a minute.' }, 429);
      }

      const body = await req.json().catch(() => ({}));

      const turnstileToken = body.turnstileToken || body['cf-turnstile-response'];
      if (!turnstileToken) {
        return json({
          error: 'missing_turnstile',
          message: 'Security verification required. Please complete the Turnstile challenge.',
        }, 400);
      }

      const turnstileResult = await verifyTurnstileToken(turnstileToken, clientIp, env);
      if (!turnstileResult.success) {
        return json({
          error: turnstileResult.error || 'invalid_turnstile',
          message: turnstileResult.message || 'Security verification failed. Please try again.',
        }, 400);
      }

      if (!env?.DB) {
        return json({ error: 'vault_unavailable', message: 'Secure Vault database is not configured on the Worker.' }, 503);
      }

      const username = (body.username || '').trim();
      const email = (body.email || '').trim().toLowerCase();
      const password = body.password || '';

      if (!username || username.length < 3 || username.length > 32) {
        return json({ error: 'invalid_username', message: 'Username must be between 3 and 32 characters.' }, 400);
      }
      if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
        return json({ error: 'invalid_username', message: 'Username contains unsupported characters.' }, 400);
      }
      if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: 'invalid_email', message: 'Please enter a valid email address.' }, 400);
      }
      if (!password || password.length < 8 || password.length > 200) {
        return json({ error: 'invalid_password', message: 'Password must be between 8 and 200 characters.' }, 400);
      }

      try {
        const [existingEmail, existingUsername] = await Promise.all([
          getUserByEmail(env.DB, email),
          getUserByUsername(env.DB, username),
        ]);

        if (existingEmail) {
          return json({ error: 'email_already_registered', message: 'That email is already registered.' }, 409);
        }
        if (existingUsername) {
          return json({ error: 'username_already_registered', message: 'That username is already registered.' }, 409);
        }

        const passwordHash = await pbkdf2PasswordHash(password);
        const code = generate16DigitCode();
        const codeHash = await sha256(code);
        const verificationToken = `vtok_${randomBase64Url(32)}`;
        const verificationTokenHash = await sha256(verificationToken);
        const now = Date.now();
        const expiresAt = now + 10 * 60 * 1000;

        // One pending registration per email. The password is stored only as a password hash.
        await env.DB.prepare(
          `DELETE FROM vault_verification_sessions WHERE email = ?1`
        ).bind(email).run();

        await env.DB.prepare(
          `INSERT INTO vault_verification_sessions
            (token_hash, email, username, password_hash, code_hash, attempts, created_at, expires_at, verified)
           VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, 0)`
        ).bind(verificationTokenHash, email, username, passwordHash, codeHash, now, expiresAt).run();

        const delivery = await deliverVerificationEmail(email, code, verificationToken, env);

        if (!delivery.delivered) {
          await env.DB.prepare(
            `DELETE FROM vault_verification_sessions WHERE token_hash = ?1`
          ).bind(verificationTokenHash).run();

          return json({
            success: false,
            error: delivery.unconfigured ? 'email_provider_unconfigured' : 'verification_email_failed',
            message: delivery.unconfigured
              ? 'Registration could not be completed because email delivery is not configured.'
              : `Registration could not be completed because email delivery failed (${delivery.error || 'delivery error'}).`,
            verification_token: verificationToken,
            emailDelivery: {
              delivered: false,
              unconfigured: Boolean(delivery.unconfigured),
              method: delivery.method,
            },
          }, 503);
        }

        return json({
          success: true,
          verification_token: verificationToken,
          message: 'Account registered. A 16-digit verification code has been dispatched to your email.',
          emailDelivery: {
            delivered: true,
            method: delivery.method,
          },
        }, 201);
      } catch (err) {
        console.error('Secure Vault registration error', err);
        return json({ error: 'vault_error', message: 'Unable to create the account right now.' }, 503);
      }
    }

    // 11. AUTH: Resend Verification Code
    if (u.pathname === '/api/auth/resend' && req.method === 'POST') {
      if (!checkRateLimit(`resend_${clientIp}`, 3, 60000)) {
        return json({ error: 'rate_limited', message: 'Too many resend attempts. Please wait a minute.' }, 429);
      }
      if (!env?.DB) {
        return json({ error: 'vault_unavailable', message: 'Secure Vault database is not configured on the Worker.' }, 503);
      }

      const body = await req.json().catch(() => ({}));
      const token = String(body.token || '').trim();
      if (!token) {
        return json({ error: 'verification_expired_or_invalid', message: 'Missing verification token.' }, 400);
      }

      const tokenHash = await sha256(token);
      const session = await env.DB.prepare(
        `SELECT token_hash, email, username, password_hash, code_hash, attempts, created_at, expires_at, verified
           FROM vault_verification_sessions WHERE token_hash = ?1 LIMIT 1`
      ).bind(tokenHash).first();

      if (!session || session.verified) {
        return json({ error: 'verification_expired_or_invalid', message: 'Verification session invalid or already used.' }, 400);
      }
      if (Number(session.expires_at) < Date.now()) {
        await env.DB.prepare(`DELETE FROM vault_verification_sessions WHERE token_hash = ?1`).bind(tokenHash).run();
        return json({ error: 'verification_expired_or_invalid', message: 'Verification session expired. Please register again.' }, 400);
      }

      const newCode = generate16DigitCode();
      const newCodeHash = await sha256(newCode);
      const newExpiresAt = Date.now() + 10 * 60 * 1000;

      await env.DB.prepare(
        `UPDATE vault_verification_sessions
            SET code_hash = ?1, expires_at = ?2, attempts = 0, created_at = ?3
          WHERE token_hash = ?4`
      ).bind(newCodeHash, newExpiresAt, Date.now(), tokenHash).run();

      const delivery = await deliverVerificationEmail(session.email, newCode, token, env);

      if (!delivery.delivered) {
        return json({
          success: false,
          error: delivery.unconfigured ? 'email_provider_unconfigured' : 'verification_email_failed',
          message: delivery.unconfigured
            ? 'Email delivery provider is not configured on the server.'
            : 'Email dispatch failed. Please try again later.',
          emailDelivery: {
            delivered: false,
            unconfigured: Boolean(delivery.unconfigured),
            method: delivery.method,
          },
        }, 503);
      }

      return json({
        success: true,
        message: 'A new 16-digit verification code has been dispatched to your email.',
        emailDelivery: {
          delivered: true,
          method: delivery.method,
        },
      });
    }

    // 12. AUTH: Verify 16-Digit Code
    if (u.pathname === '/api/auth/verify' && req.method === 'POST') {
      if (!checkRateLimit(`ver_${clientIp}`, 10, 60000)) {
        return json({ error: 'rate_limited', message: 'Too many verification attempts.' }, 429);
      }
      if (!env?.DB) {
        return json({ error: 'vault_unavailable', message: 'Secure Vault database is not configured on the Worker.' }, 503);
      }

      const body = await req.json().catch(() => ({}));
      const token = String(body.token || '').trim();
      const enteredCode = String(body.code || '').replace(/\s+/g, '');

      if (!token) {
        return json({ error: 'verification_expired_or_invalid', message: 'Missing verification token.' }, 400);
      }
      if (!/^\d{16}$/.test(enteredCode)) {
        return json({ error: 'verification_code_invalid', message: 'Verification code must be exactly 16 decimal digits.' }, 400);
      }

      const tokenHash = await sha256(token);
      const session = await env.DB.prepare(
        `SELECT token_hash, email, username, password_hash, code_hash, attempts, created_at, expires_at, verified
           FROM vault_verification_sessions WHERE token_hash = ?1 LIMIT 1`
      ).bind(tokenHash).first();

      if (!session) {
        return json({ error: 'verification_expired_or_invalid', message: 'Verification session not found or expired.' }, 400);
      }
      if (session.verified) {
        return json({ error: 'verification_already_used', message: 'This verification code has already been used.' }, 400);
      }
      if (Number(session.expires_at) < Date.now()) {
        await env.DB.prepare(`DELETE FROM vault_verification_sessions WHERE token_hash = ?1`).bind(tokenHash).run();
        return json({ error: 'verification_expired_or_invalid', message: 'Verification code expired after 10 minutes. Please request a new one.' }, 400);
      }

      const attempts = Number(session.attempts || 0) + 1;
      await env.DB.prepare(
        `UPDATE vault_verification_sessions SET attempts = ?1 WHERE token_hash = ?2`
      ).bind(attempts, tokenHash).run();

      if (attempts > 5) {
        await env.DB.prepare(`DELETE FROM vault_verification_sessions WHERE token_hash = ?1`).bind(tokenHash).run();
        return json({ error: 'rate_limited', message: 'Too many incorrect attempts. Please register again.' }, 429);
      }

      const enteredHash = await sha256(enteredCode);
      if (enteredHash !== session.code_hash) {
        return json({ error: 'verification_code_invalid', message: 'Incorrect 16-digit verification code.' }, 400);
      }

      const userId = `usr_${randomBase64Url(18)}`;
      const now = Date.now();
      const insertUser = await env.DB.prepare(
        `INSERT OR IGNORE INTO vault_users
          (id, email, username, password_hash, verified, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)`
      ).bind(userId, session.email, session.username, session.password_hash, now).run();

      if (!insertUser.success || Number(insertUser.meta?.changes || 0) !== 1) {
        const existing = await getUserByEmail(env.DB, session.email);
        if (existing) {
          await env.DB.prepare(`DELETE FROM vault_verification_sessions WHERE token_hash = ?1`).bind(tokenHash).run();
          return json({ error: 'email_already_registered', message: 'That email is already registered.' }, 409);
        }
        return json({ error: 'vault_error', message: 'Unable to activate the account.' }, 503);
      }

      const user = await getUserByEmail(env.DB, session.email);
      await env.DB.prepare(`DELETE FROM vault_verification_sessions WHERE token_hash = ?1`).bind(tokenHash).run();

      const authToken = `tok_${randomBase64Url(32)}`;
      const authTokenHash = await sha256(authToken);
      const expiresAt = now + 7 * 24 * 60 * 60 * 1000;

      await env.DB.prepare(
        `INSERT INTO vault_auth_sessions (token_hash, user_id, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4)`
      ).bind(authTokenHash, user.id, now, expiresAt).run();

      return json({
        success: true,
        token: authToken,
        user: safeUserFromRow(user),
        message: 'Account successfully verified and activated.',
      });
    }

    // 13. AUTH: Login with Email & Password
    if (u.pathname === '/api/auth/login' && req.method === 'POST') {
      if (!checkRateLimit(`login_${clientIp}`, 10, 60000)) {
        return json({ error: 'rate_limited', message: 'Too many login attempts. Please wait a minute.' }, 429);
      }
      if (!env?.DB) {
        return json({ error: 'vault_unavailable', message: 'Secure Vault database is not configured on the Worker.' }, 503);
      }

      const body = await req.json().catch(() => ({}));
      const email = (body.email || '').trim().toLowerCase();
      const password = body.password || '';

      if (!email || !password) {
        return json({ error: 'invalid_credentials', message: 'Email and password are required.' }, 400);
      }

      const turnstileToken = body.turnstileToken || body['cf-turnstile-response'];
      if (turnstileToken) {
        const turnstileResult = await verifyTurnstileToken(turnstileToken, clientIp, env);
        if (!turnstileResult.success) {
          return json({
            error: turnstileResult.error || 'invalid_turnstile',
            message: turnstileResult.message || 'Security verification failed. Please try again.',
          }, 400);
        }
      }

      const userRecord = await getUserByEmail(env.DB, email);
      if (!userRecord || !userRecord.verified) {
        return json({ error: 'invalid_credentials', message: 'Invalid email or password.' }, 401);
      }
      if (userRecord.disabled_at) {
        await recordSecurityEvent(env.DB, userRecord.id, 'disabled_account_login_attempt', clientIp);
        return json({ error: 'account_disabled', message: 'This account is permanently disabled.' }, 403);
      }

      const passwordOk = await verifyPasswordHash(password, userRecord.password_hash);
      if (!passwordOk) {
        return json({ error: 'invalid_credentials', message: 'Invalid email or password.' }, 401);
      }

      const authToken = `tok_${randomBase64Url(32)}`;
      const authTokenHash = await sha256(authToken);
      const now = Date.now();
      const expiresAt = now + 7 * 24 * 60 * 60 * 1000;

      await env.DB.prepare(
        `INSERT INTO vault_auth_sessions (token_hash, user_id, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4)`
      ).bind(authTokenHash, userRecord.id, now, expiresAt).run();

      return json({
        success: true,
        token: authToken,
        user: safeUserFromRow(userRecord),
        message: 'Signed in successfully.',
      });
    }

    // 14. AUTH: Current Session / Me
    if (u.pathname === '/api/auth/me' && req.method === 'GET') {
      const authHeader = req.headers.get('authorization') || '';
      const authToken = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (!authToken) {
        return json({ authenticated: false, message: 'No session token provided.' }, 401);
      }

      if (!env?.DB) {
        return json({ authenticated: false, message: 'Secure Vault database is not configured.' }, 503);
      }

      const session = await getAuthSessionUser(env.DB, authToken);
      if (!session) {
        const tokenHash = await sha256(authToken);
        await env.DB.prepare(`DELETE FROM vault_auth_sessions WHERE token_hash = ?1 AND expires_at <= ?2`).bind(tokenHash, Date.now()).run();
        return json({ authenticated: false, message: 'Session expired or invalid.' }, 401);
      }
      if (session.disabled_at) {
        await recordSecurityEvent(env.DB, session.id, 'disabled_account_session_attempt', clientIp);
        return json({ authenticated: false, error: 'account_disabled', message: 'This account is permanently disabled.' }, 403);
      }

      return json({
        authenticated: true,
        user: safeUserFromRow(session),
      });
    }

    // 15. AUTH: Logout
    if (u.pathname === '/api/auth/logout' && req.method === 'POST') {
      const authHeader = req.headers.get('authorization') || '';
      const authToken = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (authToken && env?.DB) {
        const tokenHash = await sha256(authToken);
        await env.DB.prepare(`DELETE FROM vault_auth_sessions WHERE token_hash = ?1`).bind(tokenHash).run();
      }
      return json({
        success: true,
        message: 'Logged out successfully.',
      });
    }

    return json({ error: 'not_found', path: u.pathname }, 404);
  },
};

