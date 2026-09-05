export interface VersionedSave {
  version: number;
  savedAt: number;
}

export function writeSave<T extends VersionedSave>(key: string, data: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function readSave<T extends VersionedSave>(key: string, version: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<T>;
    if (parsed.version !== version || typeof parsed.savedAt !== "number") return null;
    return parsed as T;
  } catch {
    return null;
  }
}

export function removeSave(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
