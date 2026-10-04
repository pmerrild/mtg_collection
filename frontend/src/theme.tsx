import React, { useEffect, useState } from "react";
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
  return (
    <div className="theme-buttons" role="group" aria-label="Appearance">
      {(
        [
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
          { value: "system", label: "System" },
        ] as const
      ).map(({ value, label }) => (
        <button
          type="button"
          className={`theme-button ${mode === value ? "selected" : ""}`}
          key={value}
          aria-pressed={mode === value}
          onClick={() => setMode(value)}
        >
          <span>{label}</span>
        </button>
      ))}
    </div>
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
