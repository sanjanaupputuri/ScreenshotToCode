import { useRef, useState, useEffect, useCallback } from "react";

const API_BASE = "http://localhost:3001";

// ── CodeBlock ─────────────────────────────────────────────────────────────────
function CodeBlock({ code, onSave, saving, saved }) {
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState("code");

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{
      borderRadius: 10, border: "1px solid #dddfe2",
      background: "#fff", boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
      overflow: "hidden", width: "100%"
    }}>
      {/* Tab bar */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "0.5rem 1rem", borderBottom: "1px solid #dddfe2", background: "#f8f9fa"
      }}>
        <div style={{ display: "flex", gap: 4 }}>
          {["code", "preview"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "0.3rem 0.75rem", borderRadius: 6, border: "none",
              background: tab === t ? "#1877f2" : "transparent",
              color: tab === t ? "#fff" : "#606770",
              fontSize: "0.78rem", fontWeight: 600, cursor: "pointer"
            }}>
              {t === "code" ? "💻 Code" : "👁️ Preview"}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={copy} style={{
            padding: "0.3rem 0.75rem", borderRadius: 6,
            border: "1px solid #dddfe2",
            background: copied ? "#e6f4ea" : "#fff",
            color: copied ? "#2e7d32" : "#606770",
            fontSize: "0.78rem", cursor: "pointer"
          }}>
            {copied ? "✓ Copied" : "📋 Copy"}
          </button>
          <button onClick={onSave} disabled={saving || saved} style={{
            padding: "0.3rem 0.75rem", borderRadius: 6,
            border: "1px solid #dddfe2",
            background: saved ? "#e6f4ea" : saving ? "#f0f2f5" : "#fff",
            color: saved ? "#2e7d32" : saving ? "#aaa" : "#606770",
            fontSize: "0.78rem", cursor: saving || saved ? "default" : "pointer"
          }}>
            {saved ? "✓ Saved" : saving ? "Saving…" : "💾 Save"}
          </button>
        </div>
      </div>

      {tab === "code" ? (
        <pre style={{
          margin: 0, padding: "1rem", fontSize: "0.76rem", fontFamily: "monospace",
          whiteSpace: "pre-wrap", overflowY: "auto", maxHeight: 340,
          color: "#1c1e21", lineHeight: 1.6, background: "#fafafa"
        }}>
          {code}
        </pre>
      ) : (
        <iframe
          srcDoc={code}
          title="preview"
          sandbox="allow-scripts"
          style={{ width: "100%", height: 340, border: "none", display: "block" }}
        />
      )}
    </div>
  );
}

// ── Message ───────────────────────────────────────────────────────────────────
function Message({ msg, onSave, saving, saved }) {
  const isUser = msg.sender === "user";
  return (
    <div style={{
      alignSelf: isUser ? "flex-end" : "flex-start",
      maxWidth: msg.code ? "92%" : "75%",
      width: msg.code ? "92%" : undefined,
      display: "flex", flexDirection: "column", gap: 6
    }}>
      {msg.image && (
        <img src={msg.image} alt="screenshot" style={{
          maxWidth: "100%", borderRadius: 10, border: "1px solid #dddfe2",
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)", maxHeight: 300, objectFit: "contain"
        }} />
      )}
      {msg.code ? (
        <CodeBlock code={msg.code} onSave={onSave} saving={saving} saved={saved} />
      ) : (
        <div style={{
          padding: "0.8rem 1.1rem", borderRadius: 10,
          background: isUser ? "#e7f3ff" : msg.isError ? "#fff0f0" : "#fff",
          color: msg.isError ? "#c62828" : "#1c1e21",
          border: isUser ? "1px solid #1877f2" : msg.isError ? "1px solid #ffcdd2" : "1px solid #dddfe2",
          fontSize: "0.92rem", boxShadow: "0 2px 6px rgba(0,0,0,0.05)"
        }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

// ── HistoryPanel ──────────────────────────────────────────────────────────────
function HistoryPanel({ history, loading, onClose, onLoad }) {
  return (
    <div style={{
      position: "absolute", top: 0, right: 0, bottom: 0, width: 360,
      background: "rgba(255,255,255,0.97)", backdropFilter: "blur(16px)",
      borderLeft: "1px solid #dddfe2", zIndex: 20,
      display: "flex", flexDirection: "column",
      boxShadow: "-4px 0 20px rgba(0,0,0,0.08)"
    }}>
      <div style={{
        padding: "1.1rem 1.4rem", borderBottom: "1px solid #dddfe2",
        display: "flex", justifyContent: "space-between", alignItems: "center"
      }}>
        <span style={{ fontWeight: 700, color: "#1877f2" }}>📜 Saved History</span>
        <button onClick={onClose} style={{
          background: "none", border: "none", cursor: "pointer",
          color: "#606770", fontSize: "1.1rem"
        }}>✕</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem" }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "#606770", marginTop: "2rem" }}>Loading…</div>
        ) : history.length === 0 ? (
          <div style={{ textAlign: "center", color: "#606770", marginTop: "2rem", fontSize: "0.9rem" }}>
            No saved generations yet
          </div>
        ) : history.map(item => (
          <div key={item.id}
            onClick={() => onLoad(item)}
            style={{
              padding: "0.85rem", borderRadius: 8, border: "1px solid #dddfe2",
              marginBottom: "0.6rem", background: "#f8f9fa", cursor: "pointer",
              transition: "all 0.2s"
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "#1877f2"; e.currentTarget.style.background = "#e7f3ff"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "#dddfe2"; e.currentTarget.style.background = "#f8f9fa"; }}
          >
            {item.image_url && (
              <img
                src={`${API_BASE}${item.image_url}`}
                alt="screenshot"
                style={{ width: "100%", borderRadius: 6, marginBottom: 6, maxHeight: 90, objectFit: "cover" }}
                onError={e => e.target.style.display = "none"}
              />
            )}
            <div style={{ fontSize: "0.72rem", color: "#606770" }}>
              {new Date(item.created_at).toLocaleString()}
            </div>
            <div style={{ fontSize: "0.78rem", color: "#1877f2", marginTop: 3 }}>
              Click to load →
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── StatusBar ─────────────────────────────────────────────────────────────────
function StatusDot({ label, up }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.72rem", color: "#606770" }}>
      <span style={{
        width: 7, height: 7, borderRadius: "50%",
        background: up ? "#10b981" : "#ef4444",
        display: "inline-block"
      }} />
      {label}
    </span>
  );
}

// ── ChatScreen ────────────────────────────────────────────────────────────────
export default function ChatScreen({ user, onLogout }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saveState, setSaveState] = useState({});
  const [status, setStatus] = useState({ python_service: null, ollama: null });
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Poll service status
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/status`);
        if (r.ok) setStatus(await r.json());
      } catch { /* backend down */ }
    };
    check();
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, []);

  const getToken = useCallback(() => user.getIdToken(), [user]);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const previewUrl = URL.createObjectURL(file);
    setMessages(prev => [...prev, { sender: "user", text: `📸 ${file.name}`, image: previewUrl }]);
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("image", file);

      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      const result = await res.json();

      if (result.success) {
        setMessages(prev => [...prev, {
          sender: "bot",
          text: "✅ Code generated successfully!",
          code: result.code,
          imageUrl: result.imageUrl
        }]);
      } else {
        setMessages(prev => [...prev, {
          sender: "bot",
          text: `❌ ${result.error || "Failed to generate code."}`,
          isError: true
        }]);
      }
    } catch {
      setMessages(prev => [...prev, {
        sender: "bot",
        text: "❌ Could not reach the backend. Make sure it's running on port 3001.",
        isError: true
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCode = async (msgIdx) => {
    const msg = messages[msgIdx];
    if (!msg?.code) return;
    setSaveState(prev => ({ ...prev, [msgIdx]: "saving" }));
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/save-code`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code: msg.code, imageUrl: msg.imageUrl || "" })
      });
      const result = await res.json();
      setSaveState(prev => ({ ...prev, [msgIdx]: result.success ? "saved" : null }));
      if (!result.success) alert("Failed to save: " + (result.error || "Unknown error"));
    } catch {
      setSaveState(prev => ({ ...prev, [msgIdx]: null }));
      alert("Could not reach server.");
    }
  };

  const handleOpenHistory = async () => {
    setShowHistory(true);
    setHistoryLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/history`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setHistory(Array.isArray(data) ? data : []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleLoadFromHistory = (item) => {
    setMessages(prev => [...prev, {
      sender: "bot",
      text: "📂 Loaded from history",
      code: item.code,
      imageUrl: item.image_url
    }]);
    setShowHistory(false);
  };

  return (
    <div style={{
      position: "relative", zIndex: 10, display: "flex",
      flexDirection: "column", height: "100%", color: "#1c1e21"
    }}>
      {/* Header */}
      <div style={{
        padding: "0.85rem 1.5rem", borderBottom: "1px solid #dddfe2",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: "rgba(255,255,255,0.9)", backdropFilter: "blur(10px)", flexShrink: 0
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "#1877f2" }}>
            📸 Screenshot to Code
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            <StatusDot label="Python" up={status.python_service} />
            <StatusDot label="Ollama" up={status.ollama} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {user?.photoURL && (
            <img src={user.photoURL} alt="avatar" style={{
              width: 28, height: 28, borderRadius: "50%", border: "2px solid #1877f2"
            }} />
          )}
          <span style={{ fontSize: "0.82rem", color: "#606770" }}>
            {user?.displayName || user?.email}
          </span>
          <button onClick={handleOpenHistory} style={{
            background: "none", border: "1px solid #dddfe2", borderRadius: 6,
            color: "#606770", cursor: "pointer", fontSize: "0.82rem",
            padding: "0.3rem 0.7rem", transition: "all 0.2s"
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "#1877f2"; e.currentTarget.style.color = "#1877f2"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "#dddfe2"; e.currentTarget.style.color = "#606770"; }}
          >
            📜 History
          </button>
          <button onClick={onLogout} style={{
            background: "none", border: "none", color: "#606770",
            cursor: "pointer", fontSize: "0.82rem"
          }}
          onMouseEnter={e => e.currentTarget.style.color = "#c62828"}
          onMouseLeave={e => e.currentTarget.style.color = "#606770"}
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: "auto", padding: "1.25rem 1.5rem",
        display: "flex", flexDirection: "column", gap: "1rem",
        background: "rgba(240,242,245,0.5)"
      }}>
        {messages.length === 0 && (
          <div style={{ margin: "auto", textAlign: "center", color: "#606770" }}>
            <div style={{ fontSize: "3rem", marginBottom: 10 }}>📸</div>
            <div style={{ fontWeight: 600, color: "#1c1e21", marginBottom: 6 }}>
              Upload a UI screenshot to get started
            </div>
            <div style={{ fontSize: "0.85rem", maxWidth: 380, lineHeight: 1.6 }}>
              The system will detect UI elements using OpenCV, match templates from SQLite,
              and generate HTML/CSS code via Ollama.
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {["🔍 OpenCV Detection", "🗄️ SQLite Templates", "🤖 Ollama Generation"].map(s => (
                <span key={s} style={{
                  padding: "0.3rem 0.8rem", borderRadius: 20,
                  background: "rgba(24,119,242,0.08)", border: "1px solid rgba(24,119,242,0.2)",
                  color: "#1877f2", fontSize: "0.78rem"
                }}>{s}</span>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <Message
            key={idx}
            msg={msg}
            onSave={() => handleSaveCode(idx)}
            saving={saveState[idx] === "saving"}
            saved={saveState[idx] === "saved"}
          />
        ))}

        {loading && (
          <div style={{ alignSelf: "flex-start" }}>
            <div style={{
              padding: "0.8rem 1.1rem", borderRadius: 10,
              background: "#fff", border: "1px solid #dddfe2",
              color: "#606770", fontSize: "0.88rem",
              display: "flex", alignItems: "center", gap: 8
            }}>
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⚙️</span>
              Detecting elements and generating code…
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div style={{
        padding: "0.85rem 1.5rem", borderTop: "1px solid #dddfe2",
        display: "flex", gap: 10, alignItems: "center",
        background: "rgba(255,255,255,0.9)", backdropFilter: "blur(10px)", flexShrink: 0
      }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          style={{ display: "none" }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          style={{
            flex: 1, padding: "0.8rem", borderRadius: 8,
            border: "2px dashed #dddfe2",
            background: loading ? "#f0f2f5" : "#fafafa",
            color: loading ? "#aaa" : "#606770",
            fontSize: "0.92rem", cursor: loading ? "not-allowed" : "pointer",
            transition: "all 0.2s", fontFamily: "inherit"
          }}
          onMouseEnter={e => { if (!loading) { e.currentTarget.style.borderColor = "#1877f2"; e.currentTarget.style.background = "#e7f3ff"; e.currentTarget.style.color = "#1877f2"; } }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "#dddfe2"; e.currentTarget.style.background = loading ? "#f0f2f5" : "#fafafa"; e.currentTarget.style.color = loading ? "#aaa" : "#606770"; }}
        >
          {loading ? "⚙️ Processing…" : "📁 Click to upload a screenshot (PNG, JPG, etc.)"}
        </button>
      </div>

      {showHistory && (
        <HistoryPanel
          history={history}
          loading={historyLoading}
          onClose={() => setShowHistory(false)}
          onLoad={handleLoadFromHistory}
        />
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
