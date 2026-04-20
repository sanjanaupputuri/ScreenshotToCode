import { useEffect } from "react";
import { X } from "lucide-react";

export default function Modal({ title, onClose, children, width = 480 }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "1rem", animation: "fadeIn 0.2s ease"
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: width,
          background: "#0d0d18", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16, overflow: "hidden",
          animation: "fadeUp 0.25s ease",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)"
        }}
      >
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "1rem 1.25rem", borderBottom: "1px solid rgba(255,255,255,0.07)"
        }}>
          <span style={{ fontWeight: 700, color: "#e2e8f0", fontSize: "0.9rem" }}>{title}</span>
          <button
            aria-label="Close modal"
            onClick={onClose}
            className="btn-ghost"
            style={{ padding: "0.25rem", border: "none", background: "none" }}
          >
            <X size={15} />
          </button>
        </div>
        <div style={{ padding: "1.25rem" }}>{children}</div>
      </div>
    </div>
  );
}
