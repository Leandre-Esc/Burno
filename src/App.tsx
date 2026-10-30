import { useEffect, useState } from "react";
import "./App.css";
import { sendRequest } from "./api";
import { loadRequests, saveRequests } from "./storage";
import { newRequest, type HttpResponse, type RequestItem } from "./types";
import { Sidebar } from "./components/Sidebar";
import { RequestEditor } from "./components/RequestEditor";
import { ResponseViewer } from "./components/ResponseViewer";

function App() {
  const [requests, setRequests] = useState<RequestItem[]>(() => {
    const saved = loadRequests();
    return saved.length ? saved : [newRequest()];
  });
  const [activeId, setActiveId] = useState<string | null>(requests[0]?.id ?? null);
  const [response, setResponse] = useState<HttpResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => saveRequests(requests), [requests]);

  const active = requests.find((r) => r.id === activeId) ?? null;

  const selectRequest = (id: string | null) => {
    setActiveId(id);
    setResponse(null);
    setError(null);
  };

  const addRequest = () => {
    const req = newRequest();
    setRequests((rs) => [...rs, req]);
    selectRequest(req.id);
  };

  const deleteRequest = (id: string) => {
    const remaining = requests.filter((r) => r.id !== id);
    setRequests(remaining);
    if (id === activeId) selectRequest(remaining[0]?.id ?? null);
  };

  const updateRequest = (req: RequestItem) =>
    setRequests((rs) => rs.map((r) => (r.id === req.id ? req : r)));

  const send = async () => {
    if (!active) return;
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      setResponse(await sendRequest(active));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <Sidebar
        requests={requests}
        activeId={activeId}
        onSelect={selectRequest}
        onAdd={addRequest}
        onDelete={deleteRequest}
      />
      <main className="main">
        {active ? (
          <>
            <RequestEditor
              request={active}
              loading={loading}
              onChange={updateRequest}
              onSend={send}
            />
            <ResponseViewer response={response} error={error} loading={loading} />
          </>
        ) : (
          <div className="empty">
            <button className="send-btn" onClick={addRequest}>New request</button>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
