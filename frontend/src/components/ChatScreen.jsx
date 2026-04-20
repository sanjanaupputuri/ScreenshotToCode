import { useRef, useState, useEffect, useCallback } from "react";
import {
  X, History, LogOut, Upload, ImageIcon,
  Clock, ChevronRight, Plus, Loader2
} from "lucide-react";
import Logo from "./Logo";
import Button from "./Button";
import Skeleton from "./Skeleton";
import CodeBlock from "./CodeBlock";
import { toast } from "./Toast";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3001";

// ── StatusDot ─────────────────────────────────────────────────────────────────
function StatusDot({ label, up }) {
  const color = up === null ? "#334155" : up ? "#10b981" : "#ef4444";
  const title = up === null ? "Checking…" : up ? `${label}: Online` : `${label}: Offline — check your local services`;
  return (
    <span title={title} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.72rem", color: "var(--text-muted)", cursor: "default" }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%", background: color,
        display: "inline-block", boxShadow: up ? `0 0 6px ${color}` : "none"
      }} />
      {label}
    </span>
  );
}

// ── PipelineProgress ──────────────────────────────────────────────────────────
const STAGES = [
  "Detecting elements (OpenCV)…",
  "Matching templates (SQLite)…",
  "Generating code (Ollama)…",
];

function PipelineProgress({ active }) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (!active) { setStage(0); return; }
    setStage(0);
    const t1 = setTimeout(() => setStage(1), 3000);
    const t2 = setTimeout(() => setStage(2), 6000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [active]);

  if (!active) return null;

  return (
    <div style={{ alignSelf: "flex-start", animation: "fadeUp 0.3s ease", maxWidth: 340 }}>
      <div style={{
        padding: "0.9rem 1.1rem", borderRadius: 10,
        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)"
      }}>
        {STAGES.map((s, i) => (
          <div key={s} style={{
            display: "flex", alignItems: "center", gap: 9,
            marginBottom: i < STAGES.length - 1 ? 8 : 0,
            opacity: i > stage ? 0.3 : 1, transition: "opacity 0.4s"
          }}>
            <div style={{
              width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: i < stage ? "rgba(16,185,129,0.2)" : i === stage ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${i < stage ? "rgba(16,185,129,0.4)" : i === stage ? "rgba(99,102,241,0.4)" : "rgba(255,255,255,0.08)"}`
            }}>
              {i < stage
                ? <span style={{ fontSize: "0.6rem", color: "#6ee7b7" }}>✓</span>
                : i === stage
                  ? <Loader2 size={9} color="#818cf8" style={{ animation: "spin 1s linear infinite" }} />
                  : <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#334155", display: "block" }} />
              }
            </div>
            <span style={{
              fontSize: "0.8rem",
              color: i < stage ? "#6ee7b7" : i === stage ? "var(--text-primary)" : "var(--text-faint)"
            }}>{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Message ───────────────────────────────────────────────────────────────────
function Message({ msg, onSave, saving, saved, isNew }) {
  const isUser = msg.sender === "user";
  return (
    <div style={{
      alignSelf: isUser ? "flex-end" : "flex-start",
      maxWidth: msg.code ? "96%" : "72%",
      width: msg.code ? "96%" : undefined,
      display: "flex", flexDirection: "column", gap: 8,
      animation: isNew ? "fadeUp 0.3s ease" : "none"
    }}>
      {msg.image && (
        <img src={msg.image} alt="Uploaded screenshot" style={{
          maxWidth: "100%", borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.08)",
          maxHeight: 260, objectFit: "contain"
        }} />
      )}
      {msg.code ? (
        <CodeBlock code={msg.code} onSave={onSave} saving={saving} saved={saved} />
      ) : (
        <div
          role={msg.isError ? "alert" : undefined}
          aria-live={msg.isError ? "assertive" : undefined}
          style={{
            padding: "0.7rem 1rem", borderRadius: 10,
            background: isUser
              ? "rgba(99,102,241,0.14)"
              : msg.isError ? "rgba(239,68,68,0.09)" : "rgba(255,255,255,0.04)",
            color: msg.isError ? "#fca5a5" : isUser ? "#c7d2fe" : "#cbd5e1",
            border: isUser
              ? "1px solid rgba(99,102,241,0.28)"
              : msg.isError ? "1px solid rgba(239,68,68,0.22)" : "1px solid rgba(255,255,255,0.07)",
            fontSize: "0.88rem", lineHeight: 1.65
          }}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}

// ── HistoryPanel ──────────────────────────────────────────────────────────────
function HistoryPanel({ history, loading, onClose, onLoad, isMobile }) {
  const [search, setSearch] = useState("");
  const filtered = history.filter(item =>
    new Date(item.created_at).toLocaleString().toLowerCase().includes(search.toLowerCase())
  );

  const content = (
    <>
      <div style={{
        padding: "1rem 1.1rem", borderBottom: "1px solid rgba(255,255,255,0.07)",
        display: "flex", justifyContent: "space-between", alignItems: "center"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Clock size={14} color="var(--accent-light)" />
          <span style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: "0.88rem" }}>Saved History</span>
        </div>
        <button aria-label="Close history panel" onClick={onClose} className="btn-ghost"
          style={{ padding: "0.25rem", border: "none", background: "none" }}>
          <X size={15} />
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <input
          type="search"
          placeholder="Filter by date…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Filter history by date"
          style={{
            width: "100%", padding: "0.4rem 0.75rem", borderRadius: 7,
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
            color: "var(--text-primary)", fontSize: "0.78rem", fontFamily: "inherit",
            outline: "none"
          }}
        />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem" }}>
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {[80, 80, 80].map((h, i) => <Skeleton key={i} height={h} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", height: "50%", gap: 10, color: "var(--text-faint)",
            marginTop: "3rem"
          }}>
            <ImageIcon size={32} strokeWidth={1.5} />
            <span style={{ fontSize: "0.83rem" }}>
              {search ? "No results found" : "No saved generations yet"}
            </span>
          </div>
        ) : filtered.map(item => (
          <div key={item.id} onClick={() => onLoad(item)} style={{
            padding: "0.8rem", borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.06)",
            marginBottom: "0.5rem", background: "rgba(255,255,255,0.02)",
            cursor: "pointer", transition: "all 0.2s"
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(99,102,241,0.35)"; e.currentTarget.style.background = "rgba(99,102,241,0.06)"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
          >
            {item.image_url && (
              <img
                src={`${API_BASE}${item.image_url}`}
                alt={`Screenshot from ${new Date(item.created_at).toLocaleDateString()}`}
                loading="lazy"
                style={{ width: "100%", borderRadius: 6, marginBottom: 8, maxHeight: 72, objectFit: "cover" }}
                onError={e => e.target.style.display = "none"}
              />
            )}
            <div style={{ fontSize: "0.68rem", color: "var(--text-faint)" }}>
              {new Date(item.created_at).toLocaleString()}
            </div>
            <div style={{
              display: "flex", alignItems: "center", gap: 4,
              fontSize: "0.73rem", color: "var(--accent)", marginTop: 5, fontWeight: 600
            }}>
              Load generation <ChevronRight size={11} />
            </div>
          </div>
        ))}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <div
        role="dialog" aria-modal="true" aria-label="Saved History"
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 50,
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
          animation: "fadeIn 0.2s ease"
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            background: "#0d0d18", borderTop: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "16px 16px 0 0", maxHeight: "80vh",
            display: "flex", flexDirection: "column",
            animation: "fadeUp 0.25s ease"
          }}
        >
          {content}
        </div>
      </div>
    );
  }

  return (
    <div
      role="complementary" aria-label="Saved History"
      style={{
        position: "absolute", top: 0, right: 0, bottom: 0, width: 320,
        background: "#0d0d18", borderLeft: "1px solid rgba(255,255,255,0.07)",
        zIndex: 20, display: "flex", flexDirection: "column",
        boxShadow: "-12px 0 40px rgba(0,0,0,0.5)",
        animation: "slideIn 0.25s ease"
      }}
    >
      {content}
    </div>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div style={{
      margin: "auto", textAlign: "center", color: "var(--text-faint)",
      animation: "fadeUp 0.5s ease", padding: "2rem"
    }}>
      <div style={{
        width: 68, height: 68, borderRadius: 18, margin: "0 auto 1.25rem",
        background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.18)",
        display: "flex", alignItems: "center", justifyContent: "center"
      }}>
        <Upload size={28} color="var(--accent)" strokeWidth={1.5} />
      </div>
      <div style={{ fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8, fontSize: "1rem" }}>
        Drop a screenshot to get started
      </div>
      <div style={{ fontSize: "0.82rem", maxWidth: 340, lineHeight: 1.75, margin: "0 auto 1.5rem" }}>
        Upload any UI screenshot — or <kbd style={{
          padding: "0.1rem 0.4rem", borderRadius: 4,
          background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
          fontSize: "0.75rem", fontFamily: "inherit"
        }}>Ctrl+V</kbd> to paste from clipboard.
      </div>
      <div style={{ display: "flex", gap: 7, justifyContent: "center", flexWrap: "wrap" }}>
        {["OpenCV Detection", "SQLite Templates", "Ollama Generation"].map(s => (
          <span key={s} style={{
            padding: "0.28rem 0.8rem", borderRadius: 20,
            background: "rgba(99,102,241,0.07)", border: "1px solid rgba(99,102,241,0.18)",
            color: "var(--accent)", fontSize: "0.72rem", fontWeight: 600
          }}>{s}</span>
        ))}
      </div>
    </div>
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
  const [dragOver, setDragOver] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const activeUploadRef = useRef({ id: null, controller: null });
  const lastMsgIdx = messages.length - 1;

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => activeUploadRef.current.controller?.abort();
  }, []);

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

  // Clipboard paste
  useEffect(() => {
    const onPaste = (e) => {
      if (loading) return;
      const file = [...(e.clipboardData?.items || [])]
        .find(i => i.type.startsWith("image/"))?.getAsFile();
      if (file) processFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [loading]);

  const getToken = useCallback(() => user.getIdToken(), [user]);

  const processFile = async (file) => {
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files are supported (PNG, JPG, WEBP)");
      return;
    }

    activeUploadRef.current.controller?.abort();
    const uploadId = `${Date.now()}-${crypto.randomUUID()}`;
    const controller = new AbortController();
    activeUploadRef.current = { id: uploadId, controller };

    const previewUrl = URL.createObjectURL(file);
    setMessages(prev => [...prev, { sender: "user", text: `📸 ${file.name}`, image: previewUrl, isNew: true }]);
    setLoading(true);
    setTimeout(() => URL.revokeObjectURL(previewUrl), 60000);

    try {
      const formData = new FormData();
      formData.append("image", file);
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/upload?uploadId=${encodeURIComponent(uploadId)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "X-Upload-Id": uploadId },
        body: formData, cache: "no-store", signal: controller.signal
      });
      const result = await res.json();
      if (activeUploadRef.current.id !== uploadId) return;

      if (result.success) {
        setMessages(prev => [...prev, {
          sender: "bot", text: "✅ Code generated successfully!",
          code: result.code, imageUrl: result.imageUrl,
          requestId: result.requestId || uploadId, isNew: true
        }]);
        toast.success("Code generated successfully!");
      } else {
        setMessages(prev => [...prev, {
          sender: "bot", text: `❌ ${result.error || "Failed to generate code."}`, isError: true, isNew: true
        }]);
        toast.error(result.error || "Failed to generate code.");
      }
    } catch (error) {
      if (error.name === "AbortError") return;
      setMessages(prev => [...prev, {
        sender: "bot",
        text: `❌ ${error.message || "Could not reach the backend."}`,
        isError: true, isNew: true
      }]);
      toast.error(error.message || "Could not reach the backend.");
    } finally {
      if (activeUploadRef.current.id === uploadId) {
        setLoading(false);
        activeUploadRef.current = { id: null, controller: null };
      }
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    processFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files are supported (PNG, JPG, WEBP)");
      return;
    }
    processFile(file);
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
      const ok = result.success;
      setSaveState(prev => ({ ...prev, [msgIdx]: ok ? "saved" : null }));
      if (ok) toast.success("Code saved to history.");
      else toast.error("Failed to save code.");
    } catch {
      setSaveState(prev => ({ ...prev, [msgIdx]: null }));
      toast.error("Failed to save code.");
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
      toast.error("Failed to load history.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleLoadFromHistory = (item) => {
    setMessages(prev => [...prev, {
      sender: "bot", text: "📂 Loaded from history",
      code: item.code, imageUrl: item.image_url, isNew: true
    }]);
    setShowHistory(false);
    toast.info("Loaded from history.");
  };

  const handleClear = () => {
    activeUploadRef.current.controller?.abort();
    setMessages([]);
    setSaveState({});
    setLoading(false);
  };

  return (
    <div style={{
      position: "relative", display: "flex", flexDirection: "column",
      height: "100vh", background: "var(--bg)", color: "var(--text-primary)"
    }}>
      {/* Header */}
      <header style={{
        padding: "0.7rem 1.5rem", borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: "rgba(10,10,15,0.92)", backdropFilter: "blur(14px)", flexShrink: 0
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Logo size="sm" />
          <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.08)" }} />
          <div style={{ display: "flex", gap: 12 }}>
            <StatusDot label="Python" up={status.python_service} />
            <StatusDot label="Ollama" up={status.ollama} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {user?.photoURL && (
            <img src={user.photoURL} alt={`${user.displayName || "User"} avatar`} style={{
              width: 28, height: 28, borderRadius: "50%",
              border: "2px solid rgba(99,102,241,0.4)"
            }} />
          )}
          <span className="chat-header-name" style={{ fontSize: "0.78rem", color: "var(--text-muted)", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user?.displayName || user?.email}
          </span>

          {messages.length > 0 && (
            <Button onClick={handleClear} aria-label="Start new session">
              <Plus size={13} /> New
            </Button>
          )}
          <Button onClick={handleOpenHistory} aria-label="Open saved history">
            <History size={13} /> History
          </Button>
          <Button danger onClick={onLogout} aria-label="Sign out">
            <LogOut size={13} /> Sign out
          </Button>
        </div>
      </header>

      {/* Messages */}
      <div
        role="log"
        aria-label="Conversation"
        aria-live="polite"
        style={{
          flex: 1, overflowY: "auto", padding: "1.5rem",
          display: "flex", flexDirection: "column", gap: "1rem"
        }}
      >
        {messages.length === 0 && <EmptyState />}

        {messages.map((msg, idx) => (
          <Message
            key={idx} msg={msg}
            onSave={() => handleSaveCode(idx)}
            saving={saveState[idx] === "saving"}
            saved={saveState[idx] === "saved"}
            isNew={idx === lastMsgIdx}
          />
        ))}

        <PipelineProgress active={loading} />

        <div ref={messagesEndRef} />
      </div>

      {/* Upload bar */}
      <div style={{
        padding: "0.9rem 1.5rem", borderTop: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(10,10,15,0.92)", backdropFilter: "blur(14px)", flexShrink: 0
      }}>
        <input
          ref={fileInputRef}
          id="file-upload"
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          style={{ display: "none" }}
          aria-label="Upload screenshot"
        />
        <label
          htmlFor="file-upload"
          role="button"
          tabIndex={loading ? -1 : 0}
          aria-disabled={loading}
          aria-label="Upload screenshot — click or drag and drop"
          onKeyDown={e => { if ((e.key === "Enter" || e.key === " ") && !loading) fileInputRef.current?.click(); }}
          onDragOver={e => { e.preventDefault(); if (!loading) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            padding: "0.9rem 1.5rem", borderRadius: 10,
            border: `2px dashed ${dragOver ? "rgba(99,102,241,0.55)" : loading ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.09)"}`,
            background: dragOver ? "rgba(99,102,241,0.06)" : "rgba(255,255,255,0.015)",
            color: loading ? "var(--text-faint)" : dragOver ? "#a5b4fc" : "var(--text-muted)",
            fontSize: "0.86rem", cursor: loading ? "not-allowed" : "pointer",
            transition: "all 0.2s", textAlign: "center"
          }}
        >
          {loading ? (
            <>
              <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
              Processing your screenshot…
            </>
          ) : (
            <>
              <Upload size={15} />
              Click to upload, drag & drop, or <kbd style={{
                padding: "0.1rem 0.35rem", borderRadius: 4,
                background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                fontSize: "0.72rem", fontFamily: "inherit"
              }}>Ctrl+V</kbd> to paste
              <span style={{ fontSize: "0.7rem", color: "var(--text-faint)", marginLeft: 4 }}>PNG · JPG · WEBP</span>
            </>
          )}
        </label>
      </div>

      {showHistory && (
        <HistoryPanel
          history={history}
          loading={historyLoading}
          onClose={() => setShowHistory(false)}
          onLoad={handleLoadFromHistory}
          isMobile={isMobile}
        />
      )}
    </div>
  );
}
