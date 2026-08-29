import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const SiteContext = createContext(null);

export function SiteProvider({ children }) {
  const { user } = useAuth();
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState(localStorage.getItem("mt_site") || "");
  const pendingRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data } = await api.get("/sites");
        setSites(data);
        if (!siteId && data.length > 0) {
          setSiteId(data[0].id);
          localStorage.setItem("mt_site", data[0].id);
        }
      } catch (_e) { /* ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Clean up any pending deferred site-change on unmount to avoid setState-after-unmount
  useEffect(() => () => { if (pendingRef.current) clearTimeout(pendingRef.current); }, []);

  const selectSite = useCallback((id) => {
    if (!id || id === siteId) return;
    localStorage.setItem("mt_site", id);
    // Defer setState ≥ Radix Select close animation (~150ms) so its portal fully
    // unmounts before dependent components re-render. Prevents removeChild NotFoundError.
    if (pendingRef.current) clearTimeout(pendingRef.current);
    pendingRef.current = setTimeout(() => {
      pendingRef.current = null;
      setSiteId(id);
    }, 200);
  }, [siteId]);

  const value = useMemo(() => ({ sites, siteId, selectSite, setSites }), [sites, siteId, selectSite]);

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

export const useSite = () => useContext(SiteContext);
