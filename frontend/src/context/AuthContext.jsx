import React, { createContext, useContext, useEffect, useState } from "react";
import { api, setToken, getToken, formatApiError } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = loading, false = anon, obj = user
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!getToken()) {
        if (!cancel) setUser(false);
        return;
      }
      try {
        const { data } = await api.get("/auth/me");
        if (!cancel) setUser(data);
      } catch (_e) {
        setToken(null);
        if (!cancel) setUser(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  async function login(email, password) {
    setError("");
    try {
      const { data } = await api.post("/auth/login", { email, password });
      setToken(data.token);
      setUser(data);
      return true;
    } catch (e) {
      setError(formatApiError(e));
      return false;
    }
  }

  async function logout() {
    try { await api.post("/auth/logout"); } catch (_e) { /* ignore */ }
    setToken(null);
    setUser(false);
  }

  return (
    <AuthContext.Provider value={{ user, setUser, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
