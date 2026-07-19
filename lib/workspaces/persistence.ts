import { workspaceArtifactSchema, type WorkspaceArtifactV2, type WorkspaceProject } from "./contracts";

const DB_NAME = "findex-generative-workspaces";
const DB_VERSION = 2;

type StateRecord = { id: string; projectId: string; key: string; value: unknown; updatedAt: string };

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
  });
}

async function openDatabase() {
  if (typeof indexedDB === "undefined") throw new Error("Workspace storage is unavailable in this browser.");
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains("projects")) database.createObjectStore("projects", { keyPath: "id" });
    if (!database.objectStoreNames.contains("artifacts")) {
      const store = database.createObjectStore("artifacts", { keyPath: "id" });
      store.createIndex("projectId", "projectId", { unique: false });
    }
    if (!database.objectStoreNames.contains("state")) {
      const store = database.createObjectStore("state", { keyPath: "id" });
      store.createIndex("projectId", "projectId", { unique: false });
    }
  };
  return requestResult(request);
}

export async function listWorkspaceProjects() {
  const database = await openDatabase();
  try {
    const projects = await requestResult(database.transaction("projects").objectStore("projects").getAll()) as WorkspaceProject[];
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } finally {
    database.close();
  }
}

export async function getWorkspaceArtifact(id: string) {
  const database = await openDatabase();
  try {
    const stored = await requestResult(database.transaction("artifacts").objectStore("artifacts").get(id));
    const parsed = workspaceArtifactSchema.safeParse(stored);
    return parsed.success ? parsed.data : undefined;
  } finally {
    database.close();
  }
}

export async function listWorkspaceVersions(projectId: string) {
  const database = await openDatabase();
  try {
    const index = database.transaction("artifacts").objectStore("artifacts").index("projectId");
    const stored = await requestResult(index.getAll(projectId));
    const artifacts = stored.flatMap((item) => {
      const parsed = workspaceArtifactSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
    return artifacts.sort((a, b) => b.version - a.version);
  } finally {
    database.close();
  }
}

export async function saveWorkspaceArtifact(artifact: WorkspaceArtifactV2, projectName = artifact.title) {
  workspaceArtifactSchema.parse(artifact);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(["projects", "artifacts"], "readwrite");
    const projectStore = transaction.objectStore("projects");
    const existing = await requestResult(projectStore.get(artifact.projectId)) as WorkspaceProject | undefined;
    const now = new Date().toISOString();
    projectStore.put({
      id: artifact.projectId,
      name: existing?.name ?? projectName,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      activeVersionId: artifact.id,
    } satisfies WorkspaceProject);
    transaction.objectStore("artifacts").add(artifact);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function renameWorkspaceProject(projectId: string, name: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("projects", "readwrite");
    const store = transaction.objectStore("projects");
    const project = await requestResult(store.get(projectId)) as WorkspaceProject | undefined;
    if (project) store.put({ ...project, name: name.trim().slice(0, 80), updatedAt: new Date().toISOString() });
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function deleteWorkspaceProject(projectId: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(["projects", "artifacts", "state"], "readwrite");
    transaction.objectStore("projects").delete(projectId);
    for (const storeName of ["artifacts", "state"] as const) {
      const index = transaction.objectStore(storeName).index("projectId");
      const keys = await requestResult(index.getAllKeys(projectId));
      for (const key of keys) transaction.objectStore(storeName).delete(key);
    }
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function readWorkspaceState(projectId: string, key: string) {
  const database = await openDatabase();
  try {
    const record = await requestResult(database.transaction("state").objectStore("state").get(`${projectId}:${key}`)) as StateRecord | undefined;
    return record ? { found: true, value: record.value } : { found: false, value: null };
  } finally {
    database.close();
  }
}

export async function writeWorkspaceState(projectId: string, key: string, value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized.length > 65_536) throw new Error("Workspace state values are limited to 64 KB.");
  const database = await openDatabase();
  try {
    const transaction = database.transaction("state", "readwrite");
    transaction.objectStore("state").put({
      id: `${projectId}:${key}`,
      projectId,
      key,
      value,
      updatedAt: new Date().toISOString(),
    } satisfies StateRecord);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function workspaceStorageUsage() {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate();
  return estimate.quota && estimate.usage ? estimate.usage / estimate.quota : 0;
}
