import { addQuestionsToDatabase } from '../database/db.js';
import { extractTestId } from './utils.js';

const SYNC_CONFIG_KEY = 'syncConfig';
const TESTS_STORAGE_KEY = 'testsStats';

export async function getSyncConfig() {
    const data = await chrome.storage.local.get([SYNC_CONFIG_KEY]);
    return data[SYNC_CONFIG_KEY] || null;
}

export async function saveSyncConfig(serverUrl, token) {
    const cleanUrl = serverUrl.trim().replace(/\/+$/, '');
    const config = {
        serverUrl: cleanUrl,
        token: token.trim(),
        lastSync: 0
    };
    await chrome.storage.local.set({ [SYNC_CONFIG_KEY]: config });
    return config;
}

export async function clearSyncConfig() {
    await chrome.storage.local.remove([SYNC_CONFIG_KEY, TESTS_STORAGE_KEY]);
}

export async function testServerConnection(serverUrl, token) {
    const cleanUrl = serverUrl.trim().replace(/\/+$/, '');
    const res = await fetch(`${cleanUrl}/api/ping`, {
        headers: { 'Authorization': `Bearer ${token.trim()}` }
    });

    if (res.status === 403) throw new Error('Невірний секретний токен (403)');
    if (!res.ok) throw new Error(`Сервер повернув помилку ${res.status}`);

    return await res.json();
}

export async function pullFromServer(forceFull = false) {
    const config = await getSyncConfig();
    if (!config?.serverUrl || !config?.token) return null;

    const since = forceFull ? 0 : (config.lastSync || 0);
    const res = await fetch(`${config.serverUrl}/api/db?since=${since}`, {
        headers: { 'Authorization': `Bearer ${config.token}` }
    });

    if (!res.ok) throw new Error(`Помилка завантаження: ${res.status}`);
    const { serverTime, items, tests } = await res.json();

    if (Array.isArray(items) && items.length > 0) {
        await addQuestionsToDatabase(items);
    }

    const storageUpdate = {
        [SYNC_CONFIG_KEY]: { ...config, lastSync: serverTime }
    };

    if (tests && typeof tests === 'object') {
        storageUpdate[TESTS_STORAGE_KEY] = tests;
    }

    await chrome.storage.local.set(storageUpdate);

    return items.length;
}

export async function pushToServer(items) {
    const config = await getSyncConfig();
    if (!config?.serverUrl || !config?.token || !Array.isArray(items) || !items.length) {
        return null;
    }

    const testId = extractTestId();

    const res = await fetch(`${config.serverUrl}/api/sync`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.token}`
        },
        body: JSON.stringify({ testId, items })
    });

    if (!res.ok) throw new Error(`Помилка відправки: ${res.status}`);
    const data = await res.json();

    if (data.tests && typeof data.tests === 'object') {
        await chrome.storage.local.set({ [TESTS_STORAGE_KEY]: data.tests });
    }

    return data;
}