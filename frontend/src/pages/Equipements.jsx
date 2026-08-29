import React, { useEffect, useMemo, useState } from "react";
import { api, formatApiError, getToken } from "@/lib/api";
import { useSite } from "@/context/SiteContext";
import { useAuth } from "@/context/AuthContext";
import { KpiCard, SectionTitle } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, WrenchIcon, ImageSquare, FileArrowUp, Trash, PencilSimple } from "@phosphor-icons/react";
import { fileUrl, API } from "@/lib/api";

const EMPTY = { site_id: "", name: "", type: "Digesteur", serial: "", installed_at: "", notes: "" };
const TYPES = ["Digesteur", "Pompe", "Cogénération", "Sécurité", "Traitement digestat", "Instrumentation", "Autre"];

export default function Equipements() {
  const { siteId } = useSite();
  const { user } = useAuth();
  const canWrite = user?.role !== "viewer";
  const [items, setItems] = useState([]);
  const [failures, setFailures] = useState([]);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);

  async function load() {
    if (!siteId) return;
    const [e, f] = await Promise.all([
      api.get("/equipments", { params: { site_id: siteId } }),
      api.get("/failures", { params: { site_id: siteId } }),
    ]);
    setItems(e.data); setFailures(f.data);
  }
  useEffect(() => { load(); }, [siteId]);

  const kpi = useMemo(() => ({
    total: items.length,
    withPhotos: items.filter((i) => (i.photos || []).length).length,
    withDocs: items.filter((i) => (i.docs || []).length).length,
  }), [items]);

  function openCreate() { setForm({ ...EMPTY, site_id: siteId }); setEditId(null); setOpen(true); }
  function openEdit(e) { setForm({ site_id: e.site_id, name: e.name, type: e.type, serial: e.serial || "", installed_at: e.installed_at || "", notes: e.notes || "" }); setEditId(e.id); setOpen(true); }

  async function save() {
    try {
      if (editId) await api.patch(`/equipments/${editId}`, form);
      else await api.post("/equipments", form);
      toast.success("Enregistré"); setOpen(false); load();
    } catch (e) { toast.error(formatApiError(e)); }
  }
  async function remove(id) {
    if (!confirm("Supprimer cet équipement ?")) return;
    await api.delete(`/equipments/${id}`); toast.success("Supprimé"); load();
  }
  async function uploadFile(eqId, file, kind) {
    const fd = new FormData(); fd.append("file", file);
    try {
      await api.post(`/equipments/${eqId}/${kind === "photo" ? "photos" : "docs"}`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Téléversé"); load();
      const fresh = await api.get(`/equipments/${eqId}`); setDetail(fresh.data);
    } catch (e) { toast.error(formatApiError(e)); }
  }

  return (
    <div className="space-y-5" data-testid="equipements-page">
      <SectionTitle title="Équipement" subtitle="PARC MATÉRIEL // MULTI-SITES" right={canWrite && (
        <Button data-testid="new-eq-btn" onClick={openCreate} className="rounded-sm bg-emerald-500 hover:bg-emerald-600 text-white"><Plus size={14} className="mr-1.5" />Nouvel équipement</Button>
      )} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Équipements" value={kpi.total} testid="kpi-eq-total" />
        <KpiCard label="Avec photos" value={kpi.withPhotos} tone="good" />
        <KpiCard label="Avec docs PDF" value={kpi.withDocs} tone="good" />
        <KpiCard label="Pannes historiques" value={failures.length} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.length === 0 && <div className="col-span-full text-center py-14 text-slate-500 font-mono text-xs">NO_DATA_FOUND</div>}
        {items.map((e) => {
          const failuresCount = failures.filter((f) => f.equipment_id === e.id).length;
          const photo = e.photos?.[0];
          return (
            <div key={e.id} data-testid={`eq-card-${e.id}`} className="panel panel-hover overflow-hidden cursor-pointer" onClick={() => setDetail(e)}>
              <div className="h-36 bg-[#0D1411] relative overflow-hidden">
                {photo ? (
                  <img src={fileUrl(photo.path)} alt={e.name} className="w-full h-full object-cover opacity-90" />
                ) : (
                  <div className="w-full h-full grid place-items-center text-slate-700"><WrenchIcon size={40} weight="duotone" /></div>
                )}
                <span className="absolute top-2 left-2 font-mono text-[10px] uppercase tracking-widest bg-black/60 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded-sm">{e.type}</span>
              </div>
              <div className="p-3">
                <div className="font-semibold text-slate-100">{e.name}</div>
                <div className="text-xs text-slate-500 font-mono">{e.serial || "sans n°"}</div>
                <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400 font-mono">
                  <span>{(e.photos || []).length} photos</span>
                  <span>{(e.docs || []).length} docs</span>
                  <span className={failuresCount ? "text-amber-300" : ""}>{failuresCount} panne(s)</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create/edit */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[#131C19] border-white/10 text-slate-200 rounded-sm max-w-lg">
          <DialogHeader><DialogTitle>{editId ? "Modifier équipement" : "Nouvel équipement"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs col-span-2">Nom<Input data-testid="eq-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" /></label>
            <label className="text-xs">Type
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#131C19] border-white/10">{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="text-xs">N° série<Input value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" /></label>
            <label className="text-xs col-span-2">Date installation<Input type="date" value={form.installed_at?.slice(0, 10) || ""} onChange={(e) => setForm({ ...form, installed_at: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" /></label>
            <label className="text-xs col-span-2">Notes<Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 rounded-sm bg-[#0D1411] border-white/10" /></label>
          </div>
          <DialogFooter>
            <Button onClick={() => setOpen(false)} className="rounded-sm bg-white/5 hover:bg-white/10 text-slate-200">Annuler</Button>
            <Button data-testid="save-eq" onClick={save} className="rounded-sm bg-emerald-500 hover:bg-emerald-600 text-white">Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail */}
      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent className="bg-[#131C19] border-white/10 text-slate-200 rounded-sm max-w-3xl">
          {detail && (
            <>
              <DialogHeader><DialogTitle className="flex items-center gap-2"><WrenchIcon size={18} className="text-emerald-400" />{detail.name}</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-2">Fiche</div>
                  <div className="space-y-1 text-slate-300">
                    <div><span className="text-slate-500">Type :</span> {detail.type}</div>
                    <div><span className="text-slate-500">N° série :</span> <span className="font-mono">{detail.serial || "—"}</span></div>
                    <div><span className="text-slate-500">Installé :</span> {detail.installed_at || "—"}</div>
                    {detail.notes && <div className="mt-2 text-xs text-slate-400">{detail.notes}</div>}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-2">Historique</div>
                  <div className="space-y-1 max-h-40 overflow-auto text-xs">
                    {failures.filter((f) => f.equipment_id === detail.id).map((f) => (
                      <div key={f.id} className="flex justify-between border-b border-white/5 py-1">
                        <span className="font-mono text-slate-500">{f.date?.slice(0, 10)}</span>
                        <span className="truncate max-w-[220px]">{f.description}</span>
                      </div>
                    )) || <div className="text-slate-600 font-mono">Aucune panne</div>}
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Photos ({(detail.photos || []).length}/6)</div>
                  {canWrite && (detail.photos || []).length < 6 && (
                    <label className="text-xs cursor-pointer flex items-center gap-1 text-emerald-400 hover:text-emerald-300">
                      <ImageSquare size={14} /> Ajouter photo
                      <input data-testid="upload-photo" type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files[0] && uploadFile(detail.id, e.target.files[0], "photo")} />
                    </label>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(detail.photos || []).map((p, i) => (
                    <a key={i} href={fileUrl(p.path)} target="_blank" rel="noreferrer" className="block bg-[#0D1411] border border-white/10 h-24 overflow-hidden rounded-sm">
                      <img src={fileUrl(p.path)} alt="" className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Documents PDF</div>
                  {canWrite && (
                    <label className="text-xs cursor-pointer flex items-center gap-1 text-emerald-400 hover:text-emerald-300">
                      <FileArrowUp size={14} /> Ajouter PDF
                      <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files[0] && uploadFile(detail.id, e.target.files[0], "doc")} />
                    </label>
                  )}
                </div>
                <div className="space-y-1">
                  {(detail.docs || []).length === 0 && <div className="text-slate-600 text-xs font-mono">Aucun document</div>}
                  {(detail.docs || []).map((d, i) => (
                    <a key={i} href={fileUrl(d.path)} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs border border-white/10 px-2 py-1.5 rounded-sm hover:border-emerald-500/30">
                      <FileArrowUp size={14} className="text-emerald-400" />{d.filename}
                    </a>
                  ))}
                </div>
              </div>

              <DialogFooter>
                {canWrite && <Button onClick={() => { openEdit(detail); setDetail(null); }} className="rounded-sm bg-white/5 hover:bg-white/10"><PencilSimple size={14} className="mr-1" />Modifier</Button>}
                {canWrite && <Button onClick={() => { remove(detail.id); setDetail(null); }} className="rounded-sm bg-red-500/20 text-red-300 hover:bg-red-500/30"><Trash size={14} className="mr-1" />Supprimer</Button>}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
