import React, { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useSite } from "@/context/SiteContext";
import { useAuth } from "@/context/AuthContext";
import { KpiCard, SectionTitle, StatusPill } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Calendar, CheckCircle, Trash, PencilSimple } from "@phosphor-icons/react";
import { fmtDate } from "@/lib/helpers";

const EMPTY = { site_id: "", equipment_id: "", title: "", frequency_days: 30, next_due: new Date().toISOString().slice(0, 10), notes: "" };

export default function Maintenance() {
  const { siteId } = useSite();
  const { user } = useAuth();
  const canWrite = user?.role !== "viewer";
  const [tasks, setTasks] = useState([]);
  const [equips, setEquips] = useState([]);
  const [history, setHistory] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);

  async function load() {
    if (!siteId) return;
    try {
      const [t, e, h] = await Promise.all([
        api.get("/maintenance", { params: { site_id: siteId } }),
        api.get("/equipments", { params: { site_id: siteId } }),
        api.get("/maintenance-history", { params: { site_id: siteId } }),
      ]);
      setTasks(t.data); setEquips(e.data); setHistory(h.data);
    } catch (err) {
      toast.error(formatApiError(err));
      setTasks([]); setEquips([]); setHistory([]);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  const now = new Date();
  const enriched = tasks.map((t) => {
    const d = new Date(t.next_due);
    const days = Math.round((d - now) / 86400000);
    const status = days < 0 ? "overdue" : days <= 7 ? "soon" : "ok";
    return { ...t, days, status };
  });

  const kpi = useMemo(() => ({
    total: tasks.length,
    overdue: enriched.filter((t) => t.status === "overdue").length,
    soon: enriched.filter((t) => t.status === "soon").length,
    done: history.length,
  }), [tasks, history]);

  function openCreate() { setForm({ ...EMPTY, site_id: siteId }); setEditId(null); setOpen(true); }
  function openEdit(t) {
    setForm({ site_id: t.site_id, equipment_id: t.equipment_id, title: t.title, frequency_days: t.frequency_days, next_due: t.next_due?.slice(0, 10), notes: t.notes || "" });
    setEditId(t.id); setOpen(true);
  }

  async function save() {
    if (!form.title.trim()) { toast.error("Le titre est requis"); return; }
    if (!form.equipment_id) { toast.error("Sélectionnez un équipement"); return; }
    if (!form.next_due) { toast.error("Prochaine échéance requise"); return; }
    try {
      const payload = { ...form, frequency_days: Number(form.frequency_days), next_due: new Date(form.next_due).toISOString() };
      if (editId) await api.patch(`/maintenance/${editId}`, payload);
      else await api.post("/maintenance", payload);
      toast.success("Enregistré"); setOpen(false); load();
    } catch (e) { toast.error(formatApiError(e)); }
  }
  async function complete(id) {
    try {
      await api.post(`/maintenance/${id}/complete`, { done_at: new Date().toISOString(), notes: "" });
      toast.success("Intervention enregistrée"); load();
    } catch (e) { toast.error(formatApiError(e)); }
  }
  async function remove(id) {
    if (!window.confirm("Supprimer cette tâche ?")) return;
    try {
      await api.delete(`/maintenance/${id}`);
      toast.success("Supprimé"); load();
    } catch (e) { toast.error(formatApiError(e)); }
  }

  const statusPill = (s) =>
    s === "overdue" ? "bg-red-500/10 text-red-400 border-red-500/25"
    : s === "soon" ? "bg-amber-500/10 text-amber-400 border-amber-500/25"
    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/25";

  return (
    <div className="space-y-5" data-testid="maintenance-page">
      <SectionTitle title="Maintenance préventive" subtitle="PLANIFICATION // RÉCURRENCE" right={canWrite && (
        <Button data-testid="new-task-btn" onClick={openCreate} className="rounded-sm bg-emerald-500 hover:bg-emerald-600 text-white"><Plus size={14} className="mr-1.5" />Nouvelle tâche</Button>
      )} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Tâches actives" value={kpi.total} />
        <KpiCard label="En retard" value={kpi.overdue} tone={kpi.overdue ? "bad" : "good"} />
        <KpiCard label="Sous 7 jours" value={kpi.soon} tone={kpi.soon ? "warn" : "good"} />
        <KpiCard label="Interventions" value={kpi.done} tone="good" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel">
          <div className="px-4 py-3 border-b border-white/10 text-[10px] uppercase tracking-widest text-slate-500 font-mono">Tâches planifiées</div>
          <div className="divide-y divide-white/5">
            {enriched.length === 0 && <div className="text-center py-10 text-slate-500 font-mono text-xs">NO_DATA_FOUND</div>}
            {enriched.map((t) => {
              const eq = equips.find((e) => e.id === t.equipment_id);
              return (
                <div key={t.id} data-testid={`task-${t.id}`} className="px-4 py-3 flex items-center gap-3 tr-hover">
                  <Calendar size={20} weight="duotone" className="text-emerald-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-200 font-medium truncate">{t.title}</div>
                    <div className="text-xs text-slate-500 font-mono">{eq?.name || "—"} · toutes les {t.frequency_days}j · prochaine : {fmtDate(t.next_due)}</div>
                  </div>
                  <StatusPill className={statusPill(t.status)}>{t.status === "overdue" ? `retard ${-t.days}j` : t.status === "soon" ? `dans ${t.days}j` : `dans ${t.days}j`}</StatusPill>
                  {canWrite && (
                    <div className="flex items-center gap-1">
                      <button data-testid={`complete-${t.id}`} onClick={() => complete(t.id)} title="Marquer fait" className="p-1.5 rounded-sm hover:bg-white/5 text-emerald-400"><CheckCircle size={16} /></button>
                      <button data-testid={`edit-task-${t.id}`} onClick={() => openEdit(t)} className="p-1.5 rounded-sm hover:bg-white/5 text-slate-400"><PencilSimple size={14} /></button>
                      <button data-testid={`delete-task-${t.id}`} onClick={() => remove(t.id)} className="p-1.5 rounded-sm hover:bg-white/5 text-slate-400 hover:text-red-400"><Trash size={14} /></button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <div className="px-4 py-3 border-b border-white/10 text-[10px] uppercase tracking-widest text-slate-500 font-mono">Historique interventions</div>
          <div className="divide-y divide-white/5 max-h-[500px] overflow-auto">
            {history.length === 0 && <div className="text-center py-10 text-slate-500 font-mono text-xs">NO_DATA_FOUND</div>}
            {history.map((h) => {
              const eq = equips.find((e) => e.id === h.equipment_id);
              return (
                <div key={h.id} className="px-4 py-3 flex items-center gap-3 tr-hover">
                  <CheckCircle size={18} weight="duotone" className="text-emerald-400" />
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-200 truncate">{eq?.name || "—"}</div>
                    <div className="text-xs text-slate-500 font-mono">{fmtDate(h.done_at)} · {h.user_name}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#131C19] border-white/10 text-slate-200 rounded-sm max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? "Modifier tâche" : "Nouvelle tâche"}</DialogTitle>
            <DialogDescription className="text-slate-500 text-xs">Planifiez une intervention préventive récurrente sur un équipement du site sélectionné.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs col-span-2">Titre<Input data-testid="t-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" /></label>
            <label className="text-xs col-span-2">Équipement
              {equips.length === 0 ? (
                <div data-testid="no-equip-warning" className="mt-1 h-9 flex items-center px-3 rounded-sm bg-amber-500/5 border border-amber-500/25 text-amber-300 text-xs">
                  Aucun équipement sur ce site. Créez-en un dans l'onglet Équipement.
                </div>
              ) : (
                <Select value={form.equipment_id || undefined} onValueChange={(v) => setForm({ ...form, equipment_id: v })}>
                  <SelectTrigger data-testid="t-equipment" className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10"><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                  <SelectContent className="bg-[#131C19] border-white/10">{equips.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </label>
            <label className="text-xs">Fréquence (jours)<Input type="number" value={form.frequency_days} onChange={(e) => setForm({ ...form, frequency_days: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" /></label>
            <label className="text-xs">Prochaine échéance<Input type="date" value={form.next_due} onChange={(e) => setForm({ ...form, next_due: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" /></label>
            <label className="text-xs col-span-2">Notes<Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 rounded-sm bg-[#0D1411] border-white/10" /></label>
          </div>
          <DialogFooter>
            <Button onClick={() => setOpen(false)} className="rounded-sm bg-white/5 hover:bg-white/10">Annuler</Button>
            <Button data-testid="save-task" onClick={save} disabled={equips.length === 0 && !editId} className="rounded-sm bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-40">Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
