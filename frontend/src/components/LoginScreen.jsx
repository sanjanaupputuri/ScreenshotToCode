const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18">
    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
    <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z"/>
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z"/>
  </svg>
);

export default function LoginScreen({ onLogin, onBack, error }) {
  return (
    <div style={{
      position: "relative", zIndex: 10, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", height: "100%",
      color: "#1c1e21", gap: "1.5rem"
    }}>
      <div style={{
        background: "rgba(255,255,255,0.85)", backdropFilter: "blur(16px)",
        borderRadius: "16px", padding: "2.5rem 3rem", border: "1px solid #dddfe2",
        boxShadow: "0 8px 32px rgba(0,0,0,0.08)", display: "flex",
        flexDirection: "column", alignItems: "center", gap: "1.5rem", minWidth: "320px"
      }}>
        <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "#1877f2" }}>Welcome back</div>
        <div style={{ fontSize: "0.9rem", color: "#606770", textAlign: "center" }}>
          Sign in to start converting screenshots to code
        </div>

        {error && (
          <div style={{
            padding: "0.75rem 1rem", borderRadius: "8px",
            background: "#fff0f0", border: "1px solid #ffcdd2",
            color: "#c62828", fontSize: "0.85rem", width: "100%", textAlign: "center"
          }}>
            {error}
          </div>
        )}

        <button
          onClick={onLogin}
          style={{
            padding: "0.85rem 2rem", borderRadius: "8px", border: "1px solid #dddfe2",
            background: "#ffffff", color: "#1c1e21", fontSize: "0.95rem",
            fontWeight: 600, cursor: "pointer", transition: "all 0.3s",
            display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)", width: "100%"
          }}
          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.15)"; e.currentTarget.style.background = "#f8f9fa"; }}
          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.1)"; e.currentTarget.style.background = "#ffffff"; }}
        >
          <GoogleIcon />
          Sign in with Google
        </button>

        <button
          onClick={onBack}
          style={{
            background: "none", border: "none", color: "#1877f2",
            cursor: "pointer", fontSize: "0.9rem",
            transition: "color 0.2s", padding: 0
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = "#166fe5"}
          onMouseLeave={(e) => e.currentTarget.style.color = "#1877f2"}
        >
          ← Back to home
        </button>
      </div>
    </div>
  );
}
