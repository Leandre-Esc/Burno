import { AlertTriangle, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { sendHttp, type WireRequest } from "./api";
import logo from "./assets/logo.png";
import { rootOf, useCollections } from "./collections";
import { useEnvironments } from "./environments";
import { fun } from "./fun";
import { interpolate, scopeVars } from "./interpolate";
import { ensureToken } from "./oauth2";
import { isMac } from "./platform";
import { prepareRequest } from "./prepare";
import { slime } from "./sounds";
import { loadSounds, loadSplit, loadTheme, saveSounds, saveSplit, saveTheme } from "./storage";
import type { HttpResponse } from "./types";
import { Sidebar } from "./components/Sidebar";
import { RequestBar } from "./components/RequestBar";
import { RequestEditor } from "./components/RequestEditor";
import { ResponseViewer } from "./components/ResponseViewer";
import { EnvironmentModal, type EnvTab } from "./components/EnvironmentModal";
import { ScopeContext } from "./components/VarInput";
import { BurnedOverlay, type Burn } from "./components/BurnedOverlay";

if (isMac) document.documentElement.classList.add("platform-mac");

function App() {
  const collections = useCollections();
  const { active, activeId, updateRequest } = collections;
  const envs = useEnvironments(collections.collections, collections.report);
  const [envModal, setEnvModal] = useState<EnvTab | null>(null);
  const [theme, setTheme] = useState(loadTheme);
  const [split, setSplit] = useState(loadSplit);
  const [sounds, setSounds] = useState(loadSounds);
  const [response, setResponse] = useState<HttpResponse | null>(null);
  const [sent, setSent] = useState<WireRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [burn, setBurn] = useState<Burn | null>(null);
  const closeBurn = useCallback(() => setBurn(null), []);
  const closeEnvModal = useCallback(() => setEnvModal(null), []);
  const workspace = useRef<HTMLDivElement>(null);
  const noRequestLine = useMemo(fun.noRequest, [activeId]);

  useEffect(() => saveSplit(split), [split]);
  useEffect(() => saveSounds(sounds), [sounds]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  // The response panel belongs to the selected request
  useEffect(() => {
    setResponse(null);
    setSent(null);
    setError(null);
  }, [activeId]);

  // Environments follow the collection of the open request
  const root = activeId ? rootOf(activeId) : (collections.collections[0]?.root ?? null);
  const scope = envs.scopeFor(root, active);
  const vars = scopeVars(scope);

  const send = async () => {
    if (!active || loading) return;
    slime();
    setLoading(true);
    setError(null);
    setResponse(null);
    setSent(null);
    try {
      let req = active;
      if (req.auth.type === "oauth2") {
        const token = await ensureToken(req.auth.oauth2, (s) => interpolate(s, vars), req.settings);
        if (token !== req.auth.oauth2.token) {
          req = { ...req, auth: { ...req.auth, oauth2: { ...req.auth.oauth2, token } } };
          updateRequest(req);
        }
      }
      const wire = prepareRequest(req, vars);
      setSent(wire);
      const res = await sendHttp(wire, req.settings);
      setResponse(res);
      if (res.status >= 400) setBurn({ status: res.status, statusText: res.status_text });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setBurn({ status: null, statusText: "Request failed", message });
    } finally {
      setLoading(false);
    }
  };

  // ⌘↵ / Ctrl+↵ sends from anywhere
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        sendRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = workspace.current?.getBoundingClientRect();
    if (!rect) return;
    const move = (ev: MouseEvent) => setSplit(Math.min(0.72, Math.max(0.28, (ev.clientX - rect.left) / rect.width)));
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  };

  const firstCollection = collections.collections[0];

  return (
    <div className="app">
      <Sidebar
        state={collections}
        envs={envs}
        envRoot={root}
        onManageEnvironments={setEnvModal}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        sounds={sounds}
        onToggleSounds={() => setSounds((s) => !s)}
      />
      <ScopeContext.Provider value={scope}>
        <main className="main">
          {active ? (
            <>
              <RequestBar
                request={active}
                breadcrumb={collections.breadcrumb}
                loading={loading}
                onChange={updateRequest}
                onSend={send}
              />
              <div className="workspace" ref={workspace}>
                <div className="pane pane-request" style={{ flexBasis: `${split * 100}%` }}>
                  <RequestEditor request={active} vars={vars} onChange={updateRequest} />
                </div>
                <div className="divider" onMouseDown={startResize} onDoubleClick={() => setSplit(0.5)} />
                <div className="pane pane-response">
                  <ResponseViewer response={response} sent={sent} error={error} loading={loading} />
                </div>
              </div>
            </>
          ) : (
            <div className="empty-state" data-tauri-drag-region>
              <div className="empty-logo">
                <img src={logo} alt="" />
              </div>
              <h2>No request open</h2>
              <p>{noRequestLine}</p>
              {firstCollection && (
                <button className="btn-primary" onClick={() => collections.actions.newRequest(firstCollection.root, "")}>
                  <Plus size={15} /> New request
                </button>
              )}
            </div>
          )}
        </main>
      </ScopeContext.Provider>
      {envModal && (
        <EnvironmentModal
          envs={envs}
          collections={collections.collections}
          onCollectionVariables={collections.actions.setVariables}
          initialRoot={root}
          initialTab={envModal}
          onClose={closeEnvModal}
        />
      )}
      {burn && <BurnedOverlay burn={burn} onClose={closeBurn} />}
      {collections.error && (
        <div className="toast" onClick={collections.clearError}>
          <AlertTriangle size={16} />
          <span>{collections.error}</span>
          <X size={14} className="toast-close" />
        </div>
      )}
    </div>
  );
}

export default App;
