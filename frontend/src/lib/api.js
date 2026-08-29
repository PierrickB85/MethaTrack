import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

let _token = localStorage.getItem("mt_token") || null;

export function setToken(t) {
  _token = t;
  if (t) localStorage.setItem("mt_token", t);
  else localStorage.removeItem("mt_token");
}

export function getToken() {
  return _token;
}

api.interceptors.request.use((config) => {
  if (_token) config.headers.Authorization = `Bearer ${_token}`;
  return config;
});

export function formatApiError(err) {
  const d = err?.response?.data?.detail;
  if (!d) return err?.message || "Erreur inattendue";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => (e?.msg ? e.msg : JSON.stringify(e))).join(" ");
  if (d?.msg) return d.msg;
  return String(d);
}

export function fileUrl(path) {
  return `${API}/files/${path}?auth=${encodeURIComponent(_token || "")}`;
}
