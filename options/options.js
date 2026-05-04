const $ = (id) => document.getElementById(id);
const apiKeyInput = $('apiKey');
const modelSelect = $('model');
const statusEl    = $('status');

function setStatus(msg, level = 'info') {
  statusEl.textContent = msg;
  statusEl.className = `status ${level}`;
}

function load() {
  chrome.storage.sync.get(['apiKey', 'model'], (data) => {
    apiKeyInput.value = data.apiKey || '';
    modelSelect.value = data.model || 'gpt-4o';
  });
}

$('saveKey').addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (!key.startsWith('sk-')) {
    setStatus('La API key deve iniziare con "sk-".', 'err');
    return;
  }
  chrome.storage.sync.set({ apiKey: key }, () => {
    setStatus('✓ API key salvata.', 'ok');
  });
});

$('toggleVisibility').addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
});

$('testKey').addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) { setStatus('Inserisci prima la API key.', 'err'); return; }
  setStatus('Test in corso…', 'info');
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    setStatus(`✓ Connessione OK — ${data?.data?.length || 0} modelli disponibili.`, 'ok');
  } catch (err) {
    setStatus(`✗ Errore: ${err.message}`, 'err');
  }
});

modelSelect.addEventListener('change', () => {
  chrome.storage.sync.set({ model: modelSelect.value }, () => {
    setStatus(`✓ Modello impostato su ${modelSelect.value}.`, 'ok');
  });
});

load();
