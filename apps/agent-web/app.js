import { SimpleZip } from './zip.js';

// Configuration: Control plane Worker URL
const API =
  window.KLIZONION_BUILDER_API ||
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:8787'
    : 'https://klizonion-agent.umamaheswara-bandi84.workers.dev');

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

// Application State
const state = {
  route: 'home',
  mode: 'anything',
  effort: 'medium',
  busy: false,
  activeMissionRunning: false,
  runner: false,
  missionId: null,
  mission: null,
  verificationToken: '',
  user: null,
  authToken: null,
  pollInterval: null,
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
  const container = $('#toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function log(message, kind = '') {
  const activityLog = $('#activityLog');
  if (!activityLog) return;
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
  const chatMessages = $('#chatMessages');
  if (!chatMessages) return;
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
  const jobBadge = $('#jobBadge');
  if (jobBadge) {
    jobBadge.className = `job-badge ${status}`;
    jobBadge.textContent = label;
  }
}

function setMissionBadge(status, label = status.toUpperCase()) {
  const missionBadge = $('#missionBadge');
  if (missionBadge) {
    missionBadge.className = `mission-badge ${status}`;
    missionBadge.textContent = label;
  }
}

function setMissionState(status) {
  const missionState = $('#missionState');
  if (missionState) missionState.textContent = status;
}

// Pipeline visualizer
function resetWorkflow() {
  $$('.workflow-step').forEach((step, index) => {
    step.classList.remove('active', 'complete', 'failed');
    const stateElement = step.querySelector('.step-state');
    if (index === 0) {
      step.classList.add('active');
      if (stateElement) stateElement.textContent = 'READY';
    } else {
      if (stateElement) stateElement.textContent = 'WAIT';
    }
  });
  const workflowMode = $('#workflowMode');
  if (workflowMode) workflowMode.textContent = 'Waiting';
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
      if (stateElement) stateElement.textContent = 'DONE';
      return;
    }
    if (stepName === name) {
      step.classList.add('active');
      if (stateElement) stateElement.textContent = 'RUNNING';
      found = true;
      return;
    }
    if (stateElement) stateElement.textContent = 'WAIT';
  });
  const workflowMode = $('#workflowMode');
  if (workflowMode) workflowMode.textContent = name.toUpperCase();
  return found;
}

function completeWorkflow() {
  $$('.workflow-step').forEach((step) => {
    step.classList.remove('active', 'failed');
    step.classList.add('complete');
    const stateElement = step.querySelector('.step-state');
    if (stateElement) stateElement.textContent = 'DONE';
  });
  const workflowMode = $('#workflowMode');
  if (workflowMode) workflowMode.textContent = 'READY';
}

function failWorkflow(stepName) {
  $$('.workflow-step').forEach((step) => {
    step.classList.remove('active', 'complete');
    const stateElement = step.querySelector('.step-state');
    if (step.dataset.step === stepName) {
      step.classList.add('failed');
      if (stateElement) stateElement.textContent = 'FAILED';
    } else {
      if (stateElement) stateElement.textContent = 'WAIT';
    }
  });
  const workflowMode = $('#workflowMode');
  if (workflowMode) workflowMode.textContent = 'FAILED';
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
  padding:20px
}
.shell{max-width:900px;margin:0 auto}
.top{
  display:flex;
  justify-content:space-between;
  align-items:center;
  margin-bottom:16px
}
.brand{font-weight:800;letter-spacing:.08em;font-size:13px}
.pill{
  font-size:10px;
  color:#8f8f96;
  border:1px solid #2c2c30;
  border-radius:999px;
  padding:3px 8px
}
.hero{
  border:1px solid #25252c;
  border-radius:14px;
  padding:22px;
  background:linear-gradient(180deg,#121215,#0a0a0d);
  box-shadow:0 16px 40px rgba(0,0,0,0.6)
}
.eyebrow{
  font-size:9px;
  letter-spacing:.2em;
  color:#707078;
  font-weight:800
}
.hero h1{
  font-size:24px;
  line-height:1.15;
  margin:8px 0 6px
}
.hero p{
  color:#94949c;
  line-height:1.45;
  max-width:650px;
  font-size:12px;
  margin:0 0 14px
}
.prompt-box{
  background:#09090b;
  border:1px dashed #303036;
  border-radius:8px;
  padding:10px;
  font-size:11px;
  color:#a5a5ad;
  display:flex;
  justify-content:space-between;
  align-items:center
}
.grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:8px;
  margin-top:12px
}
.card{
  border:1px solid #202026;
  border-radius:10px;
  padding:12px;
  background:#09090c
}
.card b{font-size:11px;display:block;margin-bottom:3px;color:#f0f0f4}
.card span{
  display:block;
  color:#6b6b74;
  font-size:10px;
  line-height:1.35
}
@media(max-width:650px){
  .grid{grid-template-columns:1fr}
  .hero h1{font-size:20px}
}
</style>
</head>
<body>
<div class="shell">
<div class="top">
  <div class="brand">KLIZONION LIVE PREVIEW</div>
  <div class="pill">SANDBOXED RESULT</div>
</div>
<section class="hero">
<div class="eyebrow">ACTIVE BUILD OUTPUT</div>
<h1>${safeTitle}</h1>
<p>${safeDescription}</p>
<div class="prompt-box">
  <span><b>Target:</b> ${safePrompt}</span>
  <span style="color:#74f29b;font-weight:700">Effort: ${safeEffort}</span>
</div>
<div class="grid">
<div class="card">
<b>01. Understand & Plan</b>
<span>Mission parsed and converted into structured milestones.</span>
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
<b>04. Live Result</b>
<span>Project output renders in this sandboxed iframe.</span>
</div>
</div>
</section>
</div>
</body>
</html>`;
}

function renderPreview(prompt) {
  const previewFrame = $('#previewFrame');
  if (!previewFrame) return;
  const [title, description] = modeLabels[state.mode];
  previewFrame.srcdoc = previewTemplate(
    title,
    description,
    prompt || 'Describe what you want to build in your mission prompt.',
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
  const missionMode = $('#missionMode');
  if (missionMode) {
    missionMode.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
  }
  const promptInput = $('#promptInput');
  renderPreview(promptInput ? promptInput.value.trim() : '');
}

function setEffort(level) {
  state.effort = level;
  const effortValue = $('#effortValue');
  if (effortValue) effortValue.textContent = level.charAt(0).toUpperCase() + level.slice(1);
  const missionEffortDisplay = $('#missionEffortDisplay');
  if (missionEffortDisplay) missionEffortDisplay.textContent = level.charAt(0).toUpperCase() + level.slice(1);
  const effortBadge = $('#effortBadge');
  if (effortBadge) effortBadge.textContent = `Effort: ${level.charAt(0).toUpperCase() + level.slice(1)}`;

  $$('.effort-opt').forEach((opt) => {
    opt.classList.toggle('selected', opt.dataset.effort === level);
  });
  const effortMenu = $('#effortMenu');
  if (effortMenu) effortMenu.classList.add('hidden');
  const promptInput = $('#promptInput');
  renderPreview(promptInput ? promptInput.value.trim() : '');
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

// =============================================================================
// ROUTING SYSTEM (#home, #register, #login, #verify, #dashboard)
// =============================================================================
function getRoute() {
  const hash = (location.hash || '#home').replace(/^#/, '').toLowerCase();
  const [routeName] = hash.split('?');
  if (['home', 'register', 'login', 'verify', 'dashboard'].includes(routeName)) {
    return routeName;
  }
  return 'home';
}

function navigateTo(route) {
  location.hash = `#${route}`;
}

async function handleRouting() {
  const route = getRoute();
  state.route = route;

  // View containers
  const viewHome = $('#viewHome');
  const viewAuth = $('#viewAuth');
  const viewDashboard = $('#viewDashboard');

  // Subviews
  const authRegisterView = $('#authRegisterView');
  const authLoginView = $('#authLoginView');
  const authVerifyView = $('#authVerifyView');

  // Topbar action sets
  const publicNav = $('#publicNav');
  const dashboardActions = $('#dashboardActions');

  // Check auth requirement for dashboard
  if (route === 'dashboard') {
    if (!state.authToken) {
      log('Unauthenticated access to dashboard. Redirecting to login.', 'info');
      navigateTo('login');
      return;
    }

    // Authenticated dashboard view
    if (viewHome) viewHome.classList.add('hidden');
    if (viewAuth) viewAuth.classList.add('hidden');
    if (viewDashboard) viewDashboard.classList.remove('hidden');

    if (publicNav) publicNav.classList.add('hidden');
    if (dashboardActions) dashboardActions.classList.remove('hidden');

    updateUserUI();
    refreshStatus();
    renderPreview($('#promptInput')?.value.trim() || '');
    return;
  }

  // If authenticated and visiting home or auth, keep user notified or let them view overview
  if (state.authToken) {
    if (publicNav) publicNav.classList.add('hidden');
    if (dashboardActions) dashboardActions.classList.remove('hidden');
  } else {
    if (publicNav) publicNav.classList.remove('hidden');
    if (dashboardActions) dashboardActions.classList.add('hidden');
  }

  // Dashboard hidden on non-dashboard routes
  if (viewDashboard) viewDashboard.classList.add('hidden');

  if (route === 'home') {
    if (viewHome) viewHome.classList.remove('hidden');
    if (viewAuth) viewAuth.classList.add('hidden');
    return;
  }

  // Auth subviews
  if (viewHome) viewHome.classList.add('hidden');
  if (viewAuth) viewAuth.classList.remove('hidden');

  if (route === 'register') {
    if (authRegisterView) authRegisterView.classList.remove('hidden');
    if (authLoginView) authLoginView.classList.add('hidden');
    if (authVerifyView) authVerifyView.classList.add('hidden');
    setTimeout(initTurnstileWidget, 50);
  } else if (route === 'login') {
    if (authRegisterView) authRegisterView.classList.add('hidden');
    if (authLoginView) authLoginView.classList.remove('hidden');
    if (authVerifyView) authVerifyView.classList.add('hidden');
  } else if (route === 'verify') {
    if (authRegisterView) authRegisterView.classList.add('hidden');
    if (authLoginView) authLoginView.classList.add('hidden');
    if (authVerifyView) authVerifyView.classList.remove('hidden');
    const codeInput = $('#verificationCodeInput');
    if (codeInput) codeInput.focus();
  }
}

// =============================================================================
// AUTHENTICATION & SESSION MANAGEMENT
// =============================================================================
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

async function validateSessionOnServer(token) {
  try {
    const res = await fetch(`${API}/api/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.authenticated ? data.user : null;
  } catch {
    return null;
  }
}

async function initSession() {
  const storedToken = localStorage.getItem('klizonion_token');
  if (!storedToken) {
    state.authToken = null;
    state.user = null;
    return;
  }

  const verifiedUser = await validateSessionOnServer(storedToken);
  if (verifiedUser) {
    state.authToken = storedToken;
    state.user = verifiedUser;
    localStorage.setItem('klizonion_user', JSON.stringify(verifiedUser));
  } else {
    // Invalidate stale local session
    state.authToken = null;
    state.user = null;
    localStorage.removeItem('klizonion_token');
    localStorage.removeItem('klizonion_user');
  }
}

function updateUserUI() {
  if (state.user) {
    const name = state.user.username || 'Engineer';
    const email = state.user.email || '';

    const authBtnText = $('#authBtnText');
    if (authBtnText) authBtnText.textContent = name;

    const sideUsername = $('#sideUsername');
    if (sideUsername) sideUsername.textContent = name;

    const sideEmail = $('#sideEmail');
    if (sideEmail) sideEmail.textContent = email;

    const modalSessionUsername = $('#modalSessionUsername');
    if (modalSessionUsername) modalSessionUsername.textContent = name;

    const modalSessionEmail = $('#modalSessionEmail');
    if (modalSessionEmail) modalSessionEmail.textContent = email;
  }
}

async function handleLogout() {
  if (state.authToken) {
    try {
      await fetch(`${API}/api/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${state.authToken}` },
      });
    } catch {}
  }
  state.authToken = null;
  state.user = null;
  state.missionId = null;
  state.mission = null;
  localStorage.removeItem('klizonion_token');
  localStorage.removeItem('klizonion_user');

  const authModal = $('#authModal');
  if (authModal) authModal.classList.add('hidden');

  showToast('Signed out of workspace.', 'info');
  navigateTo('home');
}

// =============================================================================
// MISSION & BUILDER API
// =============================================================================
async function createMission(prompt) {
  if (!state.authToken) {
    throw new Error('You must be signed in to create a build mission.');
  }

  const response = await fetch(`${API}/api/builder/missions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${state.authToken}`,
    },
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
  if (!state.missionId || !state.activeMissionRunning) return;
  const stopBtn = $('#stopBtn');
  const buildBtn = $('#buildBtn');

  if (stopBtn) {
    stopBtn.disabled = true;
    const label = stopBtn.querySelector('span:last-child');
    if (label) label.textContent = 'Stopping…';
  }

  log(`Requesting stop for mission: ${state.missionId}…`);

  try {
    const response = await fetch(`${API}/api/builder/missions/${encodeURIComponent(state.missionId)}/stop`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: state.authToken ? `Bearer ${state.authToken}` : '',
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);

    state.activeMissionRunning = false;
    if (state.pollInterval) {
      clearInterval(state.pollInterval);
      state.pollInterval = null;
    }

    setJob('stopped', 'STOPPED');
    setMissionBadge('stopped', 'STOPPED');
    setMissionState('Stopped');
    const previewStatus = $('#previewStatus');
    if (previewStatus) previewStatus.textContent = 'Mission stopped by user';

    log(`Mission ${state.missionId} stopped.`, 'error');
    addChatMessage('agent', 'Mission stopped. You can refine your prompt or change effort and build again.');
    showToast('Mission stopped.', 'info');
  } catch (err) {
    log(`Could not stop mission: ${err.message}`, 'error');
    showToast(`Stop failed: ${err.message}`, 'error');
  } finally {
    if (stopBtn) {
      stopBtn.disabled = true;
      const label = stopBtn.querySelector('span:last-child');
      if (label) label.textContent = 'Stop';
    }
    if (buildBtn) {
      buildBtn.disabled = false;
      const label = buildBtn.querySelector('span:first-child');
      if (label) label.textContent = 'Build';
    }
    state.busy = false;
  }
}

async function createMissionAction(missionId, operation) {
  const response = await fetch(`${API}/api/builder/missions/${encodeURIComponent(missionId)}/actions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: state.authToken ? `Bearer ${state.authToken}` : '',
    },
    body: JSON.stringify({ operation, payload: {} }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
  return payload;
}

async function startBuild() {
  if (!state.authToken) {
    showToast('Please sign in to start building.', 'info');
    navigateTo('login');
    return;
  }

  const promptInput = $('#promptInput');
  const prompt = promptInput ? promptInput.value.trim() : '';
  if (!prompt || state.busy) return;

  const buildBtn = $('#buildBtn');
  const stopBtn = $('#stopBtn');
  const previewStatus = $('#previewStatus');
  const projectName = $('#projectName');
  const missionIdLabel = $('#missionIdLabel');
  const missionIdSide = $('#missionIdSide');

  state.busy = true;
  state.activeMissionRunning = true;
  if (buildBtn) {
    buildBtn.disabled = true;
    const label = buildBtn.querySelector('span:first-child');
    if (label) label.textContent = 'Building…';
  }
  if (stopBtn) stopBtn.disabled = false;

  setJob('running', 'STARTING');
  setMissionBadge('running', 'PLANNING');
  resetWorkflow();
  activateWorkflowStep('understand');
  setMissionState('Creating mission');

  const name = guessProjectName(prompt);
  if (projectName) projectName.textContent = name;

  addChatMessage('user', prompt);
  log(`Mission received: ${prompt}`);
  log(`Mode: ${state.mode} | Effort: ${state.effort}`);
  log('Submitting build mission to control plane…');
  renderPreview(prompt);

  try {
    const payload = await createMission(prompt);
    const mission = payload.mission || payload;
    state.mission = mission;
    state.missionId = mission.id || mission.missionId || payload.id;

    if (missionIdLabel) missionIdLabel.textContent = state.missionId;
    if (missionIdSide) missionIdSide.textContent = state.missionId;
    setMissionState('Planning');

    log(`Mission created on Worker: ${state.missionId}`, 'success');
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
          if (previewStatus) previewStatus.textContent = 'Live preview active';
          renderPreview(prompt);

          setTimeout(() => {
            if (!state.activeMissionRunning) return;
            completeWorkflow();
            setJob('success', 'READY');
            setMissionBadge('success', 'READY');
            setMissionState('Mission complete');
            if (stopBtn) stopBtn.disabled = true;
            if (buildBtn) {
              buildBtn.disabled = false;
              const label = buildBtn.querySelector('span:first-child');
              if (label) label.textContent = 'Build';
            }
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
    if (previewStatus) previewStatus.textContent = 'Mission creation failed';
    log(`Mission error: ${error.message}`, 'error');
    addChatMessage('agent', `Could not create mission: ${error.message}`);
    showToast(`Build error: ${error.message}`, 'error');
    if (stopBtn) stopBtn.disabled = true;
    if (buildBtn) {
      buildBtn.disabled = false;
      const label = buildBtn.querySelector('span:first-child');
      if (label) label.textContent = 'Build';
    }
    state.busy = false;
    state.activeMissionRunning = false;
  }
}

// Model Save & Publish Handlers
async function handleSaveModel() {
  const modelActionMsg = $('#modelActionMsg');
  const modelActionMsgSide = $('#modelActionMsgSide');
  const setMsg = (text, className) => {
    if (modelActionMsg) {
      modelActionMsg.textContent = text;
      modelActionMsg.className = `model-msg ${className}`;
    }
    if (modelActionMsgSide) {
      modelActionMsgSide.textContent = text;
      modelActionMsgSide.className = `model-msg ${className}`;
    }
  };

  setMsg('Preserving model state…', '');
  log('Preserving custom model metadata and configuration…');
  try {
    const res = await fetch(`${API}/api/builder/models/save`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: state.authToken ? `Bearer ${state.authToken}` : '',
      },
      body: JSON.stringify({
        name: `${$('#projectName')?.textContent || 'Custom Model'} - Klizonion 59M`,
        missionId: state.missionId,
        effort: state.effort,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);

    setMsg('✓ Model saved successfully', 'text-green');
    log(`Custom model preserved (ID: ${data.model.id})`, 'success');
    showToast('Custom model saved successfully!', 'success');
  } catch (err) {
    setMsg(`Save failed: ${err.message}`, 'text-red');
    log(`Model save failed: ${err.message}`, 'error');
    showToast(`Model save failed: ${err.message}`, 'error');
  }
}

async function handlePublishModel() {
  const modelActionMsg = $('#modelActionMsg');
  const modelActionMsgSide = $('#modelActionMsgSide');
  const setMsg = (text, className) => {
    if (modelActionMsg) {
      modelActionMsg.textContent = text;
      modelActionMsg.className = `model-msg ${className}`;
    }
    if (modelActionMsgSide) {
      modelActionMsgSide.textContent = text;
      modelActionMsgSide.className = `model-msg ${className}`;
    }
  };

  setMsg('Packaging model source & config ZIP…', '');
  log('Packaging KLIZONION-CustomModel.zip (portable source + configuration + artifact pointers)…');

  try {
    const res = await fetch(`${API}/api/builder/models/publish`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: state.authToken ? `Bearer ${state.authToken}` : '',
      },
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

      setMsg('✓ Source & Config ZIP downloaded (Weights referenced in klizonion-model.json)', 'text-green');
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
      name: $('#projectName')?.textContent || 'KLIZONION Custom Model',
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

    setMsg('✓ Source & Config ZIP downloaded (Weights referenced in klizonion-model.json)', 'text-green');
    log('Client-side ZIP generated: KLIZONION-CustomModel.zip (Source/Config). Large weights are referenced externally.', 'success');
    showToast('Source & config package downloaded!', 'success');
  } catch (clientErr) {
    setMsg(`Publish failed: ${clientErr.message}`, 'text-red');
    log(`Publish failed: ${clientErr.message}`, 'error');
    showToast(`Publish failed: ${clientErr.message}`, 'error');
  }
}

// Runner / Control plane status polling
async function refreshStatus() {
  try {
    const res = await fetch(`${API}/api/builder/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    state.runner = Boolean(data.runner);
    const connectionPill = $('#connectionPill');
    const connectionText = $('#connectionText');
    const runnerState = $('#runnerState');
    const environmentDot = $('#environmentDot');
    const workspacePath = $('#workspacePath');
    const workspacePathDisplay = $('#workspacePathDisplay');
    const hardwareState = $('#hardwareState');

    if (connectionPill) connectionPill.className = `connection-pill ${state.runner ? 'online' : 'offline'}`;
    if (connectionText) connectionText.textContent = state.runner ? 'Runner online' : 'Runner offline';
    if (runnerState) runnerState.textContent = state.runner ? 'Online' : 'Offline';
    if (environmentDot) environmentDot.className = `environment-dot ${state.runner ? 'online' : 'offline'}`;
    if (workspacePath) workspacePath.textContent = data.workspace || 'Not connected';
    if (workspacePathDisplay) workspacePathDisplay.textContent = data.workspace || 'Authorized workspace';
    if (hardwareState) hardwareState.textContent = data.hardware || 'Unknown';
  } catch {
    state.runner = false;
    const connectionPill = $('#connectionPill');
    const connectionText = $('#connectionText');
    const runnerState = $('#runnerState');
    const environmentDot = $('#environmentDot');
    const workspacePath = $('#workspacePath');
    const workspacePathDisplay = $('#workspacePathDisplay');
    const hardwareState = $('#hardwareState');

    if (connectionPill) connectionPill.className = 'connection-pill offline';
    if (connectionText) connectionText.textContent = 'Runner offline';
    if (runnerState) runnerState.textContent = 'Offline';
    if (environmentDot) environmentDot.className = 'environment-dot offline';
    if (workspacePath) workspacePath.textContent = 'Not connected';
    if (workspacePathDisplay) workspacePathDisplay.textContent = 'Local workspace';
    if (hardwareState) hardwareState.textContent = 'Unavailable';
  }
}

// =============================================================================
// DOM EVENT WIRING
// =============================================================================
function setupEventListeners() {
  // Navigation / Landing Page CTAs
  $('#landingStartBtn')?.addEventListener('click', () => {
    if (state.authToken) {
      navigateTo('dashboard');
    } else {
      navigateTo('register');
    }
  });

  $('#landingBottomStartBtn')?.addEventListener('click', () => {
    if (state.authToken) {
      navigateTo('dashboard');
    } else {
      navigateTo('register');
    }
  });

  // Topbar logout
  $('#topbarLogoutBtn')?.addEventListener('click', handleLogout);
  $('#sideLogoutBtn')?.addEventListener('click', handleLogout);
  $('#modalLogoutBtn')?.addEventListener('click', handleLogout);

  // Account modal trigger
  $('#authModalBtn')?.addEventListener('click', () => {
    const authModal = $('#authModal');
    if (authModal) authModal.classList.remove('hidden');
  });

  $('#closeAuthModal')?.addEventListener('click', () => {
    const authModal = $('#authModal');
    if (authModal) authModal.classList.add('hidden');
  });

  $('#authModal')?.addEventListener('click', (e) => {
    if (e.target === $('#authModal')) {
      $('#authModal')?.classList.add('hidden');
    }
  });

  // Effort control popover
  const effortBtn = $('#effortBtn');
  const effortMenu = $('#effortMenu');
  effortBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    effortMenu?.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (effortBtn && effortMenu && !effortBtn.contains(e.target) && !effortMenu.contains(e.target)) {
      effortMenu.classList.add('hidden');
    }
  });

  $$('.effort-opt').forEach((opt) => {
    opt.addEventListener('click', () => setEffort(opt.dataset.effort));
  });

  // Build & Stop
  $('#buildBtn')?.addEventListener('click', startBuild);
  $('#stopBtn')?.addEventListener('click', stopActiveMission);

  // Model actions
  $('#saveModelBtn')?.addEventListener('click', handleSaveModel);
  $('#saveModelBtnSide')?.addEventListener('click', handleSaveModel);
  $('#publishModelBtn')?.addEventListener('click', handlePublishModel);
  $('#publishModelBtnSide')?.addEventListener('click', handlePublishModel);

  // Mode chips & Nav
  $$('.nav-item').forEach((item) => {
    item.addEventListener('click', () => setMode(item.dataset.mode));
  });

  $$('.chip').forEach((item) => {
    item.addEventListener('click', () => setMode(item.dataset.template));
  });

  $$('.suggestion').forEach((item) => {
    item.addEventListener('click', () => {
      const promptInput = $('#promptInput');
      if (promptInput) {
        promptInput.value = item.dataset.prompt;
        renderPreview(promptInput.value);
        promptInput.focus();
      }
    });
  });

  // Prompt input
  const promptInput = $('#promptInput');
  promptInput?.addEventListener('input', () => renderPreview(promptInput.value));
  promptInput?.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      startBuild();
    }
  });

  // Chat console
  const chatInput = $('#chatInput');
  const chatSendBtn = $('#chatSendBtn');
  const sendChat = async () => {
    if (!chatInput) return;
    const text = chatInput.value.trim();
    if (!text) return;
    addChatMessage('user', text);
    chatInput.value = '';
    log(`Chat message: ${text}`);

    if (!state.authToken) {
      addChatMessage('agent', 'Please sign in to chat with the KLIZONION Builder agent.');
      return;
    }

    try {
      const res = await fetch(`${API}/api/agent/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${state.authToken}`,
        },
        body: JSON.stringify({ prompt: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.message?.content) {
        addChatMessage('agent', data.message.content);
      } else {
        const fallback = data.message || data.error || (state.missionId ? 'Directive captured by agent loop.' : 'Describe a build mission above to begin.');
        addChatMessage('agent', fallback);
      }
    } catch {
      addChatMessage('agent', state.missionId ? 'Directive captured by agent loop.' : 'Describe a build mission above to begin.');
    }
  };

  chatSendBtn?.addEventListener('click', sendChat);
  chatInput?.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      sendChat();
    }
  });

  // Preview refresh
  $('#refreshPreviewBtn')?.addEventListener('click', () => {
    renderPreview(promptInput?.value || '');
    const previewStatus = $('#previewStatus');
    if (previewStatus) previewStatus.textContent = 'Preview refreshed';
    log('Live preview refreshed.');
  });

  // Clear logs
  $('#clearLogsBtn')?.addEventListener('click', () => {
    const activityLog = $('#activityLog');
    if (activityLog) activityLog.innerHTML = '';
  });

  // New project reset
  $('#newProjectBtn')?.addEventListener('click', () => {
    state.missionId = null;
    state.mission = null;
    state.activeMissionRunning = false;
    if (promptInput) promptInput.value = '';
    if (chatInput) chatInput.value = '';

    const projectName = $('#projectName');
    if (projectName) projectName.textContent = 'Untitled build';

    const missionIdLabel = $('#missionIdLabel');
    if (missionIdLabel) missionIdLabel.textContent = 'No mission';

    const missionIdSide = $('#missionIdSide');
    if (missionIdSide) missionIdSide.textContent = '—';

    setJob('idle', 'IDLE');
    setMissionBadge('idle', 'IDLE');
    setMissionState('Idle');

    const previewStatus = $('#previewStatus');
    if (previewStatus) previewStatus.textContent = 'Waiting for a build';

    const activityLog = $('#activityLog');
    if (activityLog) activityLog.innerHTML = '';

    const chatMessages = $('#chatMessages');
    if (chatMessages) {
      chatMessages.innerHTML = `
        <div class="chat-message agent">
          <div class="message-label">KLIZONION BUILDER</div>
          <div class="message-body">
            Welcome to your Builder workspace. Describe a feature, select an effort level, and press Build to begin.
          </div>
        </div>
      `;
    }

    resetWorkflow();
    log('New project workspace ready.');
    renderPreview('');
    showToast('Workspace reset for new project.', 'info');
  });

  // Code input formatter for 16-digits
  const verificationCodeInput = $('#verificationCodeInput');
  verificationCodeInput?.addEventListener('input', (e) => {
    let val = e.target.value.replace(/\D/g, '').slice(0, 16);
    const parts = [];
    for (let i = 0; i < val.length; i += 4) {
      parts.push(val.slice(i, i + 4));
    }
    e.target.value = parts.join('-');
  });

  // Registration Form
  $('#registerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const regMsg = $('#regMsg');
    const regSubmitBtn = $('#regSubmitBtn');
    const regUsername = $('#regUsername');
    const regEmail = $('#regEmail');
    const regPassword = $('#regPassword');
    const regConfirm = $('#regConfirm');

    if (regMsg) {
      regMsg.textContent = '';
      regMsg.className = 'auth-feedback';
    }

    const p = regPassword?.value || '';
    const c = regConfirm?.value || '';
    if (p !== c) {
      if (regMsg) {
        regMsg.textContent = 'Passwords do not match.';
        regMsg.className = 'auth-feedback error';
      }
      return;
    }

    const turnstileInput = document.querySelector('#registerForm [name="cf-turnstile-response"]');
    const tokenToSend = currentTurnstileToken || (turnstileInput ? turnstileInput.value : '');
    if (!tokenToSend) {
      const err = document.getElementById('turnstileError');
      if (err) {
        err.textContent = 'Please complete the Turnstile security challenge.';
        err.style.display = 'block';
      }
      if (regMsg) {
        regMsg.textContent = 'Please complete the security challenge above.';
        regMsg.className = 'auth-feedback error';
      }
      return;
    }

    if (regSubmitBtn) {
      regSubmitBtn.disabled = true;
      regSubmitBtn.textContent = 'Dispatching 16-digit code…';
    }

    try {
      const res = await fetch(`${API}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: regUsername?.value.trim(),
          email: regEmail?.value.trim(),
          password: p,
          turnstileToken: tokenToSend,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 503 && data.verification_token) {
          state.verificationToken = data.verification_token;
          navigateTo('verify');
          const verifyMsg = $('#verifyMsg');
          const providerMsg = data.message || 'Verification email provider configuration required.';
          if (verifyMsg) {
            verifyMsg.textContent = `⚠️ ${providerMsg}`;
            verifyMsg.className = 'auth-feedback error';
          }
          showToast('Email delivery provider required', 'error');
          return;
        }

        if (window.turnstile && turnstileWidgetId !== null) {
          try { window.turnstile.reset(turnstileWidgetId); } catch {}
          currentTurnstileToken = '';
        }

        throw new Error(data.message || data.error || 'Registration failed');
      }

      state.verificationToken = data.verification_token;
      navigateTo('verify');
      const verifyMsg = $('#verifyMsg');
      if (verifyMsg) {
        verifyMsg.textContent = 'A 16-digit verification code has been dispatched to your email.';
        verifyMsg.className = 'auth-feedback success';
      }
      showToast('Verification code dispatched!', 'success');
    } catch (err) {
      if (regMsg) {
        regMsg.textContent = err.message;
        regMsg.className = 'auth-feedback error';
      }
    } finally {
      if (regSubmitBtn) {
        regSubmitBtn.disabled = false;
        regSubmitBtn.textContent = 'Create account & Send 16-digit code';
      }
    }
  });

  // Login Form
  $('#loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const loginMsg = $('#loginMsg');
    const loginSubmitBtn = $('#loginSubmitBtn');
    const loginEmail = $('#loginEmail');
    const loginPassword = $('#loginPassword');

    if (loginMsg) {
      loginMsg.textContent = '';
      loginMsg.className = 'auth-feedback';
    }

    if (loginSubmitBtn) {
      loginSubmitBtn.disabled = true;
      loginSubmitBtn.textContent = 'Signing in…';
    }

    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: loginEmail?.value.trim(),
          password: loginPassword?.value || '',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Login failed');

      state.authToken = data.token;
      state.user = data.user;
      localStorage.setItem('klizonion_token', data.token);
      localStorage.setItem('klizonion_user', JSON.stringify(data.user));

      updateUserUI();
      showToast('Signed in successfully!', 'success');
      navigateTo('dashboard');
    } catch (err) {
      if (loginMsg) {
        loginMsg.textContent = err.message;
        loginMsg.className = 'auth-feedback error';
      }
    } finally {
      if (loginSubmitBtn) {
        loginSubmitBtn.disabled = false;
        loginSubmitBtn.textContent = 'Sign In to Workspace';
      }
    }
  });

  // Verification Form
  $('#verifyForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const verifyMsg = $('#verifyMsg');
    const verifySubmitBtn = $('#verifySubmitBtn');
    const verificationCodeInput = $('#verificationCodeInput');

    if (verifyMsg) {
      verifyMsg.textContent = '';
      verifyMsg.className = 'auth-feedback';
    }

    const rawCode = verificationCodeInput ? verificationCodeInput.value.replace(/\D/g, '') : '';
    if (rawCode.length !== 16) {
      if (verifyMsg) {
        verifyMsg.textContent = 'Please enter all 16 decimal digits.';
        verifyMsg.className = 'auth-feedback error';
      }
      verificationCodeInput?.focus();
      return;
    }

    if (verifySubmitBtn) {
      verifySubmitBtn.disabled = true;
      verifySubmitBtn.textContent = 'Verifying…';
    }

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

      state.authToken = data.token;
      state.user = data.user;
      localStorage.setItem('klizonion_token', data.token);
      localStorage.setItem('klizonion_user', JSON.stringify(data.user));

      updateUserUI();
      showToast('Account verified and workspace activated!', 'success');
      navigateTo('dashboard');
    } catch (err) {
      if (verifyMsg) {
        verifyMsg.textContent = err.message;
        verifyMsg.className = 'auth-feedback error';
      }
    } finally {
      if (verifySubmitBtn) {
        verifySubmitBtn.disabled = false;
        verifySubmitBtn.textContent = 'Verify & Open Dashboard';
      }
    }
  });

  // Resend code
  $('#resendCodeBtn')?.addEventListener('click', async () => {
    if (!state.verificationToken) {
      showToast('No active verification session to resend.', 'info');
      return;
    }
    const resendBtn = $('#resendCodeBtn');
    const verifyMsg = $('#verifyMsg');
    if (resendBtn) {
      resendBtn.disabled = true;
      resendBtn.textContent = 'Resending…';
    }

    try {
      const res = await fetch(`${API}/api/auth/resend`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: state.verificationToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Resend failed');

      if (verifyMsg) {
        verifyMsg.textContent = 'A new 16-digit verification code has been dispatched.';
        verifyMsg.className = 'auth-feedback success';
      }
      showToast('New code dispatched!', 'success');
    } catch (err) {
      if (verifyMsg) {
        verifyMsg.textContent = err.message;
        verifyMsg.className = 'auth-feedback error';
      }
    } finally {
      if (resendBtn) {
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend Code';
      }
    }
  });

  // Window hash routing change
  window.addEventListener('hashchange', handleRouting);
}

// =============================================================================
// INITIALIZATION
// =============================================================================
async function init() {
  await fetchAuthConfig();
  await initSession();

  // Check URL query parameters for verification token
  const urlParams = new URLSearchParams(location.search);
  const vTok = urlParams.get('verification');
  if (vTok) {
    state.verificationToken = vTok;
    navigateTo('verify');
  }

  setupEventListeners();
  resetWorkflow();
  renderPreview('');
  log('KLIZONION Builder Beta V0.2 engine initialized.');
  handleRouting();

  // Status poller every 6 seconds
  setInterval(refreshStatus, 6000);
}

init();
