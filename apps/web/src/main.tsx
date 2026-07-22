import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppStateProvider } from "./state";
import { GuestPage } from "./pages/GuestPage";
import { SetupPage } from "./pages/SetupPage";
import { AdminPage } from "./pages/AdminPage";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<StrictMode><BrowserRouter><AppStateProvider><Routes>
  <Route path="/" element={<GuestPage />} />
  <Route path="/setup" element={<SetupPage />} />
  <Route path="/admin" element={<AdminPage />} />
  <Route path="*" element={<GuestPage />} />
</Routes></AppStateProvider></BrowserRouter></StrictMode>);

