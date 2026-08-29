import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const SiteContext = createContext(null);

export function SiteProvider({ children }) {
  const { user } = useAuth();
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState(localStorage.getItem("mt_site") || "");

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
  }, [user]);

  function selectSite(id) {
    setSiteId(id);
    localStorage.setItem("mt_site", id);
  }

  return (
    <SiteContext.Provider value={{ sites, siteId, selectSite, setSites }}>
      {children}
    </SiteContext.Provider>
  );
}

export const useSite = () => useContext(SiteContext);
