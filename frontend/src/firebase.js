import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDD5U72BqbO_B7glgeY017YfQUfHH__4cY",
  authDomain: "screenshottocode-41999.firebaseapp.com",
  projectId: "screenshottocode-41999",
  storageBucket: "screenshottocode-41999.firebasestorage.app",
  messagingSenderId: "115122523127",
  appId: "1:115122523127:web:b993f623be0d9bf70f7cf2",
  measurementId: "G-TTBDBT40YD"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
