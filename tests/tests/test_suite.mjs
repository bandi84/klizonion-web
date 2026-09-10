import worker from '../apps/worker/src/index.js';
import { SimpleZip } from '../apps/worker/src/zip.js';

async function runAllTests() {
  console.log('=== KLIZONION BUILDER AUTOMATED TEST SUITE ===\n');

  // Test 1: SimpleZip in-memory generation & validation
  console.log('[TEST 1] Testing SimpleZip in-memory package generation...');
  const zip = new SimpleZip();
  zip.addFile('KLIZONION-CustomModel/README.md', '# KLIZONION Custom Model');
  zip.addFile('KLIZONION-CustomModel/model/config.py', 'class ModelConfig:\n    pass\n');
  const zipBytes = zip.generateUint8Array();
  if (!zipBytes || zipBytes.length < 100) throw new Error('Zip generation failed: buffer too small');
  console.log('✓ SimpleZip generated valid buffer of size:', zipBytes.length, 'bytes\n');

  // Test 2: Worker Environment & Health
  console.log('[TEST 2] Testing Worker /api/health endpoint...');
  const env = {
    BUILDER_PROTOCOL_VERSION: '0.2',
    RUNNER_SHARED_SECRET: 'klizonion_test_secret_xyz',
    ENVIRONMENT: 'development',
  };
  let res = await worker.fetch(new Request('http://localhost:8787/api/health'), env);
  let json = await res.json();
  if (!json.ready || json.version !== '0.2') throw new Error('Health check unexpected response');
  console.log('✓ /api/health returned ready=true, version=0.2\n');

  // Test 3: Runner Heartbeat with Authentication
  console.log('[TEST 3] Testing Runner Heartbeat authentication...');
  // Unauthorized without secret
  res = await worker.fetch(new Request('http://localhost:8787/api/runner/heartbeat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hardware: 'Test CPU', workspace: 'C:/workspace' }),
  }), env);
  if (res.status !== 401) throw new Error(`Expected 401 unauthorized, got ${res.status}`);

  // Authorized with secret
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
  }), env);
  json = await res.json();
  if (res.status !== 200 || !json.acknowledged) throw new Error('Runner pairing failed');
  console.log('✓ Runner authenticated and paired. Status: acknowledged\n');

  // Test 4: Builder Status reflection
  console.log('[TEST 4] Testing /api/builder/status...');
  res = await worker.fetch(new Request('http://localhost:8787/api/builder/status'), env);
  json = await res.json();
  if (!json.runner || !json.workspace) throw new Error('Status did not reflect online runner');
  console.log('✓ /api/builder/status reflects online runner and workspace:', json.workspace, '\n');

  // Test 5: Create Mission with Effort Control
  console.log('[TEST 5] Testing mission creation with Effort parameter...');
  res = await worker.fetch(new Request('http://localhost:8787/api/builder/missions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Build a Roblox Studio companion with Luau syntax checker',
      mode: 'roblox',
      effort: 'maximum',
    }),
  }), env);
  json = await res.json();
  if (!json.success || json.mission.effort !== 'maximum') throw new Error('Effort not preserved in mission');
  const missionId = json.mission.id;
  console.log('✓ Mission created:', missionId, 'with Effort:', json.mission.effort, '\n');

  // Test 6: Stop Mission Control
  console.log('[TEST 6] Testing Stop Mission control...');
  res = await worker.fetch(new Request(`http://localhost:8787/api/builder/missions/${missionId}/stop`, {
    method: 'POST',
  }), env);
  json = await res.json();
  if (!json.success || json.mission.status !== 'stopped') throw new Error('Mission stop failed');
  console.log('✓ Mission successfully stopped. Status:', json.mission.status, '\n');

  // Test 7: Save Model State & Configuration
  console.log('[TEST 7] Testing Save Model control...');
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
  }), env);
  json = await res.json();
  if (!json.success || !json.model.id) throw new Error('Model save failed');
  const modelId = json.model.id;
  console.log('✓ Model saved. Model ID:', modelId, 'Loss metadata:', json.model.metadata.loss, '\n');

  // Test 8: Publish Custom Model ZIP (Source & Config explicit distinction)
  console.log('[TEST 8] Testing Publish Custom Model ZIP package generation...');
  res = await worker.fetch(new Request(`http://localhost:8787/api/builder/models/publish?modelId=${modelId}`), env);
  if (res.status !== 200) throw new Error(`Publish returned status ${res.status}`);
  const ct = res.headers.get('content-type');
  const cd = res.headers.get('content-disposition');
  const pkgType = res.headers.get('x-klizonion-package-type');
  const weightsInc = res.headers.get('x-klizonion-weights-included');
  const zipBuffer = await res.arrayBuffer();
  if (ct !== 'application/zip' || !cd.includes('KLIZONION-CustomModel.zip')) {
    throw new Error('Unexpected content-type or disposition headers');
  }
  if (pkgType !== 'source_and_config' || weightsInc !== 'false') {
    throw new Error('Headers did not explicitly declare source_and_config and weightsExcluded');
  }
  if (zipBuffer.byteLength < 1000) throw new Error('Publish ZIP buffer too small');
  console.log('✓ Publish Custom Model ZIP delivered:', zipBuffer.byteLength, 'bytes');
  console.log('  Explicit package distinction verified: packageType=source_and_config, weightsIncluded=false\n');

  // Test 9: Registration Hardening & 16-Digit Numeric Verification Flow
  console.log('[TEST 9] Testing Registration Hardening & 16-Digit Verification Code flow...');
  
  // 9a. Test unconfigured email provider behavior (should return 503 with email_provider_unconfigured)
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'engineer_alex',
      email: 'alex@klizonion.dev',
      password: 'superSecurePassword123!',
    }),
  }), env); // env has no EMAIL binding or EMAIL_API_URL
  json = await res.json();
  if (res.status !== 503 || json.success !== false || json.error !== 'email_provider_unconfigured') {
    throw new Error(`Expected 503 email_provider_unconfigured, got status ${res.status}: ${JSON.stringify(json)}`);
  }
  if (json.code) {
    throw new Error('Security violation: 16-digit verification code exposed in response body!');
  }
  const verificationToken = json.verification_token;
  if (!verificationToken) throw new Error('No pending verification token returned');
  console.log('✓ Correctly reported unconfigured email provider without claiming fake delivery');
  console.log('✓ Verified 16-digit verification code is NOT exposed to client in response payload');

  // 9b. Test configured email provider behavior
  let capturedEmail = null;
  const envWithEmail = {
    ...env,
    EMAIL: {
      send: async (msg) => {
        capturedEmail = msg;
        return { success: true };
      },
    },
  };

  res = await worker.fetch(new Request('http://localhost:8787/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'engineer_bob',
      email: 'bob@klizonion.dev',
      password: 'superSecurePassword123!',
    }),
  }), envWithEmail);
  json = await res.json();
  if (res.status !== 201 || !json.success || !json.emailDelivery.delivered) {
    throw new Error(`Expected 201 with delivered:true, got status ${res.status}`);
  }
  if (!capturedEmail || !capturedEmail.text.match(/\b\d{16}\b/)) {
    throw new Error('Email binding did not receive the 16-digit code');
  }
  const bobToken = json.verification_token;
  const extractedCode = capturedEmail.text.match(/\b\d{16}\b/)[0];
  console.log('✓ Configured email provider successfully delivered 16-digit code to email adapter');

  // Verification code validation (invalid code rejection)
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: bobToken, code: '1234' }), // Invalid length
  }), env);
  if (res.status !== 400) throw new Error('Expected 400 for non-16 digit code');

  res = await worker.fetch(new Request('http://localhost:8787/api/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: bobToken, code: '0000000000000000' }), // Wrong code
  }), env);
  if (res.status !== 400) throw new Error('Expected 400 for incorrect code');
  console.log('✓ Correctly rejected malformed and incorrect verification codes');

  // Test successful verification with real delivered code
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: bobToken, code: extractedCode }),
  }), env);
  json = await res.json();
  if (res.status !== 200 || !json.success || !json.token) {
    throw new Error('Expected successful verification with delivered code');
  }
  console.log('✓ Successfully verified with authentic 16-digit code');

  // Test single-use behavior (re-verification must be rejected)
  res = await worker.fetch(new Request('http://localhost:8787/api/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: bobToken, code: extractedCode }),
  }), env);
  if (res.status !== 400) throw new Error('Single-use violation: code was accepted twice');
  console.log('✓ Single-use enforcement confirmed: code cannot be reused');

  console.log('\n=============================================');
  console.log('ALL KLIZONION BUILDER TESTS PASSED (9/9)');
  console.log('=============================================\n');
}

runAllTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
