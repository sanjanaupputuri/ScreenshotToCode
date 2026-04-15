import { useState } from "react";
import { signInWithPopup, signOut } from "firebase/auth";
import { auth, googleProvider } from "./firebase";
import BubbleCanvas from "./components/BubbleCanvas";
import HomeScreen from "./components/HomeScreen";
import LoginScreen from "./components/LoginScreen";
import ChatScreen from "./components/ChatScreen";

export default function App() {
  const [screen, setScreen] = useState("home"); // "home" | "login" | "chat"
  const [user, setUser] = useState(null);
  const [loginError, setLoginError] = useState("");

  const handleGoogleLogin = async () => {
    setLoginError("");
    try {
      const result = await signInWithPopup(auth, googleProvider);
      setUser(result.user);
      setScreen("chat");
    } catch (error) {
      console.error("Login error:", error);
      setLoginError("Sign-in failed. Please try again.");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch {
      // ignore
    }
    setUser(null);
    setScreen("home");
  };

  return (
    <div style={{
      width: "100vw", height: "100vh", background: "#f0f2f5",
      position: "relative", overflow: "hidden",
      fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
    }}>
      <BubbleCanvas />

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
  );
}
