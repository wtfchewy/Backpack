// Firestore REST API client for the extension
// Reads auth credentials from chrome.storage on every call (survives service worker restarts)

function getAuth() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['user_token', 'user_refresh_token', 'user_id', 'firebase_config'], (result) => {
      if (result.user_token && result.user_id && result.firebase_config) {
        resolve(result);
      } else {
        resolve(null);
      }
    });
  });
}

// Refresh the Firebase ID token using the refresh token
async function refreshToken(auth) {
  if (!auth.user_refresh_token || !auth.firebase_config?.apiKey) {
    return null;
  }

  try {
    const res = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${auth.firebase_config.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${auth.user_refresh_token}`,
      }
    );

    if (!res.ok) return null;

    const data = await res.json();
    const newToken = data.id_token;
    const newRefreshToken = data.refresh_token;

    if (!newToken) return null;

    // Persist the new tokens
    await new Promise((resolve) => {
      chrome.storage.local.set(
        {
          user_token: newToken,
          user_refresh_token: newRefreshToken || auth.user_refresh_token,
        },
        resolve
      );
    });

    return newToken;
  } catch (e) {
    console.error('[Backpack] Token refresh failed:', e);
    return null;
  }
}

function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') return { integerValue: String(val) };
  if (typeof val === 'string') return { stringValue: val };
  return { stringValue: String(val) };
}

function fromFirestoreValue(val) {
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return val.doubleValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  return null;
}

function toFirestoreDoc(obj) {
  const fields = {};
  for (const [key, val] of Object.entries(obj)) {
    if (key === 'id') continue;
    fields[key] = toFirestoreValue(val);
  }
  return { fields };
}

function fromFirestoreDoc(doc) {
  const result = {};
  if (!doc.fields) return result;
  for (const [key, val] of Object.entries(doc.fields)) {
    result[key] = fromFirestoreValue(val);
  }
  return result;
}

async function firestoreRequest(method, path, body = null) {
  const auth = await getAuth();
  if (!auth) {
    console.warn('[Backpack] No auth credentials for Firestore');
    return null;
  }

  const base = `https://firestore.googleapis.com/v1/projects/${auth.firebase_config.projectId}/databases/(default)/documents`;
  const url = `${base}/${path}`;

  function buildOpts(token) {
    const opts = {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) opts.body = JSON.stringify(body);
    return opts;
  }

  try {
    let res = await fetch(url, buildOpts(auth.user_token));

    // If unauthorized, try refreshing the token once
    if (res.status === 401) {
      const newToken = await refreshToken(auth);
      if (newToken) {
        res = await fetch(url, buildOpts(newToken));
      }
    }

    if (!res.ok) {
      const err = await res.text();
      console.error(`[Backpack] Firestore ${method} ${path} failed:`, res.status, err);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error(`[Backpack] Firestore request error:`, e);
    return null;
  }
}

// --- PACKS ---

async function savePack(pack) {
  const auth = await getAuth();
  if (!auth) return false;
  const path = `users/${auth.user_id}/packs/${pack.id}`;
  const result = await firestoreRequest('PATCH', path, toFirestoreDoc(pack));
  return result !== null;
}

async function getPacks() {
  const auth = await getAuth();
  if (!auth) return [];
  const path = `users/${auth.user_id}/packs`;
  const result = await firestoreRequest('GET', path);
  if (!result || !result.documents) return [];
  return result.documents.map((doc) => {
    const id = doc.name.split('/').pop();
    return { id, ...fromFirestoreDoc(doc) };
  });
}

async function deletePack(packId) {
  const auth = await getAuth();
  if (!auth) return false;

  // Delete components in this pack first
  const comps = await getComponents(packId);
  for (const comp of comps) {
    await deleteComponent(comp.id);
  }

  const path = `users/${auth.user_id}/packs/${packId}`;
  await firestoreRequest('DELETE', path);
  return true;
}

// --- COMPONENTS ---

async function saveComponent(component) {
  const auth = await getAuth();
  if (!auth) return false;
  const path = `users/${auth.user_id}/components/${component.id}`;
  const result = await firestoreRequest('PATCH', path, toFirestoreDoc(component));
  return result !== null;
}

async function getComponents(packId) {
  const auth = await getAuth();
  if (!auth) return [];

  // Use structured query to filter by packId
  const parent = `projects/${auth.firebase_config.projectId}/databases/(default)/documents/users/${auth.user_id}`;
  const url = `https://firestore.googleapis.com/v1/${parent}:runQuery`;

  const queryBody = {
    structuredQuery: {
      from: [{ collectionId: 'components' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'packId' },
          op: 'EQUAL',
          value: { stringValue: packId },
        },
      },
    },
  };

  function buildOpts(token) {
    return {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(queryBody),
    };
  }

  try {
    let res = await fetch(url, buildOpts(auth.user_token));

    // If unauthorized, try refreshing the token once
    if (res.status === 401) {
      const newToken = await refreshToken(auth);
      if (newToken) {
        res = await fetch(url, buildOpts(newToken));
      }
    }

    if (!res.ok) return [];
    const results = await res.json();

    return results
      .filter((r) => r.document)
      .map((r) => {
        const id = r.document.name.split('/').pop();
        return { id, ...fromFirestoreDoc(r.document) };
      });
  } catch {
    return [];
  }
}

async function deleteComponent(componentId) {
  const auth = await getAuth();
  if (!auth) return false;
  const path = `users/${auth.user_id}/components/${componentId}`;
  await firestoreRequest('DELETE', path);
  return true;
}
