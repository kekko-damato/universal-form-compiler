const statusEl = document.getElementById('status');

// Schema URL su cui l'estensione NON viene iniettata (chrome://, about:, file://)
function isInjectable(url) {
  if (!url) return false;
  return /^https?:\/\//i.test(url);
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const canInject = isInjectable(tab?.url);

  const { apiKey } = await chrome.storage.sync.get(['apiKey']);
  if (!apiKey) {
    statusEl.className = 'status warn';
    statusEl.textContent = '⚠ API key OpenAI non configurata. Aprila dalle impostazioni del widget.';
  } else if (!canInject) {
    statusEl.className = 'status warn';
    statusEl.textContent = "Pagina interna del browser. Apri un sito web normale per usare il widget.";
  } else {
    statusEl.className = 'status ok';
    statusEl.textContent = '✓ Pronto. Funziona su qualsiasi sito.';
  }

  const sendToggle = async (showSettings = false) => {
    if (!canInject) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_WIDGET', showSettings });
      window.close();
    } catch (e) {
      statusEl.className = 'status warn';
      statusEl.textContent = 'Ricarica la pagina (F5) per attivare il widget.';
    }
  };

  document.getElementById('toggle').addEventListener('click', () => sendToggle(false));
  document.getElementById('options').addEventListener('click', () => sendToggle(true));
}

init();
