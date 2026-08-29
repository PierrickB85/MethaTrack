import React, { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useSite } from "@/context/SiteContext";
import { useAuth } from "@/context/AuthContext";
import { KpiCard, SectionTitle, StatusPill } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, TestTube, Trash, PencilSimple } from "@phosphor-icons/react";
import { interpretAnalysis, STATUS_CLASSES, fmtDate } from "@/lib/helpers";

const EMPTY = {
  site_id: "", date: new Date().toISOString().slice(0, 10),
  ph: 7.6, ms: 4.5, mo: 65, agv: 1.2, tac: 12, n_nh4: 2, n_total: 4.5, p2o5: 1.5, k2o: 3, notes: "",
};

const FIELDS = [
  ["ph", "pH", ""], ["ms", "MS", "%"], ["mo", "MO", "%"],
  ["agv", "AGV", "g/L"], ["tac", "TAC", "g/L"],
  ["n_nh4", "N-NH₄⁺", "g/L"], ["n_total", "N total", "g/L"],
  ["p2o5", "P₂O₅", "g/L"], ["k2o", "K₂O", "g/L"],
];

export default function Analyses() {
  const { siteId } = useSite();
  const { user } = useAuth();
  const canWrite = user?.role !== "viewer";
  const [items, setItems] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);

  async function load() {
    if (!siteId) return;
    const { data } = await api.get("/analyses", { params: { site_id: siteId } });
    setItems(data);
  }
  useEffect(() => { load(); }, [siteId]);

  const enriched = useMemo(() => items.map((a) => ({ ...a, interp: interpretAnalysis(a) })), [items]);
  const filtered = statusFilter === "all" ? enriched : enriched.filter((a) => a.interp.status === statusFilter);

  const kpi = useMemo(() => ({
    total: enriched.length,
    normal: enriched.filter((a) => a.interp.status === "normal").length,
    warn: enriched.filter((a) => a.interp.status === "warning").length,
    crit: enriched.filter((a) => a.interp.status === "critical").length,
  }), [enriched]);

  function openCreate() { setForm({ ...EMPTY, site_id: siteId }); setEditId(null); setOpen(true); }
  function openEdit(a) {
    setForm({ ...a, date: a.date?.slice(0, 10), site_id: a.site_id }); setEditId(a.id); setOpen(true);
  }
  async function save() {
    try {
      const payload = { ...form, date: new Date(form.date).toISOString() };
      for (const [k] of FIELDS) payload[k] = Number(payload[k]);
      if (editId) await api.patch(`/analyses/${editId}`, payload);
      else await api.post("/analyses", payload);
      toast.success("Enregistré"); setOpen(false); load();
    } catch (e) { toast.error(formatApiError(e)); }
  }
  async function remove(id) {
    if (!confirm("Supprimer cette analyse ?")) return;
    await api.delete(`/analyses/${id}`); toast.success("Supprimé"); load();
  }

  return (
    <div className="space-y-5" data-testid="analyses-page">
      <SectionTitle title="Analyses digestat" subtitle="LABORATOIRE // INTERPRÉTATION AUTO" right={canWrite && (
        <Button data-testid="new-analysis-btn" onClick={openCreate} className="rounded-sm bg-emerald-500 hover:bg-emerald-600 text-white"><Plus size={14} className="mr-1.5" />Nouvelle analyse</Button>
      )} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total" value={kpi.total} />
        <KpiCard label="Stables" value={kpi.normal} tone="good" />
        <KpiCard label="À surveiller" value={kpi.warn} tone="warn" />
        <KpiCard label="Risque/instable" value={kpi.crit} tone={kpi.crit ? "bad" : "good"} />
      </div>

      <div className="panel p-3 flex gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger data-testid="filter-interp" className="w-[200px] h-9 rounded-sm bg-[#0D1411] border-white/10"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-[#131C19] border-white/10">
            <SelectItem value="all">Toutes interprétations</SelectItem>
            <SelectItem value="normal">Stable</SelectItem>
            <SelectItem value="warning">À surveiller</SelectItem>
            <SelectItem value="critical">Risque / instable</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[10px] uppercase tracking-widest text-slate-500 border-b border-white/10">
              <th className="py-2.5 px-3 text-left">Date</th>
              <th className="px-3 text-left">Interprétation</th>
              {FIELDS.map(([k, l]) => <th key={k} className="px-3 text-right">{l}</th>)}
              <th className="px-3 text-right">AGV/TAC</th>
              <th className="px-3"></th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={13} className="text-center py-10 text-slate-500 font-mono text-xs">NO_DATA_FOUND</td></tr>}
              {filtered.map((a) => (
                <tr key={a.id} data-testid={`analysis-row-${a.id}`} className="tr-hover border-b border-white/5">
                  <td className="py-2 px-3 font-mono text-xs text-slate-300">{fmtDate(a.date)}</td>
                  <td className="px-3"><StatusPill className={STATUS_CLASSES[a.interp.status]}>{a.interp.label}</StatusPill></td>
                  {FIELDS.map(([k]) => <td key={k} className="px-3 text-right font-mono text-xs">{Number(a[k]).toFixed(2)}</td>)}
                  <td className="px-3 text-right font-mono text-xs">{a.interp.ratio.toFixed(2)}</td>
                  <td className="px-3 text-right">
                    {canWrite && (
                      <div className="flex justify-end gap-1">
                        <button data-testid={`edit-${a.id}`} onClick={() => openEdit(a)} className="p-1.5 rounded-sm hover:bg-white/5 text-slate-400 hover:text-emerald-300"><PencilSimple size={14} /></button>
                        <button data-testid={`del-${a.id}`} onClick={() => remove(a.id)} className="p-1.5 rounded-sm hover:bg-white/5 text-slate-400 hover:text-red-400"><Trash size={14} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#131C19] border-white/10 text-slate-200 rounded-sm max-w-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><TestTube size={18} className="text-emerald-400" />{editId ? "Modifier analyse" : "Nouvelle analyse"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            <label className="text-xs col-span-3">Date<Input data-testid="a-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" /></label>
            {FIELDS.map(([k, l, u]) => (
              <label key={k} className="text-xs">{l} <span className="text-slate-500">{u}</span>
                <Input data-testid={`a-${k}`} type="number" step="0.01" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10 font-mono" />
              </label>
            ))}
            <label className="text-xs col-span-3">Notes<Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 rounded-sm bg-[#0D1411] border-white/10" /></label>
          </div>
          <DialogFooter>
            <Button onClick={() => setOpen(false)} className="rounded-sm bg-white/5 hover:bg-white/10">Annuler</Button>
            <Button data-testid="save-analysis" onClick={save} className="rounded-sm bg-emerald-500 hover:bg-emerald-600 text-white">Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
