import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import "./index.css";
import App from "./App";
import { AuthProvider } from "@/context/AuthContext";
import { store } from "@/store/store";

// Skala visual aplikasi (default 90%). Zoom browser sengaja tidak diubah.
// Bisa diset lewat VITE_UI_SCALE di .env.local, mis. 0.85 atau 1.
const configuredScale = Number(import.meta.env.VITE_UI_SCALE);
if (Number.isFinite(configuredScale) && configuredScale > 0 && configuredScale <= 1) {
  document.documentElement.style.setProperty("--ui-scale", String(configuredScale));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Provider store={store}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </Provider>
  </StrictMode>,
);
