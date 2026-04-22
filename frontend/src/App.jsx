import { useState } from "react";
import { signInWithPopup, signOut } from "firebase/auth";
import { auth, googleProvider } from "./firebase";
import HomeScreen from "./components/HomeScreen";
import LoginScreen from "./components/LoginScreen";
import ChatScreen from "./components/ChatScreen";
<<<<<<< HEAD
import ToastContainer from "./components/Toast";
=======
import { shellStyles } from "./theme";
>>>>>>> refine_sanjana

export default function App() {
  const [screen, setScreen] = useState("home");
  const [user, setUser] = useState(null);
  const [loginError, setLoginError] = useState("");

  const handleGoogleLogin = async () => {
    setLoginError("");
    try {
      const result = await signInWithPopup(auth, googleProvider);
      setUser(result.user);
      setScreen("chat");
    } catch {
      setLoginError("Sign-in failed. Please try again.");
    }
  };

  const handleLogout = async () => {
    try { await signOut(auth); } catch { /* ignore */ }
    setUser(null);
    setScreen("home");
  };

  return (
<<<<<<< HEAD
    <>
      {/* Single persistent ambient glow */}
      <div aria-hidden="true" style={{
        position: "fixed", top: "-10%", left: "50%", transform: "translateX(-50%)",
        width: 800, height: 600, borderRadius: "50%", pointerEvents: "none", zIndex: 0,
        background: "radial-gradient(ellipse, rgba(99,102,241,0.1) 0%, transparent 65%)"
      }} />

      <div style={{ position: "relative", zIndex: 1, height: "100vh", overflow: screen === "home" ? "auto" : "hidden" }}>
        {screen === "home" && <HomeScreen onGetStarted={() => setScreen("login")} />}
        {screen === "login" && (
          <LoginScreen
            onLogin={handleGoogleLogin}
            onBack={() => { setLoginError(""); setScreen("home"); }}
            error={loginError}
          />
        )}
        {screen === "chat" && user && <ChatScreen user={user} onLogout={handleLogout} />}
      </div>

      <ToastContainer />
    </>
=======
    <div style={shellStyles.page}>
      {screen === "home" && (
        <HomeScreen onGetStarted={() => setScreen("login")} />
      )}

      {screen === "login" && (
        <LoginScreen
          onLogin={handleGoogleLogin}
          onBack={() => { setLoginError(""); setScreen("home"); }}
          error={loginError}
        />
      )}

      {screen === "chat" && user && (
        <ChatScreen user={user} onLogout={handleLogout} />
      )}
    </div>
>>>>>>> refine_sanjana
  );
}
