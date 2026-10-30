import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { sendHttp, type WireRequest } from "./api";
import { useCollections } from "./collections";
import { envVars, interpolate } from "./interpolate";
import { ensureToken } from "./oauth2";
import { prepareRequest } from "./prepare";
import { loadActiveEnvironment, loadEnvironments, saveActiveEnvironment, saveEnvironments } from "./storage";
import type { HttpResponse } from "./types";
import { Sidebar } from "./components/Sidebar";
import { RequestEditor } from "./components/RequestEditor";
import { ResponseViewer } from "./components/ResponseViewer";
import { EnvironmentModal } from "./components/EnvironmentModal";

function App() {
  const collections = useCollections();
  const { active, activeId, updateRequest } = collections;
  const [environments, setEnvironments] = useState(loadEnvironments);
  const [activeEnvId, setActiveEnvId] = useState(loadActiveEnvironment);
  const [showEnvironments, setShowEnvironments] = useState(false);
  const [response, setResponse] = useState<HttpResponse | null>(null);
  const [sent, setSent] = useState<WireRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => saveEnvironments(environments), [environments]);
  useEffect(() => saveActiveEnvironment(activeEnvId), [activeEnvId]);

  // The response panel belongs to the selected request
  useEffect(() => {
    setResponse(null);
    setSent(null);
    setError(null);
  }, [activeId]);

  const vars = useMemo(
    () => envVars(environments.find((e) => e.id === activeEnvId)),
    [environments, activeEnvId],
  );

  const send = async () => {
    if (!active) return;
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
      setResponse(await sendHttp(wire, req.settings));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <Sidebar state={collections} />
      <main className="main">
        <div className="topbar">
          <select
            className="input env-select"
            value={activeEnvId ?? ""}
            onChange={(e) => setActiveEnvId(e.target.value || null)}
          >
            <option value="">No Environment</option>
            {environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => setShowEnvironments(true)}>
            Environments
          </button>
        </div>
        {active ? (
          <>
            <RequestEditor
              request={active}
              breadcrumb={collections.breadcrumb}
              vars={vars}
              loading={loading}
              onChange={updateRequest}
              onSend={send}
            />
            <ResponseViewer response={response} sent={sent} error={error} loading={loading} />
          </>
        ) : (
          <div className="empty">Select a request, or create one with + on a collection or folder.</div>
        )}
      </main>
      {showEnvironments && (
        <EnvironmentModal
          environments={environments}
          onChange={setEnvironments}
          onClose={() => setShowEnvironments(false)}
        />
      )}
      {collections.error && (
        <div className="toast" onClick={collections.clearError}>
          {collections.error}
          <span className="toast-close">×</span>
        </div>
      )}
    </div>
  );
}

export default App;
