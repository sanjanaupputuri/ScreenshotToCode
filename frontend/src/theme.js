export const theme = {
  colors: {
    pageBg: "#eef2f7",
    pageAccent: "rgba(24, 119, 242, 0.08)",
    panel: "rgba(255, 255, 255, 0.9)",
    panelStrong: "rgba(255, 255, 255, 0.97)",
    border: "#d7dde5",
    borderStrong: "#c9d2dd",
    text: "#1c1e21",
    muted: "#5f6773",
    accent: "#1877f2",
    accentHover: "#166fe5",
    accentSoft: "#e7f3ff",
    success: "#2e7d32",
    error: "#c62828",
  },
  typography: {
    fontFamily:
      '"Inter", "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif',
    monoFamily:
      '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  },
  radius: {
    sm: 8,
    md: 10,
    lg: 16,
    pill: 999,
  },
  shadow: {
    sm: "0 2px 6px rgba(0,0,0,0.05)",
    md: "0 4px 12px rgba(0,0,0,0.08)",
    lg: "0 8px 32px rgba(0,0,0,0.08)",
  },
};

export const shellStyles = {
  page: {
    minHeight: "100vh",
    width: "100%",
    background:
      "radial-gradient(circle at top left, rgba(24,119,242,0.10), transparent 30%), radial-gradient(circle at bottom right, rgba(46,125,50,0.06), transparent 24%), linear-gradient(180deg, #f7f9fc 0%, #eef2f7 100%)",
    color: theme.colors.text,
    fontFamily: theme.typography.fontFamily,
    overflowY: "auto",
  },
  panel: {
    background: theme.colors.panel,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radius.lg,
    boxShadow: theme.shadow.lg,
    backdropFilter: "blur(16px)",
  },
  primaryButton: {
    background: theme.colors.accent,
    color: "#fff",
    border: "none",
    borderRadius: theme.radius.sm,
    boxShadow: "0 4px 15px rgba(24, 119, 242, 0.3)",
  },
  subtleButton: {
    background: "#fff",
    color: theme.colors.text,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radius.sm,
  },
};
