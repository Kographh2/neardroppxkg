// Storage can be blocked or exhausted. A guest session should still work in memory.
export const preferences = {
  getItem(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  setItem(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* Optional persistence; current session state remains authoritative. */ } },
  removeItem(key: string): void { try { localStorage.removeItem(key); } catch { /* Cookie revocation still signs out the session. */ } }
};
