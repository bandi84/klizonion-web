const API =
  window.KLIZONION_BUILDER_API ||
  'http://localhost:8787';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const promptInput = $('#promptInput');
const buildBtn = $('#buildBtn');
const chatInput = $('#chatInput');
const chatSendBtn = $('#chatSendBtn');

const previewFrame = $('#previewFrame');
const previewStatus = $('#previewStatus');

const activityLog = $('#activityLog');
const chatMessages = $('#chatMessages');

const jobBadge = $('#jobBadge');
const missionBadge = $('#missionBadge');

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
const missionIdSide = $('#missionIdSide');
const missionIdLabel = $('#missionIdLabel');
const workflowMode = $('#workflowMode');

const state = {
  mode: 'anything',
  busy: false,
  runner: false,
  missionId: null,
  mission: null,
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

  const label = role === 'user' ? 'YOU' : 'KLIZONION';

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
}

function setMissionBadge(status, label = status.toUpperCase()) {
  missionBadge.className = `mission-badge ${status}`;
  missionBadge.textContent = label;
}

function setMissionState(status) {
  missionState.textContent = status;
}

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

function previewTemplate(title, description, prompt) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safePrompt = escapeHtml(prompt);

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
  padding:28px
}
.shell{max-width:940px;margin:0 auto}
.top{
  display:flex;
  justify-content:space-between;
  align-items:center;
  margin-bottom:28px
}
.brand{
  font-weight:800;
  letter-spacing:.08em
}
.pill{
  font-size:10px;
  color:#8f8f96;
  border:1px solid #2c2c30;
  border-radius:999px;
  padding:5px 8px
}
.hero{
  border:1px solid #2a2a2e;
  border-radius:18px;
  padding:30px;
  background:linear-gradient(180deg,#121214,#0d0d0f);
  box-shadow:0 20px 50px #0007
}
.eyebrow{
  font-size:9px;
  letter-spacing:.2em;
  color:#707078;
  font-weight:800
}
.hero h1{
  font-size:34px;
  line-height:1.06;
  margin:11px 0
}
.hero p{
  color:#94949c;
  line-height:1.6;
  max-width:650px;
  font-size:13px
}
.prompt{
  margin-top:18px;
  padding:12px;
  border:1px dashed #34343a;
  border-radius:12px;
  color:#8b8b92;
  font-size:11px
}
.grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:10px;
  margin-top:10px
}
.card{
  border:1px solid #25252a;
  border-radius:14px;
  padding:15px;
  background:#0c0c0e
}
.card b{font-size:12px}
.card span{
  display:block;
  color:#686870;
  font-size:10px;
  margin-top:6px;
  line-height:1.5
}
@media(max-width:650px){
  .grid{grid-template-columns:1fr}
  .hero h1{font-size:27px}
}
</style>
</head>

<body>
<div class="shell">

<div class="top">
  <div class="brand">KLIZONION</div>
  <div class="pill">LIVE PREVIEW</div>
</div>

<section class="hero">

<div class="eyebrow">BUILDER OUTPUT</div>

<h1>${safeTitle}</h1>

<p>${safeDescription}</p>

<div class="prompt">
Build request: ${safePrompt}
</div>

<div class="grid">

<div class="card">
<b>Understand</b>
<span>
Mission parsed and converted into a structured engineering request.
</span>
</div>

<div class="card">
<b>Plan</b>
<span>
The Builder prepares the steps required to complete the mission.
</span>
</div>

<div class="card">
<b>Build</b>
<span>
The authorized workspace will eventually receive the real project changes.
</span>
</div>

<div class="card">
<b>Preview</b>
<span>
This preview surface will eventually display the actual generated project.
</span>
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
    item.classList.toggle(
      'active',
      item.dataset.mode === mode,
    );
  });

  $$('.chip').forEach((item) => {
    item.classList.toggle(
      'active',
      item.dataset.template === mode,
    );
  });

  missionMode.textContent =
    mode.charAt(0).toUpperCase() +
    mode.slice(1);

  renderPreview(promptInput.value.trim());
}

function guessProjectName(prompt) {
  const clean = prompt
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .trim();

  if (!clean) {
    return 'Untitled build';
  }

  const words = clean
    .split(/\s+/)
    .slice(0, 5);

  const name = words
    .map(
      (word) =>
        word[0].toUpperCase() +
        word.slice(1).toLowerCase(),
    )
    .join(' ');

  return `${name} Build`;
}

async function getJson(path) {
  const response = await fetch(`${API}${path}`);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

async function createMission(prompt) {
  const response = await fetch(
    `${API}/api/builder/missions`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        mission: prompt,
        mode: state.mode,
      }),
    },
  );

  const payload = await response.json().catch(
    () => ({}),
  );

  if (!response.ok) {
    throw new Error(
      payload.error ||
        payload.message ||
        `HTTP ${response.status}`,
    );
  }

  return payload;
}

async function createMissionAction(
  missionId,
  operation,
) {
  const response = await fetch(
    `${API}/api/builder/missions/${encodeURIComponent(
      missionId,
    )}/actions`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        operation,
        payload: {},
      }),
    },
  );

  const payload = await response.json().catch(
    () => ({}),
  );

  if (!response.ok) {
    throw new Error(
      payload.error ||
        payload.message ||
        `HTTP ${response.status}`,
    );
  }

  return payload;
}

async function sendChatMessage() {
  const text = chatInput.value.trim();

  if (!text) {
    return;
  }

  addChatMessage('user', text);
  chatInput.value = '';

  log(`Chat message: ${text}`);

  if (!state.missionId) {
    addChatMessage(
      'agent',
      'Create a build mission first, then I can use this chat to continue the mission.',
    );
    return;
  }

  addChatMessage(
    'agent',
    'The mission chat transport is reserved for the connected Agent API. Your message has been captured locally.',
  );
}

async function startBuild() {
  const prompt = promptInput.value.trim();

  if (!prompt || state.busy) {
    return;
  }

  state.busy = true;
  buildBtn.disabled = true;

  buildBtn.querySelector(
    'span:first-child',
  ).textContent = 'Starting…';

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
  log(`Mode: ${state.mode}`);
  log('Creating Builder mission…');

  renderPreview(prompt);

  try {
    const payload = await createMission(prompt);

    const mission =
      payload.mission ||
      payload;

    state.mission =
      mission;

    state.missionId =
      mission.id ||
      mission.missionId ||
      payload.id ||
      null;

    if (!state.missionId) {
      throw new Error(
        'Worker created the mission but returned no mission ID.',
      );
    }

    missionIdLabel.textContent =
      state.missionId;

    missionIdSide.textContent =
      state.missionId;

    setMissionState('Planning');

    log(
      `Mission created: ${state.missionId}`,
      'success',
    );

    addChatMessage(
      'agent',
      'Mission created. I am preparing the engineering workflow.',
    );

    activateWorkflowStep('plan');

    log(
      'Builder planning stage initialized.',
    );

    const operations = [
      'workspace.list',
      'git.status',
    ];

    for (
      let index = 0;
      index < operations.length;
      index += 1
    ) {
      const operation =
        operations[index];

      if (operation === 'workspace.list') {
        activateWorkflowStep('inspect');
        setMissionState('Inspecting');
      }

      log(
        `Preparing action: ${operation}`,
      );

      try {
        await createMissionAction(
          state.missionId,
          operation,
        );

        log(
          `Action queued: ${operation}`,
          'success',
        );
      } catch (error) {
        log(
          `Action could not be queued: ${error.message}`,
          'error',
        );
      }
    }

    setJob('success', 'QUEUED');
    setMissionBadge('success', 'QUEUED');

    activateWorkflowStep('build');

    setMissionState(
      'Queued for Builder execution',
    );

    previewStatus.textContent =
      'Mission accepted by control plane';

    log(
      'Mission is now waiting for the connected supervised runner.',
      'success',
    );

    addChatMessage(
      'agent',
      'The mission is queued. The next stages will run when the supervised runner is connected.',
    );
  } catch (error) {
    setJob('failed', 'FAILED');
    setMissionBadge('failed', 'FAILED');

    setMissionState('Failed');

    failWorkflow('understand');

    previewStatus.textContent =
      'Mission creation failed';

    log(
      `Mission failed: ${error.message}`,
      'error',
    );

    addChatMessage(
      'agent',
      `I couldn't create the mission: ${error.message}`,
    );
  } finally {
    state.busy = false;

    buildBtn.disabled = false;

    buildBtn.querySelector(
      'span:first-child',
    ).textContent = 'Build';

    refreshStatus();
  }
}

async function refreshStatus() {
  try {
    const data = await getJson(
      '/api/builder/status',
    );

    state.runner = Boolean(
      data.runner,
    );

    connectionPill.className =
      `connection-pill ${
        state.runner
          ? 'online'
          : 'offline'
      }`;

    connectionText.textContent =
      state.runner
        ? 'Builder runner online'
        : 'Builder runner offline';

    runnerState.textContent =
      state.runner
        ? 'Online'
        : 'Offline';

    environmentDot.className =
      `environment-dot ${
        state.runner
          ? 'online'
          : 'offline'
      }`;

    workspacePath.textContent =
      data.workspace ||
      'Not connected';

    hardwareState.textContent =
      data.hardware ||
      'Unknown';
  } catch {
    state.runner = false;

    connectionPill.className =
      'connection-pill offline';

    connectionText.textContent =
      'Builder offline';

    runnerState.textContent =
      'Offline';

    environmentDot.className =
      'environment-dot offline';

    workspacePath.textContent =
      'Not connected';

    hardwareState.textContent =
      'Unavailable';
  }
}

$$('.nav-item').forEach((item) => {
  item.addEventListener(
    'click',
    () => setMode(item.dataset.mode),
  );
});

$$('.chip').forEach((item) => {
  item.addEventListener(
    'click',
    () => setMode(item.dataset.template),
  );
});

$$('.suggestion').forEach((item) => {
  item.addEventListener(
    'click',
    () => {
      promptInput.value =
        item.dataset.prompt;

      renderPreview(
        promptInput.value,
      );

      promptInput.focus();
    },
  );
});

buildBtn.addEventListener(
  'click',
  startBuild,
);

chatSendBtn.addEventListener(
  'click',
  sendChatMessage,
);

chatInput.addEventListener(
  'keydown',
  (event) => {
    if (
      (event.ctrlKey ||
        event.metaKey) &&
      event.key === 'Enter'
    ) {
      event.preventDefault();
      sendChatMessage();
    }
  },
);

promptInput.addEventListener(
  'input',
  () =>
    renderPreview(
      promptInput.value,
    ),
);

promptInput.addEventListener(
  'keydown',
  (event) => {
    if (
      (event.ctrlKey ||
        event.metaKey) &&
      event.key === 'Enter'
    ) {
      event.preventDefault();
      startBuild();
    }
  },
);

$('#refreshPreviewBtn').addEventListener(
  'click',
  () => {
    renderPreview(
      promptInput.value,
    );

    previewStatus.textContent =
      'Preview refreshed';

    log('Live preview refreshed.');
  },
);

$('#newProjectBtn').addEventListener(
  'click',
  () => {
    state.missionId = null;
    state.mission = null;

    promptInput.value = '';
    chatInput.value = '';

    projectName.textContent =
      'Untitled build';

    sideProjectTitle.textContent =
      'Untitled build';

    missionIdLabel.textContent =
      'No mission';

    missionIdSide.textContent =
      '—';

    missionState.textContent =
      'Idle';

    missionMode.textContent =
      'Anything';

    setJob('idle', 'IDLE');
    setMissionBadge(
      'idle',
      'IDLE',
    );

    previewStatus.textContent =
      'Waiting for a build';

    activityLog.innerHTML = '';

    chatMessages.innerHTML = `
      <div class="chat-message agent">
        <div class="message-label">KLIZONION</div>
        <div class="message-body">
          Tell me what you want to build. I'll turn it into an engineering mission.
        </div>
      </div>
    `;

    resetWorkflow();

    log(
      'New project workspace ready.',
    );

    renderPreview('');
  },
);

resetWorkflow();

renderPreview('');

log(
  'KLIZONION Builder Beta V0.2 ready.',
);

refreshStatus();

setInterval(
  refreshStatus,
  5000,
);