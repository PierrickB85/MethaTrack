import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useSite } from "@/context/SiteContext";
import { KpiCard, SectionTitle } from "@/components/Layout";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from "recharts";
import { fmtDate, fmtEuro } from "@/lib/helpers";

const CHART_GREEN = "#10b981";
const CHART_RED = "#ef4444";
const CHART_AMBER = "#f59e0b";

function ChartCard({ title, subtitle, children, testid }) {
  return (
    <div className="panel p-4" data-testid={testid}>
      <div className="mb-2">
        <div className="text-[10px] tracking-[0.25em] uppercase text-emerald-400/70 font-mono">{subtitle}</div>
        <div className="text-slate-100 font-semibold">{title}</div>
      </div>
      <div className="h-64">{children}</div>
    </div>
  );
}

export default function Dashboard() {
  const { siteId } = useSite();
  const [sum, setSum] = useState(null);
  const [analyses, setAnalyses] = useState([]);
  const [failures, setFailures] = useState([]);

  useEffect(() => {
    if (!siteId) return;
    (async () => {
      try {
        const [s, a, f] = await Promise.all([
          api.get("/dashboard/summary", { params: { site_id: siteId } }),
          api.get("/analyses", { params: { site_id: siteId } }),
          api.get("/failures", { params: { site_id: siteId } }),
        ]);
        setSum(s.data);
        setAnalyses([...a.data].reverse());
        setFailures(f.data);
      } catch (err) {
        setSum({ equipments: 0, failures_total: 0, failures_open: 0, failures_critical: 0, cost_total: 0, stock_value: 0, low_stock_count: 0 });
        setAnalyses([]); setFailures([]);
      }
    })();
  }, [siteId]);

  const analysisSeries = analyses.map((a) => ({
    date: fmtDate(a.date),
    pH: Number(a.ph).toFixed(2),
    "AGV/TAC": a.tac > 0 ? Number((a.agv / a.tac).toFixed(3)) : 0,
    "N-NH₄⁺": Number(a.n_nh4),
  }));

  const failuresByType = Object.values(
    failures.reduce((acc, f) => {
      const k = f.type || "Autre";
      acc[k] = acc[k] || { type: k, count: 0, cost: 0 };
      acc[k].count += 1;
      acc[k].cost += Number(f.cost || 0);
      return acc;
    }, {})
  );

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      <SectionTitle title="Dashboard" subtitle="VUE D'ENSEMBLE // MULTI-SITES" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard testid="kpi-equipments" label="Équipements" value={sum?.equipments ?? "—"} hint="unités suivies" />
        <KpiCard testid="kpi-open-failures" label="Pannes ouvertes" value={sum?.failures_open ?? "—"} tone={sum?.failures_open ? "bad" : "good"} hint={`${sum?.failures_critical || 0} critique(s)`} />
        <KpiCard testid="kpi-cost" label="Coûts pannes" value={fmtEuro(sum?.cost_total)} hint="cumul historique" />
        <KpiCard testid="kpi-stock" label="Valeur stock" value={fmtEuro(sum?.stock_value)} tone={sum?.low_stock_count ? "warn" : "good"} hint={`${sum?.low_stock_count || 0} alerte(s) seuil`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard testid="chart-ph-agv" title="Évolution pH et AGV/TAC" subtitle="ANALYSES DIGESTAT">
          <ResponsiveContainer>
            <LineChart data={analysisSeries} margin={{ left: -10, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
              <YAxis yAxisId="l" stroke="#94a3b8" fontSize={11} />
              <YAxis yAxisId="r" orientation="right" stroke="#94a3b8" fontSize={11} />
              <Tooltip contentStyle={{ background: "#131C19", border: "1px solid #ffffff20", borderRadius: 2, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
              <Line yAxisId="l" type="monotone" dataKey="pH" stroke={CHART_GREEN} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              <Line yAxisId="r" type="monotone" dataKey="AGV/TAC" stroke={CHART_AMBER} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard testid="chart-failures-type" title="Pannes par type" subtitle="FRÉQUENCE & COÛT">
          <ResponsiveContainer>
            <BarChart data={failuresByType} margin={{ left: -10, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="type" stroke="#94a3b8" fontSize={11} />
              <YAxis yAxisId="left" stroke="#94a3b8" fontSize={11} />
              <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" fontSize={11} />
              <Tooltip contentStyle={{ background: "#131C19", border: "1px solid #ffffff20", borderRadius: 2, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
              <Bar yAxisId="left" dataKey="count" name="Nb pannes" fill={CHART_GREEN} radius={[2, 2, 0, 0]} isAnimationActive={false} />
              <Bar yAxisId="right" dataKey="cost" name="Coût (€)" fill={CHART_RED} radius={[2, 2, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}
