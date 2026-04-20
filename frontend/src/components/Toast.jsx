import { useEffect, useState } from "react";
import { CheckCircle, XCircle, Info } from "lucide-react";

let _push = null;
export const toast = {
  success: (msg) => _push?.({ type: "success", msg }),
  error:   (msg) => _push?.({ type: "error",   msg }),
  info:    (msg) => _push?.({ type: "info",     msg }),
};

export default function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    _push = ({ type, msg }) => {
      const id = Date.now();
      setToasts(p => [...p, { id, type, msg }]);
      setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
    };
    return () => { _push = null; };
  }, []);

  const icons = { success: CheckCircle, error: XCircle, info: Info };
  const colors = {
    success: { bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.3)", color: "#6ee7b7" },
    error:   { bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.3)",  color: "#fca5a5" },
    info:    { bg: "rgba(99,102,241,0.12)", border: "rgba(99,102,241,0.3)", color: "#a5b4fc" },
  };

  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 9999,
      display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none"
    }}>
      {toasts.map(({ id, type, msg }) => {
        const Icon = icons[type];
        const c = colors[type];
        return (
          <div key={id} className="toast-enter" style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "0.75rem 1.1rem", borderRadius: 10,
            background: c.bg, border: `1px solid ${c.border}`,
            color: c.color, fontSize: "0.85rem", fontWeight: 500,
            backdropFilter: "blur(12px)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            minWidth: 240, maxWidth: 340
          }}>
            <Icon size={15} strokeWidth={2.5} style={{ flexShrink: 0 }} />
            {msg}
          </div>
        );
      })}
    </div>
  );
}
