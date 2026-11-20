// App state comes from the API server (server/index.js). Transactions change only on the
// server; partner, mapping and settings edits apply here at once and are saved shortly after.
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';

const ENV_KEY = 'good-enough-edi:env';
const POLL_MS = 2000;
const SAVE_DELAY_MS = 400;
const CONFIG_ACTIONS = new Set(['addPartner', 'updatePartner', 'updateMapping', 'updateSettings']);

function savedEnv() {
  try {
    return localStorage.getItem(ENV_KEY) || 'production';
  } catch {
    return 'production';
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
  return data;
}

function reducer(state, action) {
  switch (action.type) {
    case 'load':
      return { ...action.data, env: state?.env ?? savedEnv() };
    case 'setEnv':
      return { ...state, env: action.env };
    case 'addPartner':
      return { ...state, partners: [...state.partners, action.partner] };
    case 'updatePartner':
      return { ...state, partners: state.partners.map((p) => (p.id === action.id ? action.fn(p) : p)) };
    case 'updateMapping':
      return {
        ...state,
        mappings: state.mappings.map((m) => {
          if (m.id !== action.id) return m;
          const next = action.fn(m);
          // Editing a live mapping starts a new draft version.
          if (action.edit && m.status === 'Live') return { ...next, status: 'Draft', version: m.version + 1 };
          return next;
        }),
      };
    case 'updateSettings':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    default:
      return state;
  }
}

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [state, baseDispatch] = useReducer(reducer, null);
  const [offline, setOffline] = useState(false);
  const [toast, setToast] = useState(null);
  const version = useRef(0);
  const seenIds = useRef(null);
  const dirty = useRef(false);
  const saving = useRef(null);
  const saveTimer = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const notify = useCallback((text, tone = 'ok') => setToast({ text, tone, key: Date.now() }), []);

  const refresh = useCallback(async () => {
    const data = await api('/state');
    version.current = data.version;
    // Point out files that arrived through the inbox folders since the last look.
    if (seenIds.current) {
      const fresh = data.transactions.filter((t) => !seenIds.current.has(t.id) && t.via === 'Folder' && t.dir === 'in');
      if (fresh.length) {
        const bad = fresh.filter((t) => t.errors.length).length;
        notify(`${fresh.length} new file${fresh.length > 1 ? 's' : ''} from the inbox${bad ? `, ${bad} failed validation` : ''}.`, bad ? 'bad' : 'ok');
      }
    }
    seenIds.current = new Set(data.transactions.map((t) => t.id));
    baseDispatch({ type: 'load', data });
    setOffline(false);
  }, [notify]);

  const saveConfig = useCallback(async () => {
    clearTimeout(saveTimer.current);
    if (!dirty.current) return saving.current;
    dirty.current = false;
    const { partners, guidelines, mappings, settings } = stateRef.current;
    saving.current = api('/config', { method: 'PUT', body: { partners, guidelines, mappings, settings } })
      .then((r) => { version.current = r.version; })
      .catch(() => { dirty.current = true; setOffline(true); })
      .finally(() => { saving.current = null; });
    return saving.current;
  }, []);

  const dispatch = useCallback((action) => {
    baseDispatch(action);
    if (action.type === 'setEnv') {
      try { localStorage.setItem(ENV_KEY, action.env); } catch { /* not remembered; fine */ }
    }
    if (CONFIG_ACTIONS.has(action.type)) {
      dirty.current = true;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(saveConfig, SAVE_DELAY_MS);
    }
  }, [saveConfig]);

  useEffect(() => {
    refresh().catch(() => setOffline(true));
    const poll = setInterval(async () => {
      if (dirty.current || saving.current) return; // don't overwrite edits that haven't saved yet
      try {
        const r = await api('/version');
        if (r.version !== version.current) await refresh();
        else setOffline(false);
      } catch {
        setOffline(true);
      }
    }, POLL_MS);
    return () => clearInterval(poll);
  }, [refresh]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Server actions save any pending edits first, then reload the latest data.
  const run = useCallback(async (path, body) => {
    await saveConfig();
    const result = await api(path, { method: 'POST', body });
    await refresh();
    return result;
  }, [saveConfig, refresh]);

  const actions = useMemo(() => ({
    reprocess: (id) => run(`/transactions/${id}/reprocess`),
    resolve: (id) => run(`/transactions/${id}/resolve`),
    resend: (id) => run(`/transactions/${id}/resend`),
    sendTest: (partnerId) => run(`/partners/${partnerId}/send-test`),
    reset: () => run('/reset'),
    uploadFile: async (raw) => {
      try {
        return await run('/upload', { raw });
      } catch (err) {
        return { error: err.message };
      }
    },
  }), [run]);

  const value = useMemo(() => ({ state, dispatch, toast, notify, actions, offline }), [state, dispatch, toast, notify, actions, offline]);

  if (!state) {
    return (
      <div className="boot">
        {offline ? (
          <>
            <h1>Can’t reach the Good Enough EDI server</h1>
            <p>Start it with <code className="mono">npm run dev</code> in the project folder. This page will connect on its own once it’s running.</p>
          </>
        ) : (
          <p>Loading…</p>
        )}
      </div>
    );
  }
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  return useContext(StoreContext);
}
