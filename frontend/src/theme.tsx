import React, { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
export type ThemeMode = "system" | "light" | "dark";
const key = "mtg-vault-theme";
function read(): ThemeMode {
  try {
    const v = localStorage.getItem(key);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}
function apply(mode: ThemeMode) {
  document.documentElement.dataset.theme =
    mode === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : mode;
}
export function useTheme() {
  const [mode, setRawMode] = useState<ThemeMode>(read);
  useEffect(() => {
    apply(mode);
    try {
      localStorage.setItem(key, mode);
    } catch {}
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      if (mode === "system") apply(mode);
    };
    const storage = (e: StorageEvent) => {
      if (e.key === key || e.key === null) setRawMode(read());
    };
    const sync = (e: Event) => setRawMode((e as CustomEvent<ThemeMode>).detail);
    window.addEventListener("mtg-theme-change", sync);
    media.addEventListener("change", update);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener("mtg-theme-change", sync);
      media.removeEventListener("change", update);
      window.removeEventListener("storage", storage);
    };
  }, [mode]);
  const setMode = (next: ThemeMode) => {
    setRawMode(next);
    window.dispatchEvent(new CustomEvent("mtg-theme-change", { detail: next }));
  };
  return { mode, setMode };
}
export function ThemeControl() {
  const { mode, setMode } = useTheme();
  const Icon = mode === "system" ? Monitor : mode === "dark" ? Moon : Sun;
  return (
    <label className="theme-control">
      <Icon size={17} aria-hidden="true" />
      <span className="sr-only">Appearance</span>
      <select
        aria-label="Appearance"
        value={mode}
        onChange={(e) => setMode(e.target.value as ThemeMode)}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
export function usePreference<T>(
  key: string,
  initial: T,
  validate: (value: unknown) => T,
) {
  const [value, setValue] = useState<T>(() => {
    try {
      return validate(JSON.parse(localStorage.getItem(key) || "null"));
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  return [value, setValue] as const;
}
