const $ui = (s) => document.querySelector(s);
const $$ui = (s) => [...document.querySelectorAll(s)];

function activateWorkspaceTab(tab) {
  $$ui('[data-workspace-tab]').forEach((item) => item.classList.toggle('active', item.dataset.workspaceTab === tab));
  $$ui('.workspace-tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.workspacePanel === tab));
}

$$ui('[data-workspace-tab]').forEach((item) => {
  item.addEventListener('click', () => activateWorkspaceTab(item.dataset.workspaceTab));
});

$ui('[data-open-account]')?.addEventListener('click', () => $ui('#authModalBtn')?.click());

$$ui('[data-new-project]').forEach((button) => {
  button.addEventListener('click', () => $ui('#newProjectBtn')?.click());
});

const prompt = $ui('#promptInput');
const hiddenChat = $ui('#chatInput');
const mainSend = $ui('#mainChatSendBtn');
const legacySend = $ui('#chatSendBtn');

function sendMainChat() {
  if (!prompt || !hiddenChat || !legacySend) return;
  const text = prompt.value.trim();
  if (!text) return;
  hiddenChat.value = text;
  prompt.value = '';
  prompt.style.height = 'auto';
  legacySend.click();
}

mainSend?.addEventListener('click', sendMainChat);
prompt?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey) return;
  if (event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  sendMainChat();
});
prompt?.addEventListener('input', () => {
  prompt.style.height = 'auto';
  prompt.style.height = `${Math.min(prompt.scrollHeight, 180)}px`;
});

$$ui('.claude-mode-pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    $$('.claude-mode-pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    const template = pill.dataset.template;
    $ui('.chip[data-template="' + template + '"]')?.click();
  });
});

// Mirror canonical auth/status values into the Claude-style shell without changing auth logic.
function mirrorRuntimeUI() {
  const name = $ui('#authBtnText')?.textContent?.trim();
  const email = $ui('#sideEmail')?.textContent?.trim();
  const connection = $ui('#connectionText')?.textContent?.trim();
  if (name) $ui('.account-name') && ($ui('.account-name').textContent = name);
  if (email) $ui('#sidebarEmail') && ($ui('#sidebarEmail').textContent = email);
  if (connection) $ui('#dashboardConnectionText') && ($ui('#dashboardConnectionText').textContent = connection);
}

setInterval(mirrorRuntimeUI, 1000);
mirrorRuntimeUI();

console.info('KLIZONION Claude-style workspace UI initialized.');
