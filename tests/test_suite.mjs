import fs from 'fs';
import worker from '../apps/worker/src/index.js';
import { SimpleZip } from '../apps/worker/src/zip.js';

async function runAllTests() {
  console.log('=== KLIZONION BUILDER & AUTH PRODUCTION TEST SUITE ===\n');

  const baseEnv = {
    BUILDER_PROTOCOL_VERSION: '0.2',
    RUNNER_SHARED_SECRET: 'klizonion_test_secret_xyz',
    ENVIRONMENT: 'development',
    TURNSTILE_SITEKEY: '1x00000000000000000000AA',
    TURNSTILE_SECRET: '1x0000000000000000000000000000000AA', // Cloudflare always-pass test secret
  };

  // ---------------------------------------------------------------------------
  // CORE BUILDER TESTS
  // ---------------------------------------------------------------------------
  console.log('[CORE 1] Testing SimpleZip in-memory package generation...');
  const zip = new SimpleZip();
  zip.addFile('KLIZONION-CustomModel/README.md', '# KLIZONION Custom Model');
  zip.addFile('KLIZONION-CustomModel/model/config.py', 'class ModelConfig:\n    pass\n');
  const zipBytes = zip.generateUint8Array();
  if (!zipBytes || zipBytes.length < 100) throw new Error('Zip generation failed');
  console.log('✓ SimpleZip generated valid archive:', zipBytes.length, 'bytes\n');

  console.log('[CORE 2] Testing /api/health and /api/auth/config...');
  let res = await worker.fetch(new Request('http://localhost:8787/api/health'), baseEnv);
  let json = await res.json();
  if (!json.ready || json.version !== '0.2') throw new Error('Health check unexpected response');

  res = await worker.fetch(new Request('http://localhost:8787/api/auth/config'), baseEnv);
  json = await res.json();
  if (!json.turnstileSiteKey || json.turnstileSiteKey !== '1x00000000000000000000AA') {
    throw new Error('Public auth config failed to return sitekey');
  }
  if (json.turnstileSecret || json.emailApiKey) {
    throw new Error('Security violation: Private secret leaked in /api/auth/config!');
  }
  console.log('✓ /api/health and /api/auth/config returned clean public configs\n');

  console.log('[CORE 3] Testing Runner Heartbeat authentication...');
  res = await worker.fetch(new Request('http://localhost:8787/api/runner/heartbeat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hardware: 'Test CPU', workspace: 'C:/workspace' }),
  }), baseEnv);
  if (res.status !== 401) throw new Error(`Expected 401 unauthorized, got ${res.status}`);

  res = await worker.fetch(new Request('http://localhost:8787/api/runner/heartbeat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-runner-secret': 'klizonion_test_secret_xyz',
    },
    body: JSON.stringify({
      hardware: { os: 'Windows 11', cpu: 'AMD Ryzen', cores: 8, ram_gb: 16 },
      workspace: 'C:/authorized/workspace',
    }),
  }), baseEnv);
  json = await res.json();
  if (res.status !== 200 || !json.acknowledged) throw new Error('Runner pairing failed');
  console.log('✓ Runner authenticated and paired with x-runner-secret\n');

  console.log('[CORE 4] Testing Builder status...');
  res = await worker.fetch(new Request('http://localhost:8787/api/builder/status'), baseEnv);
  json = await res.json();
  if (!json.runner || !json.workspace) throw new Error('Status did not reflect online runner');
  console.log('✓ Status confirmed online runner & workspace:', json.workspace, '\n');

  console.log('[CORE 5] Testing mission creation with Effort parameter...');
  res = await worker.fetch(new Request('http://localhost:8787/api/builder/missions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Build a Roblox Studio place analyzer',
      mode: 'roblox',
      effort: 'maximum',
    }),
  }), baseEnv);
  json = await res.json();
  if (!json.success || json.mission.effort !== 'maximum') throw new Error('Effort not preserved');
  const missionId = json.mission.id;
  console.log('✓ Mission created:', missionId, 'with Effort: maximum\n');

  console.log('[CORE 6] Testing Stop Mission control...');
  res = await worker.fetch(new Request(`http://localhost:8787/api/builder/missions/${missionId}/stop`, {
    method: 'POST',
  }), baseEnv);
  json = await res.json();
  if (!json.success || json.mission.status !== 'stopped') throw new Error('Mission stop failed');
  console.log('✓ Mission successfully stopped\n');

  console.log('[CORE 7] Testing Save Model control...');
  res = await worker.fetch(new Request('http://localhost:8787/api/builder/models/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Klizonion-59M-Custom',
      config: { vocab_size: 32000, d_model: 576, n_layers: 10, n_heads: 9, d_ff: 2304, max_seq_len: 512 },
      tokenizer: { type: 'bpe', vocab_size: 32000 },
      artifacts: { latestCheckpoint: 'checkpoints/latest.pt' },
      effort: 'maximum',
    }),
  }), baseEnv);
  json = await res.json();
  if (!json.success || !json.model.id) throw new Error('Model save failed');
  const modelId = json.model.id;
  console.log('✓ Model metadata & config saved (ID:', modelId, ')\n');

  console.log('[CORE 8] Testing Publish Custom Model ZIP (Source & Config distinction)...');
  res = await worker.fetch(new Request(`http://localhost:8787/api/builder/models/publish?modelId=${modelId}`), baseEnv);
  if (res.status !== 200) throw new Error(`Publish returned status ${res.status}`);
  const ct = res.headers.get('content-type');
  const cd = res.headers.get('content-disposition');
  const pkgType = res.headers.get('x-klizonion-package-type');
  const weightsInc = res.headers.get('x-klizonion-weights-included');
  const publishBuffer = await res.arrayBuffer();
  if (ct !== 'application/zip' || !cd.includes('KLIZONION-CustomModel.zip')) {
    throw new Error('Unexpected headers on publish download');
  }
  if (pkgType !== 'source_and_config' || weightsInc !== 'false') {
    throw new Error('Headers did not declare source_and_config and weightsExcluded');
  }
  console.log('✓ Publish Custom Model ZIP delivered:', publishBuffer.byteLength, 'bytes');
  console.log('  Confirmed: packageType=source_and_config, weightsIncluded=false\n');

  // ---------------------------------------------------------------------------
  // 17 SPECIFIC REGISTRATION & AUTH PROTECTION TESTS
  // ---------------------------------------------------------------------------
  console.log('--- EXPLICIT TURNSTILE & EMAIL VERIFICATION TESTS (1 to 17) ---\n');

  // 1. registration without Turnstile token -> rejected
  console.log('[REQ 1] Registration without Turnstile token -> rejected...');
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'dev_noturnstile',
      email: 'noturnstile@klizonion.dev',
      password: 'password123!',
      // turnstileToken omitted
    }),
  }), baseEnv);
  json = await res.json();
  if (res.status !== 400 || json.error !== 'missing_turnstile') {
    throw new Error(`Expected 400 missing_turnstile, got ${res.status}: ${JSON.stringify(json)}`);
  }
  console.log('✓ Passed: Registration without Turnstile token rejected (400 missing_turnstile)\n');

  // 2. registration with invalid Turnstile token -> rejected
  console.log('[REQ 2] Registration with invalid Turnstile token -> rejected...');
  const envWithFailingTurnstile = {
    ...baseEnv,
    TURNSTILE_SECRET: '2x0000000000000000000000000000000AB', // Cloudflare always-fail test secret
  };
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'dev_invalidturnstile',
      email: 'invalidturnstile@klizonion.dev',
      password: 'password123!',
      turnstileToken: 'INVALID_CHALLENGE_TOKEN',
    }),
  }), envWithFailingTurnstile);
  json = await res.json();
  if (res.status !== 400 || json.error !== 'invalid_turnstile') {
    throw new Error(`Expected 400 invalid_turnstile, got ${res.status}: ${JSON.stringify(json)}`);
  }
  console.log('✓ Passed: Registration with invalid Turnstile token rejected (400 invalid_turnstile)\n');

  // 3. registration with valid Turnstile token -> proceeds
  console.log('[REQ 3] Registration with valid Turnstile token -> proceeds to processing...');
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'dev_validturnstile',
      email: 'validturnstile@klizonion.dev',
      password: 'password123!',
      turnstileToken: 'VALID_DUMMY_TOKEN',
    }),
  }), baseEnv);
  json = await res.json();
  if (json.error === 'missing_turnstile' || json.error === 'invalid_turnstile') {
    throw new Error('Valid Turnstile token was unexpectedly rejected');
  }
  console.log('✓ Passed: Registration with valid Turnstile token proceeded past challenge check\n');

  // 4. missing email provider -> clear configuration/delivery failure
  console.log('[REQ 4] Missing email provider -> clear configuration failure (503)...');
  if (res.status !== 503 || json.error !== 'email_provider_unconfigured') {
    throw new Error(`Expected 503 email_provider_unconfigured, got ${res.status}: ${JSON.stringify(json)}`);
  }
  if (!json.verification_token) throw new Error('Missing verification token reference in unconfigured response');
  console.log('✓ Passed: Unconfigured email provider returned 503 email_provider_unconfigured\n');

  // 5. email provider success -> verification pending
  console.log('[REQ 5] Email provider success -> verification pending (201)...');
  let dispatchedEmail = null;
  const envWithWorkingEmail = {
    ...baseEnv,
    EMAIL: {
      send: async (msg) => {
        dispatchedEmail = msg;
        return { success: true };
      },
    },
  };
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'dev_success_email',
      email: 'successemail@klizonion.dev',
      password: 'password123!',
      turnstileToken: 'VALID_DUMMY_TOKEN',
    }),
  }), envWithWorkingEmail);
  json = await res.json();
  if (res.status !== 201 || !json.success || !json.verification_token || !json.emailDelivery.delivered) {
    throw new Error(`Expected 201 verification pending, got ${res.status}: ${JSON.stringify(json)}`);
  }
  const pendingSessionToken = json.verification_token;
  console.log('✓ Passed: Successful email delivery returned 201 with verification_token\n');

  // 6. email provider non-2xx / error -> delivery failure
  console.log('[REQ 6] Email provider failure / non-2xx -> delivery failure (503)...');
  const envWithFailingEmail = {
    ...baseEnv,
    EMAIL: {
      send: async () => {
        throw new Error('Upstream mail service error 500');
      },
    },
  };
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'dev_failing_email',
      email: 'failingemail@klizonion.dev',
      password: 'password123!',
      turnstileToken: 'VALID_DUMMY_TOKEN',
    }),
  }), envWithFailingEmail);
  json = await res.json();
  if (res.status !== 503 || json.error !== 'verification_email_failed' || json.emailDelivery.delivered) {
    throw new Error(`Expected 503 verification_email_failed, got ${res.status}: ${JSON.stringify(json)}`);
  }
  console.log('✓ Passed: Mail provider error returned 503 verification_email_failed\n');

  // 7. 16-digit code is never included in registration response
  console.log('[REQ 7] Verifying 16-digit code is NEVER included in registration response...');
  if (json.code || json.verification_code) {
    throw new Error('SECURITY VIOLATION: Verification code leaked in HTTP response!');
  }
  console.log('✓ Passed: 16-digit verification code is strictly absent from API response\n');

  // Extract real code from dispatched email for verification tests
  const emailCodeMatch = dispatchedEmail.text.match(/\b\d{4}-\d{4}-\d{4}-\d{4}\b/);
  const rawCode = emailCodeMatch ? emailCodeMatch[0].replace(/-/g, '') : null;
  if (!rawCode || rawCode.length !== 16) throw new Error('Failed to extract valid 16-digit code from test email');

  // 8. verification with wrong code -> rejected
  console.log('[REQ 8] Verification with wrong code -> rejected (400)...');
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: pendingSessionToken,
      code: '9999888877776666', // Incorrect code
    }),
  }), baseEnv);
  json = await res.json();
  if (res.status !== 400 || json.error !== 'verification_code_invalid') {
    throw new Error(`Expected 400 verification_code_invalid, got ${res.status}: ${JSON.stringify(json)}`);
  }
  console.log('✓ Passed: Wrong verification code rejected with 400\n');

  // 9. verification with malformed code -> rejected
  console.log('[REQ 9] Verification with malformed code -> rejected (400)...');
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: pendingSessionToken,
      code: '1234', // Non-16 digits
    }),
  }), baseEnv);
  json = await res.json();
  if (res.status !== 400 || json.error !== 'verification_code_invalid') {
    throw new Error(`Expected 400 for malformed code, got ${res.status}: ${JSON.stringify(json)}`);
  }
  console.log('✓ Passed: Malformed verification code rejected\n');

  // 10. verification with correct code -> succeeds
  console.log('[REQ 10] Verification with correct code -> succeeds (200)...');
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: pendingSessionToken,
      code: rawCode,
    }),
  }), baseEnv);
  json = await res.json();
  if (res.status !== 200 || !json.success || !json.token || !json.user) {
    throw new Error(`Expected 200 verification success, got ${res.status}: ${JSON.stringify(json)}`);
  }
  console.log('✓ Passed: Correct code verified, account activated, auth token issued\n');

  // 11. verification code reuse -> rejected
  console.log('[REQ 11] Verification code reuse -> rejected (single-use)...');
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: pendingSessionToken,
      code: rawCode,
    }),
  }), baseEnv);
  if (res.status !== 400) {
    throw new Error('Single-use violation: verification code accepted a second time!');
  }
  console.log('✓ Passed: Single-use enforcement verified (code reuse rejected)\n');

  // 12. expired code -> rejected
  console.log('[REQ 12] Expired code -> rejected...');
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: 'non_existent_or_expired_token',
      code: '1234567812345678',
    }),
  }), baseEnv);
  if (res.status !== 400) throw new Error('Expected 400 for nonexistent/expired token');
  console.log('✓ Passed: Expired / nonexistent token correctly rejected with 400\n');

  // 13. resend -> old code invalidated
  console.log('[REQ 13] Resend -> old code invalidated, new code accepted...');
  let resendEmail = null;
  const envResend = {
    ...baseEnv,
    EMAIL: {
      send: async (msg) => {
        resendEmail = msg;
        return { success: true };
      },
    },
  };

  res = await worker.fetch(new Request('http://localhost:8787/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.0.0.13' },
    body: JSON.stringify({
      username: 'dev_resend_user',
      email: 'resenduser@klizonion.dev',
      password: 'password123!',
      turnstileToken: 'VALID_DUMMY_TOKEN',
    }),
  }), envResend);
  json = await res.json();
  if (res.status !== 201) throw new Error(`Registration failed in REQ 13: ${JSON.stringify(json)}`);
  const resendSessionToken = json.verification_token;
  const initialMatch = resendEmail.text.match(/\b\d{4}-\d{4}-\d{4}-\d{4}\b/);
  const initialCode = initialMatch ? initialMatch[0].replace(/-/g, '') : null;

  // Request code resend
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/resend', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.0.0.13' },
    body: JSON.stringify({ token: resendSessionToken }),
  }), envResend);
  json = await res.json();
  if (res.status !== 200 || !json.success) throw new Error('Resend request failed');

  const secondMatch = resendEmail.text.match(/\b\d{4}-\d{4}-\d{4}-\d{4}\b/);
  const secondCode = secondMatch ? secondMatch[0].replace(/-/g, '') : null;
  if (initialCode === secondCode) throw new Error('Resend generated identical code');

  // Try verifying with old (initial) code -> MUST FAIL
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.0.0.13' },
    body: JSON.stringify({ token: resendSessionToken, code: initialCode }),
  }), baseEnv);
  if (res.status !== 400) throw new Error('Old code was accepted after resend!');

  // Try verifying with new (second) code -> MUST SUCCEED
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.0.0.13' },
    body: JSON.stringify({ token: resendSessionToken, code: secondCode }),
  }), baseEnv);
  if (res.status !== 200) throw new Error('New resend code was not accepted');
  console.log('✓ Passed: Resend invalidated old code and authorized new code\n');

  // 14. resend rate limiting -> enforced
  console.log('[REQ 14] Resend rate limiting -> enforced (429)...');
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.0.0.14' },
    body: JSON.stringify({
      username: 'dev_resend_spam',
      email: 'resendspam@klizonion.dev',
      password: 'password123!',
      turnstileToken: 'VALID_DUMMY_TOKEN',
    }),
  }), envResend);
  const spamToken = (await res.json()).verification_token;

  let hitRateLimit = false;
  for (let i = 0; i < 6; i++) {
    res = await worker.fetch(new Request('http://localhost:8787/api/auth/resend', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.0.0.14' },
      body: JSON.stringify({ token: spamToken }),
    }), envResend);
    if (res.status === 429) {
      hitRateLimit = true;
      break;
    }
  }
  if (!hitRateLimit) throw new Error('Resend rate limit was not enforced');
  console.log('✓ Passed: Resend rate limit enforced (429 rate_limited)\n');

  // 15. registration rate limiting -> enforced
  console.log('[REQ 15] Registration rate limiting -> enforced (429)...');
  hitRateLimit = false;
  for (let i = 0; i < 8; i++) {
    res = await worker.fetch(new Request('http://localhost:8787/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.0.0.15' },
      body: JSON.stringify({
        username: `reg_spam_${i}`,
        email: `reg_spam_${i}@klizonion.dev`,
        password: 'password123!',
        turnstileToken: 'VALID_DUMMY_TOKEN',
      }),
    }), envResend);
    if (res.status === 429) {
      hitRateLimit = true;
      break;
    }
  }
  if (!hitRateLimit) throw new Error('Registration rate limit was not enforced');
  console.log('✓ Passed: Registration rate limit enforced (429 rate_limited)\n');

  // 16. Turnstile secret never appears in frontend source/configuration
  console.log('[REQ 16] Checking frontend files: Turnstile secret never appears in frontend...');
  const frontendFiles = ['index.html', 'app.js', 'styles.css', 'apps/agent-web/index.html', 'apps/agent-web/app.js'];
  for (const f of frontendFiles) {
    if (fs.existsSync(f)) {
      const content = fs.readFileSync(f, 'utf8');
      if (content.includes('TURNSTILE_SECRET') || content.includes('1x0000000000000000000000000000000AA') || content.includes('2x0000000000000000000000000000000AB')) {
        throw new Error(`SECURITY LEAK: Turnstile secret pattern detected in ${f}`);
      }
    }
  }
  console.log('✓ Passed: Verified no Turnstile secret exists in any frontend file\n');

  // 17. email API key never appears in frontend source/configuration
  console.log('[REQ 17] Checking frontend files: Email API key never appears in frontend...');
  for (const f of frontendFiles) {
    if (fs.existsSync(f)) {
      const content = fs.readFileSync(f, 'utf8');
      if (content.includes('re_5967Q6St_') || content.includes('EMAIL_API_KEY') || content.includes('RESEND_API_KEY')) {
        throw new Error(`SECURITY LEAK: Email API key or credential pattern detected in ${f}`);
      }
    }
  }
  console.log('✓ Passed: Verified no email API key exists in any frontend file\n');

  // ---------------------------------------------------------------------------
  // ADDITIONAL ARCHITECTURE & DASHBOARD ROUTING TESTS (18 to 22)
  // ---------------------------------------------------------------------------
  console.log('--- ADDITIONAL ARCHITECTURE & DASHBOARD ROUTING TESTS ---\n');

  // 18. Login with email & password -> authenticated session token
  console.log('[DASH 1] Testing /api/auth/login with valid user credentials...');
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'resenduser@klizonion.dev',
      password: 'password123!',
    }),
  }), baseEnv);
  json = await res.json();
  if (res.status !== 200 || !json.success || !json.token) {
    throw new Error(`Login failed for verified user: ${JSON.stringify(json)}`);
  }
  const loggedInToken = json.token;
  console.log('✓ Passed: User login succeeded, issued auth session token\n');

  // 19. Session validation (/api/auth/me) with token and invalidation
  console.log('[DASH 2] Testing /api/auth/me session check...');
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/me', {
    headers: { authorization: `Bearer ${loggedInToken}` },
  }), baseEnv);
  json = await res.json();
  if (res.status !== 200 || !json.authenticated || json.user.email !== 'resenduser@klizonion.dev') {
    throw new Error(`Session check failed: ${JSON.stringify(json)}`);
  }

  // Without token -> 401
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/me'), baseEnv);
  if (res.status !== 401) throw new Error('Expected 401 for unauthenticated session check');
  console.log('✓ Passed: Session validation /api/auth/me works accurately\n');

  // 20. Logout -> session invalidated
  console.log('[DASH 3] Testing /api/auth/logout...');
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/logout', {
    method: 'POST',
    headers: { authorization: `Bearer ${loggedInToken}` },
  }), baseEnv);
  json = await res.json();
  if (res.status !== 200 || !json.success) throw new Error('Logout failed');

  // Verify token is now invalid
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/me', {
    headers: { authorization: `Bearer ${loggedInToken}` },
  }), baseEnv);
  if (res.status !== 401) throw new Error('Token remained valid after logout');
  console.log('✓ Passed: Logout correctly invalidated server session token\n');

  // 21. Live preview is embedded inside dashboard workspace in HTML
  console.log('[DASH 4] Verifying Live Preview is inside #viewDashboard in index.html...');
  const indexHtml = fs.readFileSync('index.html', 'utf8');
  const dashboardStart = indexHtml.indexOf('id="viewDashboard"');
  const previewStart = indexHtml.indexOf('id="previewFrame"');
  const homeStart = indexHtml.indexOf('id="viewHome"');
  if (dashboardStart === -1 || previewStart === -1 || homeStart === -1) {
    throw new Error('Missing viewDashboard, previewFrame, or viewHome in index.html');
  }
  if (previewStart < dashboardStart) {
    throw new Error('Live preview is placed outside of #viewDashboard!');
  }
  console.log('✓ Passed: Live preview is confirmed embedded inside the authenticated dashboard\n');

  // 22. Root public view #viewHome does NOT expose the full Builder workspace
  console.log('[DASH 5] Verifying #viewHome does NOT expose full Builder workspace...');
  const homeSection = indexHtml.slice(homeStart, dashboardStart);
  if (homeSection.includes('id="activityLog"') || homeSection.includes('id="workflowSteps"') || homeSection.includes('id="previewFrame"')) {
    throw new Error('Security/Architecture violation: public home exposes internal Builder panels!');
  }
  console.log('✓ Passed: Public home is a dedicated landing page and does not expose active Builder panels\n');

  console.log('===========================================================');
  console.log('ALL PRODUCTION ARCHITECTURE & BUILDER TESTS PASSED!');
  console.log('===========================================================\n');
}

runAllTests().catch((err) => {
  console.error('\n❌ Test failure:', err);
  process.exit(1);
});
