/**
 * Ticket 35: appearance follows the iPhone's light or dark setting unless the owner picks one.
 * The choice is per device (kept in this browser only), so it never needs the network.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';
const key = 'fitness-insights-theme';

export function readTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(key);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch { return 'system'; }
}

export function applyTheme(choice: ThemeChoice) {
  if (choice === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
}

export function saveTheme(choice: ThemeChoice) {
  try { if (choice === 'system') localStorage.removeItem(key); else localStorage.setItem(key, choice); } catch { /* private mode: applies for this visit only */ }
  applyTheme(choice);
}
