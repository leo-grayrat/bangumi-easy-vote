import { normalizeProjectRecord } from './model.js';

const DATABASE_NAME = 'bangumi-easy-vote';
const DATABASE_VERSION = 1;
const PROJECTS_STORE = 'projects';
const ASSETS_STORE = 'assets';
const ASSET_KINDS = new Set(['visual', 'infoCard']);

let fallbackAssetId = 0;

function requireNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }

  return value;
}

function operationError(action, error) {
  const detail = error?.message ? ` ${error.message}` : '';
  return new Error(`${action} failed.${detail}`, { cause: error });
}

function createAssetId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  fallbackAssetId += 1;
  return `asset-${Date.now().toString(36)}-${fallbackAssetId.toString(36)}`;
}

function runRequest(db, storeName, mode, action, makeRequest) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let result;
    let transaction;

    const fail = (error) => {
      if (!settled) {
        settled = true;
        reject(operationError(action, error));
      }
    };

    try {
      transaction = db.transaction(storeName, mode);
      const request = makeRequest(transaction.objectStore(storeName));

      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => fail(request.error);
      transaction.oncomplete = () => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };
      transaction.onerror = () => fail(transaction.error);
      transaction.onabort = () => fail(transaction.error ?? new Error('The transaction was aborted.'));
    } catch (error) {
      try {
        transaction?.abort();
      } catch {
        // The transaction may already be inactive after a synchronous request error.
      }
      fail(error);
    }
  });
}

function normalizeAssetDraft(asset) {
  if (!asset || typeof asset !== 'object') {
    throw new TypeError('asset must be an object.');
  }

  if (typeof globalThis.Blob !== 'function') {
    throw new Error('Blob is unavailable in this browser.');
  }
  if (!(asset.blob instanceof globalThis.Blob)) {
    throw new TypeError('asset.blob must be a Blob.');
  }
  if (!ASSET_KINDS.has(asset.kind)) {
    throw new TypeError('asset.kind must be either "visual" or "infoCard".');
  }

  return {
    id: asset.id === undefined ? createAssetId() : requireNonEmptyString(asset.id, 'asset.id'),
    animeEntryId: requireNonEmptyString(asset.animeEntryId, 'asset.animeEntryId'),
    kind: asset.kind,
    filename: requireNonEmptyString(asset.filename, 'asset.filename'),
    mimeType: requireNonEmptyString(asset.mimeType, 'asset.mimeType'),
    createdAt:
      asset.createdAt === undefined
        ? new Date().toISOString()
        : requireNonEmptyString(asset.createdAt, 'asset.createdAt'),
    blob: asset.blob,
  };
}

export class ProjectStore {
  #db;

  constructor(db) {
    this.#db = db;
  }

  async saveProject(project) {
    if (!project || typeof project !== 'object') {
      throw new TypeError('project must be an object.');
    }

    const record = normalizeProjectRecord(project);
    requireNonEmptyString(record.id, 'project.id');
    await runRequest(this.#db, PROJECTS_STORE, 'readwrite', 'Saving the project', (store) =>
      store.put(record),
    );
  }

  async loadProject(id) {
    const projectId = requireNonEmptyString(id, 'project id');
    const record = await runRequest(this.#db, PROJECTS_STORE, 'readonly', 'Loading the project', (store) =>
      store.get(projectId),
    );

    return record === undefined ? null : normalizeProjectRecord(record);
  }

  async listProjects() {
    const records = await runRequest(this.#db, PROJECTS_STORE, 'readonly', 'Listing projects', (store) =>
      store.getAll(),
    );

    return records.map((record) => normalizeProjectRecord(record));
  }

  async saveAsset(asset) {
    const record = normalizeAssetDraft(asset);
    await runRequest(this.#db, ASSETS_STORE, 'readwrite', 'Saving the asset', (store) =>
      store.put(record),
    );
    return record.id;
  }

  async loadAsset(id) {
    const assetId = requireNonEmptyString(id, 'asset id');
    const record = await runRequest(this.#db, ASSETS_STORE, 'readonly', 'Loading the asset', (store) =>
      store.get(assetId),
    );

    return record === undefined ? null : record;
  }

  async deleteAsset(id) {
    const assetId = requireNonEmptyString(id, 'asset id');
    await runRequest(this.#db, ASSETS_STORE, 'readwrite', 'Deleting the asset', (store) =>
      store.delete(assetId),
    );
  }
}

export function openProjectStore(indexedDBFactory = globalThis.indexedDB) {
  if (!indexedDBFactory || typeof indexedDBFactory.open !== 'function') {
    return Promise.reject(new Error('IndexedDB is unavailable in this browser.'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let request;

    const fail = (error) => {
      if (!settled) {
        settled = true;
        reject(operationError('Opening the project database', error));
      }
    };

    try {
      request = indexedDBFactory.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      fail(error);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(ASSETS_STORE)) {
        db.createObjectStore(ASSETS_STORE, { keyPath: 'id' });
      }
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () =>
      fail(new Error('Another page is blocking the project database upgrade.'));
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }

      settled = true;
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(new ProjectStore(db));
    };
  });
}

function normalizeChannelMessage(type, projectId) {
  const descriptor = typeof type === 'string' ? { type } : type;
  if (!descriptor || typeof descriptor !== 'object') {
    throw new TypeError('channel message type must be a string or message descriptor.');
  }

  if (descriptor.type === 'project-saved') {
    return { type: 'project-saved', projectId };
  }
  if (descriptor.type === 'asset-saved') {
    return {
      type: 'asset-saved',
      projectId,
      assetId: requireNonEmptyString(descriptor.assetId, 'assetId'),
    };
  }

  throw new TypeError('channel message type must be "project-saved" or "asset-saved".');
}

function isProjectMessage(message, projectId) {
  if (!message || typeof message !== 'object' || message.projectId !== projectId) {
    return false;
  }

  if (message.type === 'project-saved') {
    return Object.keys(message).length === 2;
  }

  return (
    message.type === 'asset-saved' &&
    typeof message.assetId === 'string' &&
    message.assetId.trim() !== '' &&
    Object.keys(message).length === 3
  );
}

export function createProjectChannel(projectId) {
  const normalizedProjectId = requireNonEmptyString(projectId, 'projectId');
  if (typeof globalThis.BroadcastChannel !== 'function') {
    throw new Error('BroadcastChannel is unavailable in this browser.');
  }

  const channel = new globalThis.BroadcastChannel(`bangumi-easy-vote:${normalizedProjectId}`);
  const listeners = new Set();
  let closed = false;

  channel.addEventListener('message', (event) => {
    if (!isProjectMessage(event.data, normalizedProjectId)) {
      return;
    }

    for (const listener of listeners) {
      listener(event.data);
    }
  });

  return {
    post(type) {
      if (closed) {
        throw new Error('The project channel is closed.');
      }
      channel.postMessage(normalizeChannelMessage(type, normalizedProjectId));
    },
    close() {
      if (!closed) {
        closed = true;
        listeners.clear();
        channel.close();
      }
    },
    subscribe(listener) {
      if (closed) {
        throw new Error('The project channel is closed.');
      }
      if (typeof listener !== 'function') {
        throw new TypeError('listener must be a function.');
      }

      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
