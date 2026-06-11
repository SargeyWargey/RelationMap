"use client";

import { createContext, useContext, useState, useEffect } from "react";

type ThemeContextType = {
  darkMode: boolean;
  toggleDarkMode: () => void;
};

const ThemeContext = createContext<ThemeContextType>({
  darkMode: false,
  toggleDarkMode: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // null = not yet adopted from the DOM. The inline <head> script in
  // app/layout.tsx sets data-theme before first paint using the same
  // key/values (localStorage "theme" = "dark" | "light"); we adopt its
  // result on mount instead of guessing, so there is no flash.
  const [darkMode, setDarkMode] = useState<boolean | null>(null);

  // Adopt the theme the inline script already applied.
  useEffect(() => {
    setDarkMode(document.documentElement.getAttribute("data-theme") === "dark");
  }, []);

  // Keep the theme in sync across tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "theme" && (e.newValue === "dark" || e.newValue === "light")) {
        setDarkMode(e.newValue === "dark");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Write the theme out only once it has been adopted (or toggled) —
  // never clobber the pre-paint attribute with a default value.
  useEffect(() => {
    if (darkMode === null) return;
    const next = darkMode ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // localStorage unavailable (private mode, etc.) — attribute still set.
    }
  }, [darkMode]);

  return (
    <ThemeContext.Provider
      value={{
        darkMode: darkMode ?? false,
        toggleDarkMode: () => setDarkMode((d) => !(d ?? false)),
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
