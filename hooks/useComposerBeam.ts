import { useSyncExternalStore } from "react";

export const COMPOSER_BEAM_STORAGE_KEY = "pi-composer-beam";
export const COMPOSER_BEAM_DEFAULT = true;

function readStoredEnabled(): boolean {
  try {
    const raw = window.localStorage.getItem(COMPOSER_BEAM_STORAGE_KEY);
    return raw === null ? COMPOSER_BEAM_DEFAULT : raw === "true";
  } catch {
    return COMPOSER_BEAM_DEFAULT;
  }
}

let enabled: boolean | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): boolean {
  if (enabled === null) enabled = readStoredEnabled();
  return enabled;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setComposerBeamEnabled(next: boolean): void {
  enabled = next;
  try {
    window.localStorage.setItem(COMPOSER_BEAM_STORAGE_KEY, String(next));
  } catch {}
  listeners.forEach((listener) => listener());
}

export function useComposerBeam(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => COMPOSER_BEAM_DEFAULT);
}
