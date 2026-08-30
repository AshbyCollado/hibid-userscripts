import { envelope, type MessageResponse } from './messages.js';

export function runtimeMessage<T>(type: string, payload: unknown): Promise<T> {
  const message = envelope(type, payload);
  return new Promise<T>((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: MessageResponse<T> | undefined) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error?.message || 'Flippah message failed'));
        return;
      }
      resolve(response.data);
    });
  });
}

export function tabMessage<T>(tabId: number, type: string, payload: unknown): Promise<T> {
  const message = envelope(type, payload);
  return new Promise<T>((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: MessageResponse<T> | undefined) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error?.message || 'Flippah tab message failed'));
        return;
      }
      resolve(response.data);
    });
  });
}

export function getSyncStorage(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(null, (items) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(items);
    });
  });
}

export function setSyncStorage(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(items, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

export function activeTab(): Promise<chrome.tabs.Tab | null> {
  const query = (queryInfo: chrome.tabs.QueryInfo) => new Promise<chrome.tabs.Tab[]>((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tabs || []);
    });
  });
  return (async () => {
    for (const queryInfo of [
      { active: true, currentWindow: true },
      { active: true, lastFocusedWindow: true },
      { active: true }
    ] satisfies chrome.tabs.QueryInfo[]) {
      const tabs = await query(queryInfo);
      const supported = tabs.find((tab) => /^(?:https:\/\/)?(?:[^/]+\.)?hibid\.com\//i.test(String(tab.url || '')));
      if (supported) return supported;
      const webTab = tabs.find((tab) => /^https?:\/\//i.test(String(tab.url || '')));
      if (webTab) return webTab;
    }
    const supported = (await query({}))
      .filter((tab) => /^(?:https:\/\/)?(?:[^/]+\.)?hibid\.com\//i.test(String(tab.url || '')))
      .sort((left, right) => Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0));
    if (supported[0]) return supported[0];
    return null;
  })();
}
