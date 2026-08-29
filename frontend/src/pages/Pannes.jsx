import React, { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useSite } from "@/context/SiteContext";
import { useAuth } from "@/context/AuthContext";
import { KpiCard, SectionTitle, StatusPill } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash, PencilSimple, Warning, MagnifyingGlass } from "@phosphor-icons/react";
import { SEVERITY_CLASSES, FAILURE_STATUS, fmtDate, fmtEuro } from "@/lib/helpers";

const EMPTY = {
  site_id: "", equipment_id: "", date: new Date().toISOString().slice(0, 10),
  type: "Mécanique", severity: "moyenne", status: "ouvert",
  description: "", cause: "", action: "", duration_hours: 0, cost: 0, responsible: "",
  parts_used: [],
};

const TYPES = ["Mécanique", "Électrique", "Process", "Sécurité", "Autre"];

export default function Pannes() {
  const { siteId } = useSite();
  const { user } = useAuth();
  const canWrite = user?.role !== "viewer";
  const [items, setItems] = useState([]);
  const [equips, setEquips] = useState([]);
  const [parts, setParts] = useState([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);

  async function load() {
    if (!siteId) return;
    try {
      const params = { site_id: siteId };
      if (status !== "all") params.status = status;
      if (severity !== "all") params.severity = severity;
      const [f, e, p] = await Promise.all([
        api.get("/failures", { params }),
        api.get("/equipments", { params: { site_id: siteId } }),
        api.get("/parts", { params: { site_id: siteId } }),
      ]);
      setItems(f.data); setEquips(e.data); setParts(p.data);
    } catch (err) {
      toast.error(formatApiError(err));
      setItems([]); setEquips([]); setParts([]);
    }
  }
  useEffect(() => {
    setItems([]); setEquips([]); setParts([]);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, status, severity]);

  const filtered = useMemo(() => {
    const t = q.toLowerCase().trim();
    if (!t) return items;
    return items.filter((i) => [i.description, i.cause, i.action, i.responsible].join(" ").toLowerCase().includes(t));
  }, [items, q]);

  const kpi = useMemo(() => ({
    total: items.length,
    open: items.filter((i) => i.status !== "resolu").length,
    critical: items.filter((i) => i.severity === "critique").length,
    cost: items.reduce((s, i) => s + Number(i.cost || 0), 0),
  }), [items]);

  function openCreate() {
    setForm({ ...EMPTY, site_id: siteId });
    setEditId(null); setOpen(true);
  }
  function openEdit(f) {
    setForm({
      site_id: f.site_id, equipment_id: f.equipment_id,
      date: f.date?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      type: f.type, severity: f.severity, status: f.status,
      description: f.description || "", cause: f.cause || "", action: f.action || "",
      duration_hours: f.duration_hours || 0, cost: f.cost || 0, responsible: f.responsible || "",
      parts_used: f.parts_used || [],
    });
    setEditId(f.id); setOpen(true);
  }

  async function save() {
    try {
      const payload = { ...form, date: new Date(form.date).toISOString(), duration_hours: Number(form.duration_hours), cost: Number(form.cost) };
      if (editId) await api.patch(`/failures/${editId}`, payload);
      else await api.post("/failures", payload);
      toast.success(editId ? "Panne mise à jour" : "Panne créée");
      setOpen(false); load();
    } catch (e) { toast.error(formatApiError(e)); }
  }
  async function remove(id) {
    if (!window.confirm("Supprimer cette panne ?")) return;
    await api.delete(`/failures/${id}`); toast.success("Supprimé"); load();
  }
  function addPart() {
    setForm((f) => ({ ...f, parts_used: [...f.parts_used, { part_id: parts[0]?.id || "", quantity: 1 }] }));
  }
  function updatePart(idx, k, v) {
    setForm((f) => {
      const list = [...f.parts_used]; list[idx] = { ...list[idx], [k]: v }; return { ...f, parts_used: list };
    });
  }
  function removePart(idx) {
    setForm((f) => ({ ...f, parts_used: f.parts_used.filter((_, i) => i !== idx) }));
  }

  return (
    <div className="space-y-5" data-testid="pannes-page">
      <SectionTitle
        title="Pannes"
        subtitle="INCIDENTS // JOURNAL D'INTERVENTION"
        right={canWrite && (
          <Button data-testid="new-panne-btn" onClick={openCreate} className="rounded-sm bg-emerald-500 hover:bg-emerald-600 text-white">
            <Plus size={14} className="mr-1.5" /> Nouvelle panne
          </Button>
        )}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total pannes" value={kpi.total} testid="kpi-total" />
        <KpiCard label="Ouvertes" value={kpi.open} tone={kpi.open ? "bad" : "good"} testid="kpi-open" />
        <KpiCard label="Critiques" value={kpi.critical} tone={kpi.critical ? "bad" : "good"} testid="kpi-critical" />
        <KpiCard label="Coût cumulé" value={fmtEuro(kpi.cost)} testid="kpi-costsum" />
      </div>

      <div className="panel p-3 flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input data-testid="search-input" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)}
                 className="pl-8 h-9 rounded-sm bg-[#0D1411] border-white/10" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger data-testid="filter-status" className="w-[180px] h-9 rounded-sm bg-[#0D1411] border-white/10"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-[#131C19] border-white/10">
            <SelectItem value="all">Tous statuts</SelectItem>
            <SelectItem value="ouvert">Ouvert</SelectItem>
            <SelectItem value="en_cours">En cours</SelectItem>
            <SelectItem value="resolu">Résolu</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger data-testid="filter-severity" className="w-[180px] h-9 rounded-sm bg-[#0D1411] border-white/10"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-[#131C19] border-white/10">
            <SelectItem value="all">Toutes gravités</SelectItem>
            <SelectItem value="faible">Faible</SelectItem>
            <SelectItem value="moyenne">Moyenne</SelectItem>
            <SelectItem value="critique">Critique</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-slate-500 border-b border-white/10">
                <th className="py-2.5 px-3 text-left">Date</th>
                <th className="px-3 text-left">Équipement</th>
                <th className="px-3 text-left">Type</th>
                <th className="px-3 text-left">Gravité</th>
                <th className="px-3 text-left">Statut</th>
                <th className="px-3 text-left">Description</th>
                <th className="px-3 text-right">Durée</th>
                <th className="px-3 text-right">Coût</th>
                <th className="px-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="text-center py-10 text-slate-500 font-mono text-xs">NO_DATA_FOUND</td></tr>
              )}
              {filtered.map((f) => {
                const eq = equips.find((e) => e.id === f.equipment_id);
                return (
                  <tr key={f.id} data-testid={`panne-row-${f.id}`} className="tr-hover border-b border-white/5">
                    <td className="py-2 px-3 font-mono text-xs text-slate-300">{fmtDate(f.date)}</td>
                    <td className="px-3">{eq?.name || <span className="text-slate-500">—</span>}</td>
                    <td className="px-3 text-slate-400">{f.type}</td>
                    <td className="px-3"><StatusPill className={SEVERITY_CLASSES[f.severity]}>{f.severity}</StatusPill></td>
                    <td className="px-3"><StatusPill className={FAILURE_STATUS[f.status]}>{f.status.replace("_", " ")}</StatusPill></td>
                    <td className="px-3 max-w-[280px] truncate text-slate-300">{f.description}</td>
                    <td className="px-3 text-right font-mono text-xs">{Number(f.duration_hours || 0).toFixed(1)}h</td>
                    <td className="px-3 text-right font-mono text-xs">{fmtEuro(f.cost)}</td>
                    <td className="px-3 text-right">
                      {canWrite && (
                        <div className="flex justify-end gap-1">
                          <button data-testid={`edit-${f.id}`} onClick={() => openEdit(f)} className="p-1.5 rounded-sm hover:bg-white/5 text-slate-400 hover:text-emerald-300"><PencilSimple size={14} /></button>
                          <button data-testid={`del-${f.id}`} onClick={() => remove(f.id)} className="p-1.5 rounded-sm hover:bg-white/5 text-slate-400 hover:text-red-400"><Trash size={14} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#131C19] border-white/10 text-slate-200 max-w-2xl rounded-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Warning size={18} className="text-emerald-400" />{editId ? "Modifier la panne" : "Nouvelle panne"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs col-span-1">Date
              <Input data-testid="f-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" />
            </label>
            <label className="text-xs col-span-1">Équipement
              <Select value={form.equipment_id} onValueChange={(v) => setForm({ ...form, equipment_id: v })}>
                <SelectTrigger data-testid="f-equip" className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10"><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                <SelectContent className="bg-[#131C19] border-white/10">
                  {equips.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="text-xs">Type
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#131C19] border-white/10">{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="text-xs">Gravité
              <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
                <SelectTrigger className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#131C19] border-white/10">
                  <SelectItem value="faible">Faible</SelectItem><SelectItem value="moyenne">Moyenne</SelectItem><SelectItem value="critique">Critique</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="text-xs">Statut
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#131C19] border-white/10">
                  <SelectItem value="ouvert">Ouvert</SelectItem><SelectItem value="en_cours">En cours</SelectItem><SelectItem value="resolu">Résolu</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="text-xs">Responsable
              <Input value={form.responsible} onChange={(e) => setForm({ ...form, responsible: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" />
            </label>
            <label className="text-xs col-span-2">Description
              <Textarea data-testid="f-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 rounded-sm bg-[#0D1411] border-white/10" />
            </label>
            <label className="text-xs col-span-2">Cause
              <Textarea value={form.cause} onChange={(e) => setForm({ ...form, cause: e.target.value })} className="mt-1 rounded-sm bg-[#0D1411] border-white/10" />
            </label>
            <label className="text-xs col-span-2">Action corrective
              <Textarea value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} className="mt-1 rounded-sm bg-[#0D1411] border-white/10" />
            </label>
            <label className="text-xs">Durée d'arrêt (h)
              <Input type="number" step="0.1" value={form.duration_hours} onChange={(e) => setForm({ ...form, duration_hours: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" />
            </label>
            <label className="text-xs">Coût (€)
              <Input type="number" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" />
            </label>

            {!editId && (
              <div className="col-span-2 border border-white/10 rounded-sm p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-slate-400">Pièces utilisées (sortie stock automatique)</div>
                  <Button type="button" onClick={addPart} className="h-7 rounded-sm bg-white/5 hover:bg-white/10 text-slate-200 text-xs"><Plus size={12} className="mr-1" />Ajouter</Button>
                </div>
                {form.parts_used.length === 0 && <div className="text-xs text-slate-600 font-mono">Aucune pièce</div>}
                {form.parts_used.map((pu, i) => (
                  <div key={i} className="grid grid-cols-[1fr_100px_auto] gap-2 mb-1">
                    <Select value={pu.part_id} onValueChange={(v) => updatePart(i, "part_id", v)}>
                      <SelectTrigger className="h-8 rounded-sm bg-[#0D1411] border-white/10 text-xs"><SelectValue placeholder="Pièce" /></SelectTrigger>
                      <SelectContent className="bg-[#131C19] border-white/10">
                        {parts.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.quantity} dispo)</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input type="number" step="0.5" value={pu.quantity} onChange={(e) => updatePart(i, "quantity", Number(e.target.value))} className="h-8 rounded-sm bg-[#0D1411] border-white/10 text-xs" />
                    <button onClick={() => removePart(i)} className="text-slate-500 hover:text-red-400"><Trash size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setOpen(false)} className="rounded-sm bg-white/5 hover:bg-white/10 text-slate-200">Annuler</Button>
            <Button data-testid="save-panne" onClick={save} className="rounded-sm bg-emerald-500 hover:bg-emerald-600 text-white">Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
