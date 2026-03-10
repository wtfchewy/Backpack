importScripts('firestore.js');

// External messages from the web app (via externally_connectable)
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'BACKPACK_AUTH') {
    chrome.storage.local.set(
      {
        user_token: msg.token,
        user_refresh_token: msg.refreshToken || '',
        user_id: msg.userId,
        user_display_name: msg.displayName || '',
        user_photo: msg.photo || '',
        firebase_config: msg.config,
      },
      () => {
        sendResponse({ success: true });
      }
    );
    return true;
  }

  if (msg.type === 'BACKPACK_PING') {
    sendResponse({ success: true });
    return false;
  }

  sendResponse({ success: false });
  return false;
});

// Internal message handlers (popup, content scripts)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CLEAR_AUTH') {
    chrome.storage.local.remove(
      ['user_token', 'user_refresh_token', 'user_id', 'user_display_name', 'user_photo', 'firebase_config'],
      () => {
        sendResponse({ success: true });
      }
    );
    return true;
  }

  if (msg.type === 'SAVE_COMPONENT') {
    saveComponent(msg.component).then((ok) => {
      sendResponse({ success: ok });
    });
    return true;
  }

  if (msg.type === 'GET_PACKS') {
    getPacks().then((packs) => {
      sendResponse(packs);
    });
    return true;
  }

  if (msg.type === 'SAVE_PACK') {
    savePack(msg.pack).then((ok) => {
      sendResponse({ success: ok });
    });
    return true;
  }

  if (msg.type === 'DELETE_PACK') {
    deletePack(msg.packId).then((ok) => {
      sendResponse({ success: ok });
    });
    return true;
  }

  if (msg.type === 'GET_COMPONENTS') {
    getComponents(msg.packId).then((components) => {
      sendResponse(components);
    });
    return true;
  }

  if (msg.type === 'START_PICKER') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0]) {
        const tabId = tabs[0].id;
        try {
          await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
          await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
        } catch {
          // Already injected or restricted page
        }
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, { type: 'ACTIVATE_PICKER', packId: msg.packId });
        }, 100);
      }
      sendResponse({ success: true });
    });
    return true;
  }

  if (msg.type === 'GET_AUTH') {
    chrome.storage.local.get(['user_id', 'user_token'], (result) => {
      sendResponse({ userId: result.user_id, token: result.user_token });
    });
    return true;
  }

  sendResponse({ success: false });
  return false;
});
