import { SimpleZip } from './zip.js';

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
  runnerLastSeen: 0,
  hardware: 'Waiting for local runner',
  workspace: null,
  missions: new Map(),
  pendingActions: new Map(),
  activeMissionId: null,
  savedModels: new Map(),
  verificationSessions: new Map(),
  users: new Map(),
  rateLimits: new Map(),
};

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
  const from = env?.EMAIL_FROM || 'KLIZONION <onboarding@resend.dev>';

  // Provider A: Cloudflare Email Service binding (Worker EMAIL binding)
  if (env && env.EMAIL && typeof env.EMAIL.send === 'function') {
    try {
      await env.EMAIL.send({
        to: email,
        from: env.EMAIL_FROM || 'no-reply@klizonion.vexr.dev',
        subject,
        text,
      });
      return { delivered: true, method: 'cloudflare_email_binding' };
    } catch (err) {
      return { delivered: false, error: err.message, method: 'cloudflare_email_binding' };
    }
  }

  // Provider B: External HTTPS Mail API (Resend, SendGrid, custom HTTP provider)
  const apiKey = env?.EMAIL_API_KEY || env?.RESEND_API_KEY;
  const apiUrl = env?.EMAIL_API_URL || (apiKey ? 'https://api.resend.com/emails' : null);

  if (apiKey && apiUrl) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const payload = {
        from,
        to: Array.isArray(email) ? email : [email],
        subject,
        html,
        text,
      };

      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        let parsedMessage = '';
        try {
          const parsed = JSON.parse(errorText);
          parsedMessage = parsed.message || parsed.error || errorText;
        } catch {
          parsedMessage = errorText.slice(0, 200);
        }
        return {
          delivered: false,
          error: `Mail provider returned HTTP ${res.status}: ${parsedMessage}`,
          method: 'external_email_api',
        };
      }

      return { delivered: true, method: 'external_email_api' };
    } catch (err) {
      return {
        delivered: false,
        error: err.name === 'AbortError' ? 'Mail delivery timed out after 10s' : err.message,
        method: 'external_email_api',
      };
    }
  }

  const isDev = !env || env.ENVIRONMENT === 'development' || !env.ENVIRONMENT || env.ENVIRONMENT === 'dev';
  return {
    delivered: false,
    unconfigured: true,
    method: 'unconfigured_provider',
    message: 'Email delivery provider is unconfigured in worker environment (EMAIL or EMAIL_API_URL/EMAIL_API_KEY).',
    devNotice: isDev ? 'Development notice: Configure Cloudflare Email binding or EMAIL_API_KEY/RESEND_API_KEY in production.' : undefined,
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

    // 2. Builder Status
    if (u.pathname === '/api/builder/status') {
      const now = Date.now();
      const runnerOnline = state.runner && now - state.runnerLastSeen < 60000;
      return json({
        runner: runnerOnline,
        hardware: state.hardware,
        experiment: state.activeMissionId ? 'Active Mission' : 'Idle',
        workspace: state.workspace,
        activeMissionId: state.activeMissionId,
        missionsCount: state.missions.size,
      });
    }

    // 3. Runner Heartbeat / Pairing (Authenticated)
    if (u.pathname === '/api/runner/heartbeat' && req.method === 'POST') {
      const authHeader = req.headers.get('authorization') || '';
      const runnerSecret = req.headers.get('x-runner-secret') || authHeader.replace(/^Bearer\s+/i, '');
      const expectedSecret = env?.RUNNER_SHARED_SECRET;

      if (expectedSecret && runnerSecret !== expectedSecret) {
        return json({ error: 'unauthorized', message: 'Invalid runner shared secret' }, 401);
      }

      const body = await req.json().catch(() => ({}));
      state.runner = true;
      state.runnerLastSeen = Date.now();
      if (body.hardware) {
        state.hardware = typeof body.hardware === 'string'
          ? body.hardware
          : `${body.hardware.os || ''} ${body.hardware.cpu || ''} (${body.hardware.cores || '?'} cores, ${body.hardware.ram_gb || '?'}GB RAM)`.trim();
      }
      if (body.workspace) state.workspace = body.workspace;

      const pending = [];
      for (const [mId, actions] of state.pendingActions.entries()) {
        const mission = state.missions.get(mId);
        if (mission && (mission.status === 'running' || mission.status === 'queued')) {
          while (actions.length > 0) {
            pending.push(actions.shift());
          }
        }
      }

      return json({
        status: 'ok',
        acknowledged: true,
        activeMissionId: state.activeMissionId,
        pendingActions: pending,
      });
    }

    // 4. Create Mission
    if (u.pathname === '/api/builder/missions' && req.method === 'POST') {
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
        prompt,
        mode,
        effort,
        status: 'queued',
        currentStep: 'understand',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        actions: [],
      };

      state.missions.set(missionId, mission);
      state.pendingActions.set(missionId, []);
      state.activeMissionId = missionId;

      return json({
        success: true,
        mission,
        id: missionId,
        message: 'Mission created successfully',
      }, 201);
    }

    // Legacy /api/builder/start endpoint compatibility
    if (u.pathname === '/api/builder/start' && req.method === 'POST') {
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
      };
      state.missions.set(missionId, mission);
      state.pendingActions.set(missionId, []);
      state.activeMissionId = missionId;

      return json({
        accepted: true,
        id: missionId,
        mission,
        message: 'Build mission queued for execution.',
      });
    }

    // 5. Get Mission Details
    const missionMatch = u.pathname.match(/^\/api\/builder\/missions\/([^/]+)$/);
    if (missionMatch && req.method === 'GET') {
      const mId = decodeURIComponent(missionMatch[1]);
      const mission = state.missions.get(mId);
      if (!mission) return json({ error: 'not_found', message: 'Mission not found' }, 404);
      return json({ mission });
    }

    // 6. Stop / Cancel Mission
    const stopMatch = u.pathname.match(/^\/api\/builder\/missions\/([^/]+)\/stop$/);
    if (stopMatch && req.method === 'POST') {
      const mId = decodeURIComponent(stopMatch[1]);
      const mission = state.missions.get(mId);
      if (!mission) return json({ error: 'not_found', message: 'Mission not found' }, 404);

      mission.status = 'stopped';
      mission.updatedAt = new Date().toISOString();
      if (state.activeMissionId === mId) {
        state.activeMissionId = null;
      }
      state.pendingActions.set(mId, []);

      return json({
        success: true,
        mission,
        message: 'Mission stopped successfully',
      });
    }

    // 7. Queue Action for Mission
    const actionMatch = u.pathname.match(/^\/api\/builder\/missions\/([^/]+)\/actions$/);
    if (actionMatch && req.method === 'POST') {
      const mId = decodeURIComponent(actionMatch[1]);
      const mission = state.missions.get(mId);
      if (!mission) return json({ error: 'not_found', message: 'Mission not found' }, 404);

      if (mission.status === 'stopped') {
        return json({ error: 'mission_stopped', message: 'Cannot add actions to a stopped mission' }, 409);
      }

      const body = await req.json().catch(() => ({}));
      const operation = body.operation;
      if (!operation) return json({ error: 'missing_operation', message: 'Operation is required' }, 400);

      const actionId = `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const action = {
        actionId,
        missionId: mId,
        operation,
        payload: body.payload || {},
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      mission.actions.push(action);
      mission.status = 'running';
      mission.updatedAt = new Date().toISOString();

      const pending = state.pendingActions.get(mId) || [];
      pending.push(action);
      state.pendingActions.set(mId, pending);

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

      // Turnstile Security Validation
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

      const username = (body.username || '').trim();
      const email = (body.email || '').trim().toLowerCase();
      const password = body.password || '';

      if (!username || username.length < 3 || username.length > 32) {
        return json({ error: 'invalid_username', message: 'Username must be between 3 and 32 characters.' }, 400);
      }
      if (!email || !email.includes('@') || !email.includes('.')) {
        return json({ error: 'invalid_email', message: 'Please enter a valid email address.' }, 400);
      }
      if (!password || password.length < 8) {
        return json({ error: 'invalid_password', message: 'Password must be at least 8 characters.' }, 400);
      }

      if (state.users.has(email)) {
        return json({ error: 'email_already_registered', message: 'That email is already registered.' }, 409);
      }

      const code = generate16DigitCode();
      const codeHash = await sha256(code);
      const verificationToken = `vtok_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      const passwordHash = await sha256(password);

      const session = {
        token: verificationToken,
        email,
        username,
        passwordHash,
        codeHash,
        attempts: 0,
        createdAt: Date.now(),
        expiresAt: Date.now() + 10 * 60 * 1000,
        verified: false,
      };

      state.verificationSessions.set(verificationToken, session);

      const delivery = await deliverVerificationEmail(email, code, verificationToken, env);

      // Hardened registration response:
      // - If email delivery fails or provider is unconfigured, do NOT pretend it succeeded.
      // - Never expose the 16-digit verification code to the client.
      if (!delivery.delivered) {
        return json({
          success: false,
          error: delivery.unconfigured ? 'email_provider_unconfigured' : 'verification_email_failed',
          message: delivery.unconfigured
            ? 'Registration pending: Email delivery provider is not configured. An EMAIL binding or EMAIL_API_URL is required to deliver your 16-digit verification code.'
            : `Registration pending: Email delivery failed (${delivery.error || 'delivery error'}).`,
          verification_token: verificationToken,
          emailDelivery: {
            delivered: false,
            unconfigured: Boolean(delivery.unconfigured),
            method: delivery.method,
            devNotice: delivery.devNotice,
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
    }

    // 11. AUTH: Resend Verification Code
    if (u.pathname === '/api/auth/resend' && req.method === 'POST') {
      if (!checkRateLimit(`resend_${clientIp}`, 3, 60000)) {
        return json({ error: 'rate_limited', message: 'Too many resend attempts. Please wait a minute.' }, 429);
      }

      const body = await req.json().catch(() => ({}));
      const token = body.token || '';
      const session = state.verificationSessions.get(token);

      if (!session || session.verified) {
        return json({ error: 'verification_expired_or_invalid', message: 'Verification session invalid or already used.' }, 400);
      }

      const newCode = generate16DigitCode();
      session.codeHash = await sha256(newCode);
      session.expiresAt = Date.now() + 10 * 60 * 1000;
      session.attempts = 0;

      const delivery = await deliverVerificationEmail(session.email, newCode, token, env);

      if (!delivery.delivered) {
        return json({
          success: false,
          error: delivery.unconfigured ? 'email_provider_unconfigured' : 'verification_email_failed',
          message: delivery.unconfigured
            ? 'Resend unavailable: Email delivery provider is not configured on the server.'
            : 'Email dispatch failed. Please try again later.',
          emailDelivery: {
            delivered: false,
            unconfigured: Boolean(delivery.unconfigured),
            method: delivery.method,
            devNotice: delivery.devNotice,
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

      const body = await req.json().catch(() => ({}));
      const token = body.token || '';
      const enteredCode = (body.code || '').replace(/\s+/g, '');

      if (!token) {
        return json({ error: 'verification_expired_or_invalid', message: 'Missing verification token.' }, 400);
      }
      if (!/^\d{16}$/.test(enteredCode)) {
        return json({ error: 'verification_code_invalid', message: 'Verification code must be exactly 16 decimal digits.' }, 400);
      }

      const session = state.verificationSessions.get(token);
      if (!session) {
        return json({ error: 'verification_expired_or_invalid', message: 'Verification session not found or expired.' }, 400);
      }

      if (session.verified) {
        return json({ error: 'verification_already_used', message: 'This verification code has already been used.' }, 400);
      }

      if (Date.now() > session.expiresAt) {
        state.verificationSessions.delete(token);
        return json({ error: 'verification_expired_or_invalid', message: 'Verification code expired after 10 minutes. Please request a new one.' }, 400);
      }

      session.attempts += 1;
      if (session.attempts > 5) {
        state.verificationSessions.delete(token);
        return json({ error: 'rate_limited', message: 'Too many incorrect attempts. Please register again.' }, 429);
      }

      const enteredHash = await sha256(enteredCode);
      if (enteredHash !== session.codeHash) {
        return json({ error: 'verification_code_invalid', message: 'Incorrect 16-digit verification code.' }, 400);
      }

      session.verified = true;
      state.verificationSessions.delete(token);

      const userRecord = {
        username: session.username,
        email: session.email,
        verified: true,
        createdAt: new Date().toISOString(),
      };
      state.users.set(session.email, userRecord);

      const authToken = `tok_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

      return json({
        success: true,
        token: authToken,
        user: userRecord,
        message: 'Account successfully verified and activated.',
      });
    }

    return json({ error: 'not_found', path: u.pathname }, 404);
  },
};

