import React, { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { SectionTitle } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plus, PencilSimple, Trash, UsersThree, Buildings } from "@phosphor-icons/react";

const EMPTY_USER = { email: "", password: "", name: "", role: "technicien", site_ids: [] };
const EMPTY_SITE = { name: "", location: "", capacity_kw: 0 };

export default function Admin() {
  const [users, setUsers] = useState([]);
  const [sites, setSites] = useState([]);
  const [userOpen, setUserOpen] = useState(false);
  const [uForm, setUForm] = useState(EMPTY_USER);
  const [uEdit, setUEdit] = useState(null);
  const [siteOpen, setSiteOpen] = useState(false);
  const [sForm, setSForm] = useState(EMPTY_SITE);
  const [sEdit, setSEdit] = useState(null);

  async function load() {
    const [u, s] = await Promise.all([api.get("/users"), api.get("/sites")]);
    setUsers(u.data); setSites(s.data);
  }
  useEffect(() => { load(); }, []);

  // Users
  function openUserCreate() { setUForm(EMPTY_USER); setUEdit(null); setUserOpen(true); }
  function openUserEdit(u) { setUForm({ ...u, password: "" }); setUEdit(u.id); setUserOpen(true); }
  async function saveUser() {
    try {
      if (uEdit) {
        const payload = { name: uForm.name, role: uForm.role, site_ids: uForm.site_ids };
        if (uForm.password) payload.password = uForm.password;
        await api.patch(`/users/${uEdit}`, payload);
      } else {
        await api.post("/users", uForm);
      }
      toast.success("Enregistré"); setUserOpen(false); load();
    } catch (e) { toast.error(formatApiError(e)); }
  }
  async function delUser(id) {
    if (!confirm("Supprimer cet utilisateur ?")) return;
    await api.delete(`/users/${id}`); toast.success("Supprimé"); load();
  }

  // Sites
  function openSiteCreate() { setSForm(EMPTY_SITE); setSEdit(null); setSiteOpen(true); }
  function openSiteEdit(s) { setSForm({ name: s.name, location: s.location, capacity_kw: s.capacity_kw }); setSEdit(s.id); setSiteOpen(true); }
  async function saveSite() {
    try {
      const payload = { ...sForm, capacity_kw: Number(sForm.capacity_kw) };
      if (sEdit) await api.patch(`/sites/${sEdit}`, payload);
      else await api.post("/sites", payload);
      toast.success("Enregistré"); setSiteOpen(false); load();
    } catch (e) { toast.error(formatApiError(e)); }
  }
  async function delSite(id) {
    if (!confirm("Supprimer ce site ?")) return;
    await api.delete(`/sites/${id}`); toast.success("Supprimé"); load();
  }

  function toggleSiteAccess(id) {
    setUForm((f) => ({
      ...f,
      site_ids: f.site_ids.includes(id) ? f.site_ids.filter((x) => x !== id) : [...f.site_ids, id],
    }));
  }

  return (
    <div className="space-y-5" data-testid="admin-page">
      <SectionTitle title="Administration" subtitle="UTILISATEURS // SITES // RÔLES" />

      <Tabs defaultValue="users" className="w-full">
        <TabsList className="bg-transparent border-b border-white/10 rounded-none w-full justify-start p-0 h-auto">
          <TabsTrigger value="users" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-emerald-500 data-[state=active]:text-emerald-300 rounded-none px-4 py-2 text-slate-400"><UsersThree size={14} className="mr-1.5" />Utilisateurs</TabsTrigger>
          <TabsTrigger value="sites" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-emerald-500 data-[state=active]:text-emerald-300 rounded-none px-4 py-2 text-slate-400"><Buildings size={14} className="mr-1.5" />Sites</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button data-testid="new-user-btn" onClick={openUserCreate} className="rounded-sm bg-emerald-500 hover:bg-emerald-600 text-white"><Plus size={14} className="mr-1.5" />Nouvel utilisateur</Button>
          </div>
          <div className="panel overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="text-[10px] uppercase tracking-widest text-slate-500 border-b border-white/10">
                <th className="py-2.5 px-3 text-left">Nom</th><th className="px-3 text-left">Email</th>
                <th className="px-3 text-left">Rôle</th><th className="px-3 text-left">Sites</th><th className="px-3"></th>
              </tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="tr-hover border-b border-white/5">
                    <td className="py-2 px-3">{u.name}</td>
                    <td className="px-3 text-slate-400 font-mono text-xs">{u.email}</td>
                    <td className="px-3"><span className="text-[10px] uppercase tracking-widest font-mono text-emerald-300/80">{u.role}</span></td>
                    <td className="px-3 text-xs text-slate-400">{u.site_ids.map((id) => sites.find((s) => s.id === id)?.name).filter(Boolean).join(", ") || "—"}</td>
                    <td className="px-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => openUserEdit(u)} className="p-1.5 rounded-sm hover:bg-white/5 text-slate-400 hover:text-emerald-300"><PencilSimple size={14} /></button>
                        <button onClick={() => delUser(u.id)} className="p-1.5 rounded-sm hover:bg-white/5 text-slate-400 hover:text-red-400"><Trash size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="sites" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button data-testid="new-site-btn" onClick={openSiteCreate} className="rounded-sm bg-emerald-500 hover:bg-emerald-600 text-white"><Plus size={14} className="mr-1.5" />Nouveau site</Button>
          </div>
          <div className="panel overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="text-[10px] uppercase tracking-widest text-slate-500 border-b border-white/10">
                <th className="py-2.5 px-3 text-left">Nom</th><th className="px-3 text-left">Lieu</th>
                <th className="px-3 text-right">Capacité (kW)</th><th className="px-3"></th>
              </tr></thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id} className="tr-hover border-b border-white/5">
                    <td className="py-2 px-3">{s.name}</td>
                    <td className="px-3 text-slate-400">{s.location}</td>
                    <td className="px-3 text-right font-mono text-xs">{s.capacity_kw}</td>
                    <td className="px-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => openSiteEdit(s)} className="p-1.5 rounded-sm hover:bg-white/5 text-slate-400 hover:text-emerald-300"><PencilSimple size={14} /></button>
                        <button onClick={() => delSite(s.id)} className="p-1.5 rounded-sm hover:bg-white/5 text-slate-400 hover:text-red-400"><Trash size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      {/* User dialog */}
      <Dialog open={userOpen} onOpenChange={setUserOpen}>
        <DialogContent className="bg-[#131C19] border-white/10 text-slate-200 rounded-sm max-w-lg">
          <DialogHeader><DialogTitle>{uEdit ? "Modifier utilisateur" : "Nouvel utilisateur"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {!uEdit && <label className="text-xs col-span-2">Email<Input type="email" value={uForm.email} onChange={(e) => setUForm({ ...uForm, email: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" /></label>}
            <label className="text-xs col-span-2">Nom<Input value={uForm.name} onChange={(e) => setUForm({ ...uForm, name: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" /></label>
            <label className="text-xs col-span-2">{uEdit ? "Nouveau mot de passe (laisser vide pour ne pas changer)" : "Mot de passe"}
              <Input type="password" value={uForm.password} onChange={(e) => setUForm({ ...uForm, password: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" />
            </label>
            <label className="text-xs col-span-2">Rôle
              <Select value={uForm.role} onValueChange={(v) => setUForm({ ...uForm, role: v })}>
                <SelectTrigger className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#131C19] border-white/10">
                  <SelectItem value="admin">Admin</SelectItem><SelectItem value="technicien">Technicien</SelectItem><SelectItem value="viewer">Lecture seule</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <div className="col-span-2">
              <div className="text-xs text-slate-400 mb-2">Sites accessibles</div>
              <div className="grid grid-cols-2 gap-2">
                {sites.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm border border-white/10 px-2 py-1.5 rounded-sm">
                    <Checkbox checked={uForm.site_ids.includes(s.id)} onCheckedChange={() => toggleSiteAccess(s.id)} />
                    {s.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setUserOpen(false)} className="rounded-sm bg-white/5 hover:bg-white/10">Annuler</Button>
            <Button onClick={saveUser} className="rounded-sm bg-emerald-500 hover:bg-emerald-600 text-white">Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Site dialog */}
      <Dialog open={siteOpen} onOpenChange={setSiteOpen}>
        <DialogContent className="bg-[#131C19] border-white/10 text-slate-200 rounded-sm max-w-md">
          <DialogHeader><DialogTitle>{sEdit ? "Modifier site" : "Nouveau site"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs col-span-2">Nom<Input value={sForm.name} onChange={(e) => setSForm({ ...sForm, name: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" /></label>
            <label className="text-xs col-span-2">Lieu<Input value={sForm.location} onChange={(e) => setSForm({ ...sForm, location: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" /></label>
            <label className="text-xs col-span-2">Capacité (kW)<Input type="number" value={sForm.capacity_kw} onChange={(e) => setSForm({ ...sForm, capacity_kw: e.target.value })} className="mt-1 h-9 rounded-sm bg-[#0D1411] border-white/10" /></label>
          </div>
          <DialogFooter>
            <Button onClick={() => setSiteOpen(false)} className="rounded-sm bg-white/5 hover:bg-white/10">Annuler</Button>
            <Button onClick={saveSite} className="rounded-sm bg-emerald-500 hover:bg-emerald-600 text-white">Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
