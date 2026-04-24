console.log('[UFC] service worker booted');

chrome.runtime.onInstalled.addListener(() => {
  console.log('[UFC] onInstalled');
});
