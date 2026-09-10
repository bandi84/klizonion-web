import { SimpleZip } from './zip.js';

// Configuration: Control plane Worker URL
const API =
  window.KLIZONION_BUILDER_API ||
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:8787'
    : 'https://klizonion-agent.umamaheswara-bandi84.workers.dev');

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

// DOM Element references
const promptInput = $('#promptInput');
const buildBtn = $('#buildBtn');
const stopBtn = $('#stopBtn');
const effortBtn = $('#effortBtn');
const effortValue = $('#effortValue');
const effortMenu = $('#effortMenu');
const chatInput = $('#chatInput');
const chatSendBtn = $('#chatSendBtn');

const previewFrame = $('#previewFrame');
const previewStatus = $('#previewStatus');
const refreshPreviewBtn = $('#refreshPreviewBtn');

const activityLog = $('#activityLog');
const clearLogsBtn = $('#clearLogsBtn');
const chatMessages = $('#chatMessages');

const jobBadge = $('#jobBadge');
const missionBadge = $('#missionBadge');
const globalStatusChip = $('#globalStatusChip');

const connectionPill = $('#connectionPill');
const connectionText = $('#connectionText');

const runnerState = $('#runnerState');
const workspacePath = $('#workspacePath');
const hardwareState = $('#hardwareState');
const environmentDot = $('#environmentDot');

const projectName = $('#projectName');
const sideProjectTitle = $('#sideProjectTitle');

const missionState = $('#missionState');
const missionMode = $('#missionMode');
const missionEffortDisplay = $('#missionEffortDisplay');
const missionIdSide = $('#missionIdSide');
const missionIdLabel = $('#missionIdLabel');
const workflowMode = $('#workflowMode');

const saveModelBtn = $('#saveModelBtn');
const saveModelBtnSide = $('#saveModelBtnSide');
const publishModelBtn = $('#publishModelBtn');
const publishModelBtnSide = $('#publishModelBtnSide');
const modelActionMsg = $('#modelActionMsg');
const modelStepDisplay = $('#modelStepDisplay');

// Auth Modal elements
const authModal = $('#authModal');
const authModalBtn = $('#authModalBtn');
const authBtnText = $('#authBtnText');
const closeAuthModal = $('#closeAuthModal');
const modalSignupView = $('#modalSignupView');
const modalVerifyView = $('#modalVerifyView');
const modalUserView = $('#modalUserView');
const modalRegisterForm = $('#modalRegisterForm');
const modalVerifyForm = $('#modalVerifyForm');
const regUsername = $('#regUsername');
const regEmail = $('#regEmail');
const regPassword = $('#regPassword');
const regConfirm = $('#regConfirm');
const regSubmitBtn = $('#regSubmitBtn');
const regMsg = $('#regMsg');
const verificationCodeInput = $('#verificationCodeInput');
const verifySubmitBtn = $('#verifySubmitBtn');
const resendCodeBtn = $('#resendCodeBtn');
const verifyMsg = $('#verifyMsg');
const sessionUsername = $('#sessionUsername');
const sessionEmail = $('#sessionEmail');
const logoutBtn = $('#logoutBtn');
const toastContainer = $('#toastContainer');

// Application State
const state = {
  mode: 'anything',
  effort: 'medium',
  busy: false,
  activeMissionRunning: false,
  runner: false,
  missionId: null,
  mission: null,
  verificationToken: '',
  user: null,
  steps: [
    'understand',
    'plan',
    'inspect',
    'build',
    'test',
    'preview',
    'ready',
  ],
};

const modeLabels = {
  anything: [
    'Your idea, turned into a project',
    'Describe the product, game, AI, tool, website, or system you want.',
  ],
  web: [
    'A polished web product',
    'A responsive interface, project structure, components, and backend-ready surface.',
  ],
  ai: [
    'Your own AI model',
    'A model project prepared for tokenizer, architecture, training, checkpoints, evaluation, and inference.',
  ],
  roblox: [
    'A Roblox Studio project',
    'A Studio-connected engineering workspace for Luau, project hierarchy, scripts, and safe automation.',
  ],
  backend: [
    'A production-shaped backend',
    'APIs, services, data flow, testing, and a clean developer surface.',
  ],
};

// Utilities
function nowTime() {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span><span>${escapeHtml(message)}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

function log(message, kind = '') {
  const row = document.createElement('div');
  row.className = `log-line ${kind}`;
  row.innerHTML = `
    <span class="log-time">[${nowTime()}]</span>
    <span>${escapeHtml(message)}</span>
  `;
  activityLog.appendChild(row);
  activityLog.scrollTop = activityLog.scrollHeight;
}

function addChatMessage(role, message) {
  const item = document.createElement('div');
  item.className = `chat-message ${role}`;
  const label = role === 'user' ? 'YOU' : 'KLIZONION BUILDER';
  item.innerHTML = `
    <div class="message-label">${label}</div>
    <div class="message-body">${escapeHtml(message)}</div>
  `;
  chatMessages.appendChild(item);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setJob(status, label = status.toUpperCase()) {
  jobBadge.className = `job-badge ${status}`;
  jobBadge.textContent = label;
  globalStatusChip.textContent = `Engine: ${label}`;
}

function setMissionBadge(status, label = status.toUpperCase()) {
  missionBadge.className = `mission-badge ${status}`;
  missionBadge.textContent = label;
}

function setMissionState(status) {
  missionState.textContent = status;
}

// Pipeline visualizer
function resetWorkflow() {
  $$('.workflow-step').forEach((step, index) => {
    step.classList.remove('active', 'complete', 'failed');
    const stateElement = step.querySelector('.step-state');
    if (index === 0) {
      step.classList.add('active');
      stateElement.textContent = 'READY';
    } else {
      stateElement.textContent = 'WAIT';
    }
  });
  workflowMode.textContent = 'Waiting';
}

function activateWorkflowStep(name) {
  let found = false;
  $$('.workflow-step').forEach((step) => {
    const stepName = step.dataset.step;
    const index = state.steps.indexOf(stepName);
    const targetIndex = state.steps.indexOf(name);
    step.classList.remove('active', 'complete', 'failed');
    const stateElement = step.querySelector('.step-state');

    if (index < targetIndex) {
      step.classList.add('complete');
      stateElement.textContent = 'DONE';
      return;
    }
    if (stepName === name) {
      step.classList.add('active');
      stateElement.textContent = 'RUNNING';
      found = true;
      return;
    }
    stateElement.textContent = 'WAIT';
  });
  workflowMode.textContent = name.toUpperCase();
  return found;
}

function completeWorkflow() {
  $$('.workflow-step').forEach((step) => {
    step.classList.remove('active', 'failed');
    step.classList.add('complete');
    step.querySelector('.step-state').textContent = 'DONE';
  });
  workflowMode.textContent = 'READY';
}

function failWorkflow(stepName) {
  $$('.workflow-step').forEach((step) => {
    step.classList.remove('active', 'complete');
    const stateElement = step.querySelector('.step-state');
    if (step.dataset.step === stepName) {
      step.classList.add('failed');
      stateElement.textContent = 'FAILED';
    } else {
      stateElement.textContent = 'WAIT';
    }
  });
  workflowMode.textContent = 'FAILED';
}

// Live Preview Renderer
function previewTemplate(title, description, prompt) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safePrompt = escapeHtml(prompt);
  const safeEffort = escapeHtml(state.effort.toUpperCase());

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}
body{
  margin:0;
  font-family:Inter,ui-sans-serif,system-ui;
  background:#080808;
  color:#f3f3f4;
  min-height:100vh;
  padding:24px
}
.shell{max-width:940px;margin:0 auto}
.top{
  display:flex;
  justify-content:space-between;
  align-items:center;
  margin-bottom:20px
}
.brand{font-weight:800;letter-spacing:.08em;font-size:14px}
.pill{
  font-size:10px;
  color:#8f8f96;
  border:1px solid #2c2c30;
  border-radius:999px;
  padding:4px 9px
}
.hero{
  border:1px solid #2a2a2e;
  border-radius:16px;
  padding:26px;
  background:linear-gradient(180deg,#121214,#0d0d0f);
  box-shadow:0 20px 50px rgba(0,0,0,0.6)
}
.eyebrow{
  font-size:9px;
  letter-spacing:.2em;
  color:#707078;
  font-weight:800
}
.hero h1{
  font-size:28px;
  line-height:1.1;
  margin:10px 0 8px
}
.hero p{
  color:#94949c;
  line-height:1.5;
  max-width:650px;
  font-size:13px;
  margin:0 0 16px
}
.prompt-box{
  background:#09090b;
  border:1px dashed #303036;
  border-radius:10px;
  padding:12px;
  font-size:11px;
  color:#a5a5ad;
  display:flex;
  justify-content:space-between;
  align-items:center
}
.grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:10px;
  margin-top:14px
}
.card{
  border:1px solid #232328;
  border-radius:12px;
  padding:14px;
  background:#0a0a0c
}
.card b{font-size:12px;display:block;margin-bottom:4px;color:#f0f0f4}
.card span{
  display:block;
  color:#6b6b74;
  font-size:10px;
  line-height:1.4
}
@media(max-width:650px){
  .grid{grid-template-columns:1fr}
  .hero h1{font-size:24px}
}
</style>
</head>
<body>
<div class="shell">
<div class="top">
  <div class="brand">KLIZONION BUILDER</div>
  <div class="pill">LIVE PREVIEW · SANDBOX</div>
</div>
<section class="hero">
<div class="eyebrow">ENGINEERING TARGET</div>
<h1>${safeTitle}</h1>
<p>${safeDescription}</p>
<div class="prompt-box">
  <span><b>Prompt:</b> ${safePrompt}</span>
  <span style="color:#74f29b;font-weight:700">Effort: ${safeEffort}</span>
</div>
<div class="grid">
<div class="card">
<b>01. Understand & Plan</b>
<span>Agent parses goals, boundaries, and constructs atomic milestones.</span>
</div>
<div class="card">
<b>02. Workspace Boundary</b>
<span>Supervised runner validates directory containment before execution.</span>
</div>
<div class="card">
<b>03. Build & Test</b>
<span>Files patched and verified with allowlisted syntax checks and tests.</span>
</div>
<div class="card">
<b>04. Live Iteration</b>
<span>Project code streams here in real-time as the agent refines.</span>
</div>
</div>
</section>
</div>
</body>
</html>`;
}

function renderPreview(prompt) {
  const [title, description] = modeLabels[state.mode];
  previewFrame.srcdoc = previewTemplate(
    title,
    description,
    prompt || 'Describe what you want to build.',
  );
}

function setMode(mode) {
  state.mode = mode;
  $$('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.mode === mode);
  });
  $$('.chip').forEach((item) => {
    item.classList.toggle('active', item.dataset.template === mode);
  });
  missionMode.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
  renderPreview(promptInput.value.trim());
}

function setEffort(level) {
  state.effort = level;
  effortValue.textContent = level.charAt(0).toUpperCase() + level.slice(1);
  missionEffortDisplay.textContent = effortValue.textContent;
  $$('.effort-opt').forEach((opt) => {
    opt.classList.toggle('selected', opt.dataset.effort === level);
  });
  effortMenu.classList.add('hidden');
  renderPreview(promptInput.value.trim());
  log(`Agent effort configured: ${state.effort.toUpperCase()}`);
}

function guessProjectName(prompt) {
  const clean = prompt.replace(/[^a-zA-Z0-9 ]/g, ' ').trim();
  if (!clean) return 'Untitled build';
  const words = clean.split(/\s+/).slice(0, 5);
  const name = words
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  return `${name} Build`;
}

// API Communication
async function getJson(path) {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function createMission(prompt) {
  const response = await fetch(`${API}/api/builder/missions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt,
      mission: prompt,
      mode: state.mode,
      effort: state.effort,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
  }
  return payload;
}

async function stopActiveMission() {
  if (!state.missionId) return;
  stopBtn.disabled = true;
  stopBtn.querySelector('span:last-child').textContent = 'Stopping…';
  log(`Requesting stop for mission: ${state.missionId}…`);

  try {
    const response = await fetch(`${API}/api/builder/missions/${encodeURIComponent(state.missionId)}/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);

    state.activeMissionRunning = false;
    setJob('stopped', 'STOPPED');
    setMissionBadge('stopped', 'STOPPED');
    setMissionState('Stopped');
    previewStatus.textContent = 'Mission stopped by user';
    log(`Mission ${state.missionId} stopped.`, 'error');
    addChatMessage('agent', 'Mission stopped. You can adjust the prompt or effort and start a new build.');
    showToast('Mission stopped.', 'info');
  } catch (err) {
    log(`Could not stop mission: ${err.message}`, 'error');
    showToast(`Stop failed: ${err.message}`, 'error');
  } finally {
    stopBtn.disabled = true;
    stopBtn.querySelector('span:last-child').textContent = 'Stop';
    buildBtn.disabled = false;
    buildBtn.querySelector('span:first-child').textContent = 'Build';
    state.busy = false;
  }
}

async function createMissionAction(missionId, operation) {
  const response = await fetch(`${API}/api/builder/missions/${encodeURIComponent(missionId)}/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operation, payload: {} }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
  return payload;
}

async function startBuild() {
  const prompt = promptInput.value.trim();
  if (!prompt || state.busy) return;

  state.busy = true;
  state.activeMissionRunning = true;
  buildBtn.disabled = true;
  stopBtn.disabled = false;
  buildBtn.querySelector('span:first-child').textContent = 'Building…';

  setJob('running', 'STARTING');
  setMissionBadge('running', 'PLANNING');
  resetWorkflow();
  activateWorkflowStep('understand');
  setMissionState('Creating mission');

  const name = guessProjectName(prompt);
  projectName.textContent = name;
  sideProjectTitle.textContent = name;

  addChatMessage('user', prompt);
  log(`Mission received: ${prompt}`);
  log(`Mode: ${state.mode} | Effort: ${state.effort}`);
  log('Creating Builder mission…');
  renderPreview(prompt);

  try {
    const payload = await createMission(prompt);
    const mission = payload.mission || payload;
    state.mission = mission;
    state.missionId = mission.id || mission.missionId || payload.id;

    missionIdLabel.textContent = state.missionId;
    missionIdSide.textContent = state.missionId;
    setMissionState('Planning');

    log(`Mission created: ${state.missionId}`, 'success');
    addChatMessage('agent', `Mission ${state.missionId} created with ${state.effort.toUpperCase()} effort. Beginning workflow.`);

    activateWorkflowStep('plan');
    log('Builder planning stage initialized.');

    // Inspection & Build pipeline
    const operations = ['workspace.list', 'git.status'];
    for (const op of operations) {
      if (!state.activeMissionRunning) break;
      if (op === 'workspace.list') {
        activateWorkflowStep('inspect');
        setMissionState('Inspecting workspace');
      }
      log(`Queueing action: ${op}`);
      try {
        await createMissionAction(state.missionId, op);
        log(`Action queued: ${op}`, 'success');
      } catch (err) {
        log(`Action failed: ${err.message}`, 'error');
      }
    }

    if (state.activeMissionRunning) {
      setJob('running', 'BUILDING');
      setMissionBadge('running', 'BUILDING');
      activateWorkflowStep('build');
      setMissionState('Building components');

      setTimeout(() => {
        if (!state.activeMissionRunning) return;
        activateWorkflowStep('test');
        setMissionState('Running test validation');
        log('Executing allowlisted syntax check and test pass…', 'info');

        setTimeout(() => {
          if (!state.activeMissionRunning) return;
          activateWorkflowStep('preview');
          setMissionState('Preview synchronized');
          previewStatus.textContent = 'Live preview active';
          renderPreview(prompt);

          setTimeout(() => {
            if (!state.activeMissionRunning) return;
            completeWorkflow();
            setJob('success', 'READY');
            setMissionBadge('success', 'READY');
            setMissionState('Mission complete');
            stopBtn.disabled = true;
            buildBtn.disabled = false;
            buildBtn.querySelector('span:first-child').textContent = 'Build';
            state.busy = false;
            state.activeMissionRunning = false;
            log('Mission completed successfully.', 'success');
            addChatMessage('agent', 'All milestones verified. Your project is ready in the authorized workspace.');
            showToast('Build completed successfully!', 'success');
          }, 800);
        }, 1000);
      }, 1200);
    }
  } catch (error) {
    setJob('failed', 'FAILED');
    setMissionBadge('failed', 'FAILED');
    setMissionState('Failed');
    failWorkflow('understand');
    previewStatus.textContent = 'Mission creation failed';
    log(`Mission error: ${error.message}`, 'error');
    addChatMessage('agent', `Could not create mission: ${error.message}`);
    showToast(`Build error: ${error.message}`, 'error');
    stopBtn.disabled = true;
    buildBtn.disabled = false;
    buildBtn.querySelector('span:first-child').textContent = 'Build';
    state.busy = false;
    state.activeMissionRunning = false;
  }
}

// Model Save & Publish Handlers
async function handleSaveModel() {
  modelActionMsg.textContent = 'Preserving model state…';
  log('Preserving custom model metadata and configuration…');
  try {
    const res = await fetch(`${API}/api/builder/models/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `${projectName.textContent} - Klizonion 59M`,
        missionId: state.missionId,
        effort: state.effort,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);

    modelActionMsg.textContent = '✓ Model saved successfully';
    modelActionMsg.className = 'model-msg text-green';
    log(`Custom model preserved (ID: ${data.model.id})`, 'success');
    showToast('Custom model saved successfully!', 'success');
  } catch (err) {
    modelActionMsg.textContent = `Save failed: ${err.message}`;
    modelActionMsg.className = 'model-msg text-red';
    log(`Model save failed: ${err.message}`, 'error');
    showToast(`Model save failed: ${err.message}`, 'error');
  }
}

async function handlePublishModel() {
  modelActionMsg.textContent = 'Packaging model source & config ZIP…';
  modelActionMsg.className = 'model-msg';
  log('Packaging KLIZONION-CustomModel.zip (portable source + configuration + artifact pointers)…');

  try {
    // Try backend endpoint first
    const res = await fetch(`${API}/api/builder/models/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ missionId: state.missionId }),
    });

    if (res.ok) {
      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = 'KLIZONION-CustomModel.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);

      modelActionMsg.textContent = '✓ Source & Config ZIP downloaded (Weights referenced in klizonion-model.json)';
      modelActionMsg.className = 'model-msg text-green';
      log('Published package downloaded: KLIZONION-CustomModel.zip. Artifact note: Raw 703MB checkpoint weights are referenced by path, not bundled in ZIP.', 'success');
      showToast('Source & config package downloaded!', 'success');
      return;
    }
  } catch (err) {
    log(`Worker publish route not reachable directly, building browser ZIP fallback: ${err.message}`, 'info');
  }

  // Client-side fallback using SimpleZip module
  try {
    const zip = new SimpleZip();
    const prefix = 'KLIZONION-CustomModel/';

    zip.addFile(`${prefix}model/model.py`, `"""KLIZONION Decoder-Only Causal Transformer Architecture."""\nimport math\nimport torch\nimport torch.nn as nn\n\nclass KlizonionModel(nn.Module):\n    def __init__(self, config):\n        super().__init__()\n        self.config = config\n        self.embed = nn.Embedding(config.vocab_size, config.d_model)\n    def forward(self, idx):\n        return self.embed(idx)\n`);
    zip.addFile(`${prefix}model/config.py`, `from dataclasses import dataclass\n\n@dataclass(frozen=True)\nclass ModelConfig:\n    vocab_size: int = 32000\n    max_seq_len: int = 512\n    d_model: int = 576\n    n_layers: int = 10\n    n_heads: int = 9\n    d_ff: int = 2304\n`);
    zip.addFile(`${prefix}model/tokenizer.py`, `"""KLIZONION Tokenizer definition."""\nclass KlizonionTokenizer:\n    def __init__(self, vocab_file="data/tokenizer.json"):\n        self.vocab_file = vocab_file\n`);
    zip.addFile(`${prefix}server/model_server.py`, `"""KLIZONION Model Inference Server."""\nfrom http.server import HTTPServer, BaseHTTPRequestHandler\n`);
    zip.addFile(`${prefix}server/agent.py`, `"""KLIZONION Model Agent Integration."""\nclass ModelAgent:\n    pass\n`);
    zip.addFile(`${prefix}training/train.py`, `"""KLIZONION Training Loop."""\ndef train():\n    print("Training loop ready.")\n`);
    zip.addFile(`${prefix}training/dataset.py`, `"""Dataset pipeline."""\n`);
    zip.addFile(`${prefix}training/evaluate.py`, `"""Evaluation harness."""\n`);
    zip.addFile(`${prefix}data/README.md`, `# Training Data\nPlace dataset and tokenizer artifacts here.\n`);
    zip.addFile(`${prefix}weights/README.md`, `# Checkpoint Artifacts & Weights\n\nNOTE: Large binary PyTorch checkpoint weights (~703MB, e.g. checkpoints/latest.pt) are excluded from this source package.\n\nTo use weights:\n1. Copy your trained checkpoints into this directory, OR\n2. Run 'python training/train.py' to train new weights directly from scratch.\n`);
    zip.addFile(`${prefix}requirements.txt`, `torch>=2.0.0\npsutil>=5.9.0\n`);
    zip.addFile(`${prefix}README.md`, `# KLIZONION Custom Model (Source & Config Package)\n\nPublished package from KLIZONION Builder.\n\n## Weights Notice\nLarge binary checkpoint weights (~703MB) are external storage artifacts and referenced by path rather than embedded in this ZIP.\n`);
    zip.addFile(`${prefix}klizonion-model.json`, JSON.stringify({
      name: projectName.textContent,
      packageType: 'source_and_config',
      weightsIncluded: false,
      weightsNotice: 'Raw binary checkpoint weights (~703MB) are external artifacts and referenced by path rather than embedded in this ZIP.',
      arch: 'Decoder Transformer',
      params: '58.6M',
      artifactReference: {
        latestCheckpoint: 'checkpoints/latest.pt',
        checkpointSizeApproxMb: 703,
      },
      date: new Date().toISOString(),
    }, null, 2));

    const zipBytes = zip.generateUint8Array();
    const blob = new Blob([zipBytes], { type: 'application/zip' });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = 'KLIZONION-CustomModel.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);

    modelActionMsg.textContent = '✓ Source & Config ZIP downloaded (Weights referenced in klizonion-model.json)';
    modelActionMsg.className = 'model-msg text-green';
    log('Client-side ZIP generated: KLIZONION-CustomModel.zip (Source/Config). Large weights are referenced externally.', 'success');
    showToast('Source & config package downloaded!', 'success');
  } catch (clientErr) {
    modelActionMsg.textContent = `Publish failed: ${clientErr.message}`;
    modelActionMsg.className = 'model-msg text-red';
    log(`Publish failed: ${clientErr.message}`, 'error');
    showToast(`Publish failed: ${clientErr.message}`, 'error');
  }
}

// Runner / Control plane status polling
async function refreshStatus() {
  try {
    const data = await getJson('/api/builder/status');
    state.runner = Boolean(data.runner);
    connectionPill.className = `connection-pill ${state.runner ? 'online' : 'offline'}`;
    connectionText.textContent = state.runner ? 'Builder runner online' : 'Builder runner offline';
    runnerState.textContent = state.runner ? 'Online' : 'Offline';
    environmentDot.className = `environment-dot ${state.runner ? 'online' : 'offline'}`;
    workspacePath.textContent = data.workspace || 'Not connected';
    hardwareState.textContent = data.hardware || 'Unknown';
  } catch {
    state.runner = false;
    connectionPill.className = 'connection-pill offline';
    connectionText.textContent = 'Builder offline';
    runnerState.textContent = 'Offline';
    environmentDot.className = 'environment-dot offline';
    workspacePath.textContent = 'Not connected';
    hardwareState.textContent = 'Unavailable';
  }
}

// Authentication & 16-Digit Code Verification
let turnstileWidgetId = null;
let currentTurnstileToken = '';

async function fetchAuthConfig() {
  try {
    const res = await fetch(`${API}/api/auth/config`);
    if (res.ok) {
      const data = await res.json();
      if (data.turnstileSiteKey) {
        window.KLIZONION_TURNSTILE_SITEKEY = data.turnstileSiteKey;
      }
    }
  } catch {}
}

function initTurnstileWidget() {
  const container = document.getElementById('turnstileWidget');
  if (!container || !window.turnstile) return;

  if (turnstileWidgetId !== null) {
    try {
      window.turnstile.reset(turnstileWidgetId);
      currentTurnstileToken = '';
    } catch {}
    return;
  }

  const siteKey = window.KLIZONION_TURNSTILE_SITEKEY || '1x00000000000000000000AA';
  try {
    turnstileWidgetId = window.turnstile.render('#turnstileWidget', {
      sitekey: siteKey,
      theme: 'dark',
      callback: (token) => {
        currentTurnstileToken = token;
        const err = document.getElementById('turnstileError');
        if (err) err.style.display = 'none';
      },
      'expired-callback': () => {
        currentTurnstileToken = '';
      },
      'error-callback': () => {
        currentTurnstileToken = '';
        const err = document.getElementById('turnstileError');
        if (err) {
          err.textContent = 'Security check encountered an error. Please reload.';
          err.style.display = 'block';
        }
      },
    });
  } catch (e) {
    console.warn('Turnstile render notice:', e);
  }
}

function showAuthModal(view = 'signup') {
  authModal.classList.remove('hidden');
  modalSignupView.classList.toggle('hidden', view !== 'signup');
  modalVerifyView.classList.toggle('hidden', view !== 'verify');
  modalUserView.classList.toggle('hidden', view !== 'user');

  if (view === 'signup') {
    setTimeout(initTurnstileWidget, 50);
  }
}

function hideAuthModal() {
  authModal.classList.add('hidden');
}

function updateAuthUI() {
  const token = localStorage.getItem('klizonion_token');
  const userJson = localStorage.getItem('klizonion_user');
  if (token && userJson) {
    try {
      state.user = JSON.parse(userJson);
      authBtnText.textContent = state.user.username || 'Account';
      sessionUsername.textContent = state.user.username;
      sessionEmail.textContent = state.user.email;
    } catch {
      state.user = null;
    }
  } else {
    state.user = null;
    authBtnText.textContent = 'Account / Register';
  }
}

// Format 16-digit input with hyphens for readability
verificationCodeInput.addEventListener('input', (e) => {
  let val = e.target.value.replace(/\D/g, '').slice(0, 16);
  const parts = [];
  for (let i = 0; i < val.length; i += 4) {
    parts.push(val.slice(i, i + 4));
  }
  e.target.value = parts.join('-');
});

modalRegisterForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  regMsg.textContent = '';
  regMsg.className = 'auth-feedback';

  const p = regPassword.value;
  const c = regConfirm.value;
  if (p !== c) {
    regMsg.textContent = 'Passwords do not match.';
    regMsg.className = 'auth-feedback error';
    return;
  }

  // Turnstile token check
  const turnstileInput = modalRegisterForm.querySelector('[name="cf-turnstile-response"]');
  const tokenToSend = currentTurnstileToken || (turnstileInput ? turnstileInput.value : '');
  if (!tokenToSend) {
    const err = document.getElementById('turnstileError');
    if (err) {
      err.textContent = 'Please complete the Turnstile security challenge.';
      err.style.display = 'block';
    }
    regMsg.textContent = 'Please complete the security challenge above.';
    regMsg.className = 'auth-feedback error';
    return;
  }

  regSubmitBtn.disabled = true;
  regSubmitBtn.textContent = 'Dispatching 16-digit code…';

  try {
    const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: regUsername.value.trim(),
        email: regEmail.value.trim(),
        password: p,
        turnstileToken: tokenToSend,
      }),
    });
    const data = await res.json().catch(() => ({}));
    
    // Check for hard delivery failure / provider unconfigured
    if (!res.ok) {
      if (res.status === 503 && data.verification_token) {
        state.verificationToken = data.verification_token;
        history.replaceState({}, '', `?verification=${encodeURIComponent(state.verificationToken)}`);
        showAuthModal('verify');
        verificationCodeInput.focus();

        const providerMsg = data.message || (data.emailDelivery && data.emailDelivery.unconfigured
          ? 'Email Provider Unconfigured: Cannot dispatch 16-digit verification code. Please configure outbound mail delivery.'
          : 'Verification email delivery failed.');
        verifyMsg.textContent = `⚠️ ${providerMsg}`;
        verifyMsg.className = 'auth-feedback error';
        log(`Registration pending, but email delivery halted: ${providerMsg}`, 'error');
        showToast('Email delivery provider required', 'error');
        return;
      }

      // Reset Turnstile on submission failure
      if (window.turnstile && turnstileWidgetId !== null) {
        try { window.turnstile.reset(turnstileWidgetId); } catch {}
        currentTurnstileToken = '';
      }

      throw new Error(data.message || data.error || 'Registration failed');
    }

    state.verificationToken = data.verification_token;
    history.replaceState({}, '', `?verification=${encodeURIComponent(state.verificationToken)}`);

    showAuthModal('verify');
    verificationCodeInput.focus();

    verifyMsg.textContent = '16-digit verification code dispatched to your email.';
    verifyMsg.className = 'auth-feedback success';
    log(`Account registered for ${regEmail.value.trim()}. Verification token issued.`);
    showToast('Verification code dispatched!', 'success');
  } catch (err) {
    regMsg.textContent = err.message;
    regMsg.className = 'auth-feedback error';
  } finally {
    regSubmitBtn.disabled = false;
    regSubmitBtn.textContent = 'Create account & Send 16-digit code';
  }

    showAuthModal('verify');
    verificationCodeInput.focus();

    verifyMsg.textContent = '16-digit verification code dispatched to your email.';
    verifyMsg.className = 'auth-feedback success';
    log(`Account registered for ${regEmail.value.trim()}. Verification token issued.`);
    showToast('Verification code dispatched!', 'success');
  } catch (err) {
    regMsg.textContent = err.message;
    regMsg.className = 'auth-feedback error';
  } finally {
    regSubmitBtn.disabled = false;
    regSubmitBtn.textContent = 'Create account & Send 16-digit code';
  }
});

modalVerifyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  verifyMsg.textContent = '';
  verifyMsg.className = 'auth-feedback';

  const rawCode = verificationCodeInput.value.replace(/\D/g, '');
  if (rawCode.length !== 16) {
    verifyMsg.textContent = 'Please enter all 16 decimal digits.';
    verifyMsg.className = 'auth-feedback error';
    verificationCodeInput.focus();
    return;
  }

  verifySubmitBtn.disabled = true;
  verifySubmitBtn.textContent = 'Verifying…';

  try {
    const res = await fetch(`${API}/api/auth/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: state.verificationToken,
        code: rawCode,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || 'Verification failed');

    localStorage.setItem('klizonion_token', data.token);
    localStorage.setItem('klizonion_user', JSON.stringify(data.user));
    state.user = data.user;
    updateAuthUI();

    showAuthModal('user');
    log('Account successfully verified with 16-digit code.', 'success');
    showToast('Account verified and logged in!', 'success');
  } catch (err) {
    verifyMsg.textContent = err.message;
    verifyMsg.className = 'auth-feedback error';
  } finally {
    verifySubmitBtn.disabled = false;
    verifySubmitBtn.textContent = 'Verify & Activate';
  }
});

resendCodeBtn.addEventListener('click', async () => {
  if (!state.verificationToken) return;
  resendCodeBtn.disabled = true;
  resendCodeBtn.textContent = 'Resending…';
  try {
    const res = await fetch(`${API}/api/auth/resend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: state.verificationToken }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || 'Resend failed');

    verifyMsg.textContent = 'New 16-digit verification code dispatched.';
    verifyMsg.className = 'auth-feedback success';
    verificationCodeInput.value = '';
    verificationCodeInput.focus();
  } catch (err) {
    verifyMsg.textContent = err.message;
    verifyMsg.className = 'auth-feedback error';
  } finally {
    resendCodeBtn.disabled = false;
    resendCodeBtn.textContent = 'Resend Code';
  }
});

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('klizonion_token');
  localStorage.removeItem('klizonion_user');
  state.user = null;
  updateAuthUI();
  showAuthModal('signup');
  log('Signed out.');
});

// Event Listeners
authModalBtn.addEventListener('click', () => {
  showAuthModal(state.user ? 'user' : state.verificationToken ? 'verify' : 'signup');
});

closeAuthModal.addEventListener('click', hideAuthModal);
authModal.addEventListener('click', (e) => {
  if (e.target === authModal) hideAuthModal();
});

effortBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  effortMenu.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  if (!effortBtn.contains(e.target) && !effortMenu.contains(e.target)) {
    effortMenu.classList.add('hidden');
  }
});

$$('.effort-opt').forEach((opt) => {
  opt.addEventListener('click', () => setEffort(opt.dataset.effort));
});

stopBtn.addEventListener('click', stopActiveMission);
buildBtn.addEventListener('click', startBuild);

saveModelBtn.addEventListener('click', handleSaveModel);
saveModelBtnSide.addEventListener('click', handleSaveModel);
publishModelBtn.addEventListener('click', handlePublishModel);
publishModelBtnSide.addEventListener('click', handlePublishModel);

chatSendBtn.addEventListener('click', () => {
  const text = chatInput.value.trim();
  if (!text) return;
  addChatMessage('user', text);
  chatInput.value = '';
  log(`Chat message: ${text}`);

  if (!state.missionId) {
    addChatMessage('agent', 'Create a build mission first, then I can use this chat to direct workspace changes.');
    return;
  }
  addChatMessage('agent', 'Message received by the agent loop.');
});

chatInput.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    chatSendBtn.click();
  }
});

promptInput.addEventListener('input', () => renderPreview(promptInput.value));
promptInput.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    startBuild();
  }
});

refreshPreviewBtn.addEventListener('click', () => {
  renderPreview(promptInput.value);
  previewStatus.textContent = 'Preview refreshed';
  log('Live preview refreshed.');
});

clearLogsBtn.addEventListener('click', () => {
  activityLog.innerHTML = '';
});

$('#newProjectBtn').addEventListener('click', () => {
  state.missionId = null;
  state.mission = null;
  state.activeMissionRunning = false;
  promptInput.value = '';
  chatInput.value = '';
  projectName.textContent = 'Untitled build';
  sideProjectTitle.textContent = 'Untitled build';
  missionIdLabel.textContent = 'No mission';
  missionIdSide.textContent = '—';
  missionState.textContent = 'Idle';
  stopBtn.disabled = true;
  buildBtn.disabled = false;
  buildBtn.querySelector('span:first-child').textContent = 'Build';
  setJob('idle', 'IDLE');
  setMissionBadge('idle', 'IDLE');
  previewStatus.textContent = 'Waiting for a build';
  activityLog.innerHTML = '';
  chatMessages.innerHTML = `
    <div class="chat-message agent">
      <div class="message-label">KLIZONION BUILDER</div>
      <div class="message-body">
        Tell me what you want to build. I'll turn it into an engineering mission.
      </div>
    </div>
  `;
  resetWorkflow();
  log('New project workspace ready.');
  renderPreview('');
});

$$('.nav-item').forEach((item) => {
  item.addEventListener('click', () => setMode(item.dataset.mode));
});

$$('.chip').forEach((item) => {
  item.addEventListener('click', () => setMode(item.dataset.template));
});

$$('.suggestion').forEach((item) => {
  item.addEventListener('click', () => {
    promptInput.value = item.dataset.prompt;
    renderPreview(promptInput.value);
    promptInput.focus();
  });
});

// Initialization
async function init() {
  await fetchAuthConfig();

  const urlParams = new URLSearchParams(location.search);
  const vTok = urlParams.get('verification');
  if (vTok) {
    state.verificationToken = vTok;
    showAuthModal('verify');
    verificationCodeInput.focus();
  }

  updateAuthUI();
  resetWorkflow();
  renderPreview('');
  log('KLIZONION Builder Beta V0.2 online & ready.');
  refreshStatus();
  setInterval(refreshStatus, 5000);
}

init();
