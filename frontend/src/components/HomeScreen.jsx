import { theme } from "../theme";

export default function HomeScreen({ onGetStarted }) {
  return (
    <div style={{
      position: "relative", zIndex: 10, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", minHeight: "100vh",
      color: theme.colors.text, textAlign: "center", gap: "2rem",
      padding: "2rem", background: "transparent"
    }}>
      <div style={{ fontSize: "clamp(2.4rem, 6vw, 4.6rem)", fontWeight: 800, letterSpacing: "-0.04em", color: theme.colors.accent }}>
        Screenshot to Code
      </div>
      <div style={{ fontSize: "1rem", color: theme.colors.muted, maxWidth: "480px", lineHeight: "1.7", fontWeight: 400 }}>
        Convert your UI screenshots into clean, production-ready HTML and CSS code instantly
      </div>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", justifyContent: "center" }}>
        {[
          { icon: "🔍", label: "OpenCV Detection" },
          { icon: "🗄️", label: "Template Matching" },
          { icon: "⚡", label: "Code Generation" },
        ].map(({ icon, label }) => (
          <div key={label} style={{
            padding: "0.6rem 1.2rem", borderRadius: "20px",
            background: theme.colors.pageAccent, border: "1px solid rgba(24, 119, 242, 0.2)",
            color: theme.colors.accent, fontSize: "0.85rem", fontWeight: 500,
            display: "flex", alignItems: "center", gap: "0.4rem"
          }}>
            {icon} {label}
          </div>
        ))}
      </div>
      <button
        onClick={onGetStarted}
        style={{
          padding: "0.85rem 2.5rem", borderRadius: "8px",
          border: "none", background: theme.colors.accent, color: "white",
          fontSize: "1rem", fontWeight: 600, cursor: "pointer",
          transition: "all 0.3s", boxShadow: "0 4px 15px rgba(24, 119, 242, 0.3)"
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = theme.colors.accentHover; e.currentTarget.style.boxShadow = "0 6px 20px rgba(24, 119, 242, 0.4)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = theme.colors.accent; e.currentTarget.style.boxShadow = "0 4px 15px rgba(24, 119, 242, 0.3)"; }}
      >
        Get Started
      </button>
    </div>
  );
}
