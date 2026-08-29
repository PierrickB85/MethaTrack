// Digestat thresholds and interpretation.
// Returns { status: 'normal'|'warning'|'critical', label: string, tone }
export function interpretAnalysis(a) {
  const issues = [];
  if (a.ph < 7.0 || a.ph > 8.2) issues.push({ k: "pH", sev: 2 });
  else if (a.ph < 7.2 || a.ph > 8.0) issues.push({ k: "pH", sev: 1 });

  const ratio = a.tac > 0 ? a.agv / a.tac : 0;
  if (ratio > 0.3) issues.push({ k: "AGV/TAC", sev: 2 });
  else if (ratio > 0.2) issues.push({ k: "AGV/TAC", sev: 1 });

  if (a.n_nh4 > 4) issues.push({ k: "N-NH₄⁺", sev: 2 });
  else if (a.n_nh4 > 3) issues.push({ k: "N-NH₄⁺", sev: 1 });

  if (a.ms < 2 || a.ms > 12) issues.push({ k: "MS", sev: 1 });

  const maxSev = issues.reduce((m, i) => Math.max(m, i.sev), 0);
  if (maxSev === 0) return { status: "normal", label: "Stable", ratio };
  if (maxSev === 1) return { status: "warning", label: "À surveiller", ratio, issues };
  return { status: "critical", label: "Risque / instable", ratio, issues };
}

export const STATUS_CLASSES = {
  normal: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  warning: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  critical: "bg-red-500/10 text-red-400 border-red-500/25",
  info: "bg-sky-500/10 text-sky-400 border-sky-500/25",
};

export const SEVERITY_CLASSES = {
  faible: "bg-sky-500/10 text-sky-400 border-sky-500/25",
  moyenne: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  critique: "bg-red-500/10 text-red-400 border-red-500/25",
};

export const FAILURE_STATUS = {
  ouvert: "bg-red-500/10 text-red-400 border-red-500/25",
  en_cours: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  resolu: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
};

export function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return iso; }
}

export function fmtDateTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

export function fmtEuro(n) {
  return `${Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
}
