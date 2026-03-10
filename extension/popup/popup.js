const WEB_URL = 'http://localhost:5173';

let selectedPackId = null;

const authSection = document.getElementById('authSection');
const mainSection = document.getElementById('mainSection');

function checkAuth() {
  chrome.storage.local.get(
    ['user_id', 'user_token', 'firebase_config', 'user_display_name', 'user_photo'],
    (result) => {
      if (chrome.runtime.lastError) return;
      if (result && result.user_id && result.user_token && result.firebase_config) {
        showMainSection(result);
      } else {
        authSection.classList.remove('hidden');
        mainSection.classList.add('hidden');
      }
    }
  );
}

checkAuth();

function showMainSection(stored) {
  authSection.classList.add('hidden');
  mainSection.classList.remove('hidden');

  const userName = document.getElementById('userName');
  const userAvatar = document.getElementById('userAvatar');

  if (userName) userName.textContent = stored.user_display_name || 'Connected';
  if (userAvatar) {
    if (stored.user_photo) {
      userAvatar.innerHTML = `<img src="${stored.user_photo}" alt="" referrerpolicy="no-referrer" />`;
    } else {
      userAvatar.textContent = (stored.user_display_name || '?')[0];
    }
  }

  render();
}

document.getElementById('btnConnect').addEventListener('click', () => {
  chrome.tabs.create({ url: `${WEB_URL}/extension-auth` });
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.user_id || changes.user_token) {
    checkAuth();
  }
});

document.getElementById('btnDisconnect').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_AUTH' }, () => {
    if (chrome.runtime.lastError) { /* ignore */ }
    authSection.classList.remove('hidden');
    mainSection.classList.add('hidden');
  });
});

// Render packs from Firestore
function render() {
  chrome.runtime.sendMessage({ type: 'GET_PACKS' }, (packs) => {
    if (chrome.runtime.lastError || !packs) packs = [];

    const packList = document.getElementById('packList');
    const btnPick = document.getElementById('btnPick');

    if (!packList || !btnPick) return;

    if (packs.length === 0) {
      packList.innerHTML = '<div class="empty-state">No packs yet<br/>Create one to get started</div>';
      btnPick.disabled = true;
      return;
    }

    // Auto-select first pack if none selected
    if (!selectedPackId) {
      selectedPackId = packs[0].id;
    }

    packList.innerHTML = packs
      .map((pack) => {
        const isActive = selectedPackId === pack.id;
        return `
          <div class="pack-item ${isActive ? 'active' : ''}" data-id="${pack.id}">
            <div class="pack-item-left">
              <span class="pack-name">${pack.name}</span>
            </div>
            <div style="display:flex;align-items:center;gap:4px">
              <svg class="pack-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <button class="pack-delete" data-delete="${pack.id}">&times;</button>
            </div>
          </div>
        `;
      })
      .join('');

    document.querySelectorAll('.pack-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.pack-delete')) return;
        selectedPackId = el.dataset.id;
        btnPick.disabled = false;
        render();
      });
    });

    document.querySelectorAll('.pack-delete').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.delete;
        chrome.runtime.sendMessage({ type: 'DELETE_PACK', packId: id }, () => {
          if (chrome.runtime.lastError) { /* ignore */ }
          if (selectedPackId === id) selectedPackId = null;
          render();
        });
      });
    });

    btnPick.disabled = !selectedPackId;
  });
}

// New Pack
document.getElementById('btnNewPack').addEventListener('click', () => {
  document.getElementById('newPackForm').classList.remove('hidden');
  document.getElementById('newPackName').focus();
});

document.getElementById('btnCancelPack').addEventListener('click', () => {
  document.getElementById('newPackForm').classList.add('hidden');
  document.getElementById('newPackName').value = '';
});

document.getElementById('btnCreatePack').addEventListener('click', () => {
  const nameInput = document.getElementById('newPackName');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) return;

  const pack = {
    id: crypto.randomUUID(),
    name,
    description: '',
    createdAt: Date.now(),
  };

  chrome.runtime.sendMessage({ type: 'SAVE_PACK', pack }, () => {
    if (chrome.runtime.lastError) { /* ignore */ }
    document.getElementById('newPackForm').classList.add('hidden');
    if (nameInput) nameInput.value = '';
    selectedPackId = pack.id;
    render();
  });
});

document.getElementById('newPackName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btnCreatePack').click();
  if (e.key === 'Escape') document.getElementById('btnCancelPack').click();
});

// Pick button
document.getElementById('btnPick').addEventListener('click', () => {
  if (!selectedPackId) return;
  chrome.runtime.sendMessage({ type: 'START_PICKER', packId: selectedPackId }, () => {
    if (chrome.runtime.lastError) { /* ignore */ }
  });
  window.close();
});
