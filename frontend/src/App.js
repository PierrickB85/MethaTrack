import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { SiteProvider } from "@/context/SiteContext";
import Login from "@/pages/Login";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Pannes from "@/pages/Pannes";
import Equipements from "@/pages/Equipements";
import Stock from "@/pages/Stock";
import Analyses from "@/pages/Analyses";
import Maintenance from "@/pages/Maintenance";
import Admin from "@/pages/Admin";

function Protected({ children }) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="min-h-screen grid place-items-center text-slate-500 font-mono text-xs">
        LOADING…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AdminOnly({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <SiteProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <Protected>
                  <Layout />
                </Protected>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="pannes" element={<Pannes />} />
              <Route path="equipements" element={<Equipements />} />
              <Route path="stock" element={<Stock />} />
              <Route path="analyses" element={<Analyses />} />
              <Route path="maintenance" element={<Maintenance />} />
              <Route path="admin" element={<AdminOnly><Admin /></AdminOnly>} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Routes>
        </SiteProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}
