// Background service worker - Compilatore (Universale)
// L'estensione NON ha content_scripts auto-load: il widget viene iniettato
// SOLO quando l'utente clicca l'icona dell'estensione in toolbar.

const OPENAI_BASE = 'https://api.openai.com/v1';

// Tab in cui il widget è già stato iniettato (per fare toggle invece di re-inject)
const _injectedTabs = new Set();

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Compilatore Universale] Installato. Click sull\'icona per attivarlo su una pagina.');
});

// Reset stato quando una tab si chiude o naviga
chrome.tabs.onRemoved.addListener((tabId) => _injectedTabs.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') _injectedTabs.delete(tabId);
});

// Click sull'icona toolbar → inietta (o toggle se già iniettato)
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id || !tab.url) return;
  if (!/^https?:\/\//i.test(tab.url)) {
    console.warn('[Compilatore Universale] Pagine interne del browser non supportate.');
    return;
  }

  if (_injectedTabs.has(tab.id)) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_WIDGET' });
    } catch (e) {
      // Tab ricaricata: re-inject
      _injectedTabs.delete(tab.id);
      await injectWidget(tab.id);
      _injectedTabs.add(tab.id);
    }
    return;
  }

  await injectWidget(tab.id);
  _injectedTabs.add(tab.id);
});

async function injectWidget(tabId) {
  try {
    // 1) Bridge nel MAIN world
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      files: ['content/page-bridge.js']
    });
    // 2) CSS wrapper
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content/widget.css']
    });
    // 3) libs + content script (isolated world)
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      files: [
        'lib/pdf.min.js',
        'lib/mammoth.browser.min.js',
        'content/content.js'
      ]
    });
  } catch (err) {
    console.error('[Compilatore Universale] Inject fallita:', err);
  }
}

// Router messaggi
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'OPENAI_CHAT') {
    handleOpenAI(msg.payload).then(sendResponse).catch((err) => {
      sendResponse({ error: err.message || String(err) });
    });
    return true;
  }
  if (msg?.type === 'GET_SETTINGS') {
    chrome.storage.sync.get(['apiKey', 'model'], (data) => {
      sendResponse({
        apiKey: data.apiKey || '',
        model: data.model || 'gpt-4.1'
      });
    });
    return true;
  }
});

async function handleOpenAI({ messages, model, response_format, temperature }) {
  const { apiKey } = await chrome.storage.sync.get(['apiKey']);
  if (!apiKey) {
    throw new Error('API Key OpenAI non configurata. Apri le Impostazioni.');
  }

  const body = {
    model: model || 'gpt-4.1',
    messages,
    temperature: temperature ?? 0.1
  };
  if (response_format) body.response_format = response_format;

  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { parsed = { error: { message: text } }; }
    throw new Error(`OpenAI ${res.status}: ${parsed?.error?.message || text}`);
  }

  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content || '',
    usage: data.usage,
    model: data.model
  };
}
