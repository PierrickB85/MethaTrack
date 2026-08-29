import React, { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useSite } from "@/context/SiteContext";
import { useAuth } from "@/context/AuthContext";
import { KpiCard, SectionTitle, StatusPill } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Package, ArrowsClockwise, PencilSimple, Trash } from "@phosphor-icons/react";
import { fmtEuro, fmtDateTime } from "@/lib/helpers";

const EMPTY = { site_id: "", name: "", sku: "", quantity: 0, threshold: 0, price: 0, supplier: "", location: "" };

export default function Stock() {
  const { siteId } = useSite();
  const { user } = useAuth();
  const canWrite = user?.role !== "viewer";
  const [parts, setParts] = useState([]);
  const [moves, setMoves] = useState([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [moveForm, setMoveForm] = useState({ part_id: "", kind: "entree", quantity: 1, reason: "" });

  async function load() {
    if (!siteId) return;
    try {
      const [p, m] = await Promise.all([
        api.get("/parts", { params: { site_id: siteId } }),
        api.get("/stock-movements", { params: { site_id: siteId } }),
      ]);
      setParts(p.data); setMoves(m.data);
    } catch (err) {
      toast.error(formatApiError(err));
      setParts([]); setMoves([]);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  const filtered = useMemo(() => {
    const t = q.toLowerCase().trim();
    if (!t) return parts;
    return parts.filter((p) => [p.name, p.sku, p.supplier, p.location].join(" ").toLowerCase().includes(t));
  }, [parts, q]);

  const kpi = useMemo(() => ({
    total: parts.length,
    low: parts.filter((p) => Number(p.quantity) <= Number(p.threshold)).length,
    value: parts.reduce((s, p) => s + Number(p.quantity) * Number(p.price), 0),
    moves: moves.length,
  }), [parts, moves]);

  function openCreate() { setForm({ ...EMPTY, site_id: siteId }); setEditId(null); setOpen(true); }
  function openEdit(p) { setForm({ site_id: p.site_id, name: p.name, sku: p.sku, quantity: p.quantity, threshold: p.threshold, price: p.price, supplier: p.supplier || "", location: p.location || "" }); setEditId(p.id); setOpen(true); }
  async function save() {
    try {
      const payload = { ...form, quantity: Number(form.quantity), threshold: Number(form.threshold), price: Number(form.price) };
      if (editId) await api.patch(`/parts/${editId}`, payload);
      else await api.post("/parts", payload);
      toast.success("Enregistré"); setOpen(false); load();
    } catch (e) { toast.error(formatApiError(e)); }
  }
  async function remove(id) {
    if (!confirm("Supprimer cette pièce ?")) return;
    await api.delete(`/parts/${id}`); toast.success("Supprimé"); load();
  }
  function openMove(part) {
    setMoveForm({ part_id: part.id, kind: "entree", quantity: 1, reason: "" }); setMoveOpen(true);
  }
  async function saveMove() {
    try {
      await api.post("/stock-movements", { ...moveForm, quantity: Number(moveForm.quantity) });
      toast.success("Mouvement enregistré"); setMoveOpen(false); load();
    } catch (e) { toast.error(formatApiError(e)); }
  }

  return (
    <div className="space-y-5" data-testid="stock-page">
      <SectionTitle title="Stock" subtitle="PIÈCES DÉTACHÉES // JOURNAL MOUVEMENTS" right={canWrite && (
        <Button data-testid="new-part-btn" onClick={openCreate} className="rounded-sm bg-emerald-500 hover:bg-emerald-600 text-white"><Plus size={14} className="mr-1.5" />Nouvelle pièce</Button>
      )} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Références" value={kpi.total} testid="kpi-refs" />
        <KpiCard label="Sous seuil" value={kpi.low} tone={kpi.low ? "warn" : "good"} testid="kpi-low" />
        <KpiCard label="Valorisation" value={fmtEuro(kpi.value)} testid="kpi-value" />
        <KpiCard label="Mouvements" value={kpi.moves} testid="kpi-moves" />
      </div>

      <Tabs defaultValue="parts" className="w-full">
        <TabsList data-testid="stock-tabs" className="bg-transparent border-b border-white/10 rounded-none w-full justify-start p-0 h-auto">
          <TabsTrigger value="parts" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-emerald-500 data-[state=active]:text-emerald-300 rounded-none px-4 py-2 text-slate-400">Références</TabsTrigger>
          <TabsTrigger value="moves" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-emerald-500 data-[state=active]:text-emerald-300 rounded-none px-4 py-2 text-slate-400">Journal des mouvements</TabsTrigger>
        </TabsList>

        <TabsContent value="parts" className="mt-4">
          <div className="panel p-3 mb-3"><Input placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 rounded-sm bg-[#0D1411] border-white/10" /></div>
          <div className="panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-[10px] uppercase tracking-widest text-slate-500 border-b border-white/10">
                  <th className="py-2.5 px-3 text-left">SKU</th><th className="px-3 text-left">Nom</th>
                  <th className="px-3 text-right">Stock</th><th className="px-3 text-right">Seuil</th>
                  <th className="px-3 text-right">Prix</th><th className="px-3 text-right">Valeur</th>
                  <th className="px-3 text-left">Fournisseur</th><th className="px-3 text-left">Empl.</th>
                  <th className="px-3"></th>
                </tr></thead>
                <tbody>
                  {filtered.length === 0 && <tr><td colSpan={9} className="text-center py-10 text-slate-500 font-mono text-xs">NO_DATA_FOUND</td></tr>}
                  {filtered.map((p) => {
                    const low = Number(p.quantity) <= Number(p.threshold);
                    return (
                      <tr key={p.id} data-testid={`part-row-${p.id}`} className="tr-hover border-b border-white/5">
                        <td className="py-2 px-3 font-mono text-xs text-emerald-300/80">{p.sku}</td>
                        <td className="px-3 text-slate-200">{p.name}</td>
                        <td className="px-3 text-right"><StatusPill className={low ? "bg-red-500/10 text-red-400 border-red-500/25" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"}>{p.quantity}</StatusPill></td>
                        <td className="px-3 text-right font-mono text-xs text-slate-400">{p.threshold}</td>
                        <td className="px-3 text-right font-mono text-xs">{fmtEuro(p.price)}</td>
                        <td className="px-3 text-right font-mono text-xs">{fmtEuro(Number(p.quantity) * Number(p.price))}</td>
                        <td className="px-3 text-slate-400 text-xs">{p.supplier || "—"}</td>
                        <td className="px-3 text-slate-400 text-xs">{p.location || "—"}</td>
                        <td className="px-3 text-right">
                          {canWrite && (
                            <div className="flex justify-end gap-1">
                              <button data-testid={`move-${p.id}`} onClick={() => openMove(p)} title="Mouvement" className="p-1.5 rounded-sm hover:bg-white/5 text-emerald-400"><ArrowsClockwise size={14} /></button>
                              <button onClick={() => openEdit(p)} className="p-1.5 rounded-sm hover:bg-white/5 text-slate-400 hover:text-emerald-300"><PencilSimple size={14} /></button>
                              <button onClick={() => remove(p.id)} className="p-1.5 rounded-sm hover:bg-white/5 text-slate-400 hover:text-red-400"><Trash size={14} /></button>
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
        </TabsContent>

        <TabsContent value="moves" className="mt-4">
          <div className="panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-[10px] uppercase tracking-widest text-slate-500 border-b border-white/10">
                  <th className="py-2.5 px-3 text-left">Date</th><th className="px-3 text-left">Pièce</th>
                  <th className="px-3 text-left">Type</th><th className="px-3 text-right">Qté</th>
                  <th className="px-3 text-left">Motif</th><th className="px-3 text-left">Utilisateur</th>
                </tr></thead>
                <tbody>
                  {moves.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-500 font-mono text-xs">NO_DATA_FOUND</td></tr>}
                  {moves.map((m) => {
                    const part = parts.find((p) => p.id === m.part_id);
                    const tone = m.kind === "entree" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                      : m.kind === "sortie" ? "bg-amber-500/10 text-amber-400 border-amber-500/25"
                      : "bg-sky-500/10 text-sky-400 border-sky-500/25";
                    return (
                      <tr key={m.id} data-testid={`move-row-${m.id}`} className="tr-hover border-b border-white/5">
                        <td className="py-2 px-3 font-mono text-xs">{fmtDateTime(m.date)}</td>
                        <td className="px-3">{part?.name || <span className="font-mono text-slate-500">{m.part_id}</span>}</td>
                        <td className="px-3"><StatusPill className={tone}>{m.kind}</StatusPill></td>
                        <td className="px-3 text-right font-mono">{m.quantity}</td>
                        <td className="px-3 text-slate-400">{m.reason || "—"}</td>
                        <td className="px-3 text-slate-400 text-xs">{m.user_name}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Part create/edit */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#131C19] border-white/10 text-slate-200 rounded-sm max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Package size={18} className="text-emerald-400" />{editId ? "Modifier pièce" : "Nouvelle pièce"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs col-span-2">Nom<Input data-testid="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" /></label>
            <label className="text-xs">SKU<Input data-testid="p-sku" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" /></label>
            <label className="text-xs">Emplacement<Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" /></label>
            <label className="text-xs">Quantité<Input type="number" step="0.5" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" /></label>
            <label className="text-xs">Seuil alerte<Input type="number" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" /></label>
            <label className="text-xs">Prix (€)<Input type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" /></label>
            <label className="text-xs">Fournisseur<Input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" /></label>
          </div>
          <DialogFooter>
            <Button onClick={() => setOpen(false)} className="rounded-sm bg-white/5 hover:bg-white/10">Annuler</Button>
            <Button data-testid="save-part" onClick={save} className="rounded-sm bg-emerald-500 hover:bg-emerald-600 text-white">Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Movement */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="bg-[#131C19] border-white/10 text-slate-200 rounded-sm max-w-md">
          <DialogHeader><DialogTitle>Nouveau mouvement stock</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs col-span-2">Pièce
              <Select value={moveForm.part_id} onValueChange={(v) => setMoveForm({ ...moveForm, part_id: v })}>
                <SelectTrigger className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#131C19] border-white/10">{parts.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.quantity})</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="text-xs">Type
              <Select value={moveForm.kind} onValueChange={(v) => setMoveForm({ ...moveForm, kind: v })}>
                <SelectTrigger data-testid="move-kind" className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#131C19] border-white/10">
                  <SelectItem value="entree">Entrée</SelectItem><SelectItem value="sortie">Sortie</SelectItem><SelectItem value="ajustement">Ajustement (±)</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="text-xs">Quantité<Input data-testid="move-qty" type="number" step="0.5" value={moveForm.quantity} onChange={(e) => setMoveForm({ ...moveForm, quantity: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" /></label>
            <label className="text-xs col-span-2">Motif<Input value={moveForm.reason} onChange={(e) => setMoveForm({ ...moveForm, reason: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" /></label>
          </div>
          <DialogFooter>
            <Button onClick={() => setMoveOpen(false)} className="rounded-sm bg-white/5 hover:bg-white/10">Annuler</Button>
            <Button data-testid="save-move" onClick={saveMove} className="rounded-sm bg-emerald-500 hover:bg-emerald-600 text-white">Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
