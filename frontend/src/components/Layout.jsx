import React from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useSite } from "@/context/SiteContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/sonner";
import { Warning, WrenchIcon, PackageIcon, TestTube, Calendar as CalendarIcon, ChartLineUp, UsersThree, SignOut, Buildings, Factory } from "@phosphor-icons/react";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: ChartLineUp },
  { to: "/pannes", label: "Pannes", icon: Warning },
  { to: "/equipements", label: "Équipement", icon: WrenchIcon },
  { to: "/stock", label: "Stock", icon: PackageIcon },
  { to: "/analyses", label: "Analyses", icon: TestTube },
  { to: "/maintenance", label: "Maintenance", icon: CalendarIcon },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { sites, siteId, selectSite } = useSite();
  const nav = useNavigate();
  const loc = useLocation();

  return (
    <div className="min-h-screen relative grid-overlay">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#0D1411]/85 border-b border-white/10">
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center gap-6">
          <div className="flex items-center gap-2.5" data-testid="app-logo">
            <Factory size={22} weight="duotone" className="text-emerald-400" />
            <div className="leading-none">
              <div className="font-mono text-[11px] tracking-[0.25em] text-emerald-400/70">METHATRACK</div>
              <div className="font-sans text-sm text-slate-200/90">Multi-sites // Méthanisation</div>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-1 ml-4">
            {NAV.map((n) => {
              const Ico = n.icon;
              const active = loc.pathname.startsWith(n.to);
              return (
                <NavLink
                  key={n.to}
                  to={n.to}
                  data-testid={`nav-${n.to.replace("/", "")}`}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-sm border transition-colors ${
                    active
                      ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/5"
                      : "border-transparent text-slate-400 hover:text-slate-100 hover:bg-white/[0.03]"
                  }`}
                >
                  <Ico size={15} weight="duotone" />
                  {n.label}
                </NavLink>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {/* Site selector */}
            <div className="flex items-center gap-2">
              <Buildings size={16} className="text-slate-400" />
              <Select value={siteId || ""} onValueChange={selectSite}>
                <SelectTrigger data-testid="site-selector" className="w-[220px] h-9 rounded-sm bg-[#131C19] border-white/10 text-slate-200 focus:ring-emerald-500/30">
                  <SelectValue placeholder="Sélectionner un site" />
                </SelectTrigger>
                <SelectContent className="bg-[#131C19] border-white/10 text-slate-200">
                  {sites.map((s) => (
                    <SelectItem key={s.id} value={s.id} data-testid={`site-option-${s.id}`}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DropdownMenu modal={false}>
              <DropdownMenuTrigger data-testid="user-menu-trigger" className="flex items-center gap-2 px-3 h-9 rounded-sm border border-white/10 bg-[#131C19] text-slate-200 hover:border-emerald-500/30">
                <div className="w-6 h-6 rounded-sm bg-emerald-500/15 border border-emerald-500/30 grid place-items-center text-emerald-300 text-xs font-mono">
                  {user?.name?.[0]?.toUpperCase() || "?"}
                </div>
                <div className="hidden md:flex flex-col items-start leading-none">
                  <span className="text-xs">{user?.name}</span>
                  <span className="text-[10px] uppercase tracking-widest text-slate-500">{user?.role}</span>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="bg-[#131C19] border-white/10 text-slate-200 min-w-[200px]">
                <DropdownMenuLabel className="text-xs text-slate-400">{user?.email}</DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-white/10" />
                {user?.role === "admin" && (
                  <DropdownMenuItem onClick={() => nav("/admin")} data-testid="menu-admin" className="focus:bg-white/5">
                    <UsersThree size={14} className="mr-2" /> Administration
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={logout} data-testid="menu-logout" className="focus:bg-white/5 text-red-400">
                  <SignOut size={14} className="mr-2" /> Déconnexion
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="md:hidden max-w-[1600px] mx-auto px-6 pb-2 flex overflow-x-auto gap-1 no-scrollbar">
          {NAV.map((n) => {
            const active = loc.pathname.startsWith(n.to);
            return (
              <NavLink key={n.to} to={n.to} className={`shrink-0 px-3 py-1 text-xs rounded-sm border ${
                active ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/5" : "border-transparent text-slate-400"
              }`}>{n.label}</NavLink>
            );
          })}
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-6 fade-in">
        <Outlet />
      </main>
      <Toaster theme="dark" richColors position="bottom-right" />
    </div>
  );
}

export function KpiCard({ label, value, hint, tone = "default", testid }) {
  const toneCls = {
    default: "text-slate-100",
    good: "text-emerald-300",
    warn: "text-amber-300",
    bad: "text-red-300",
  }[tone];
  return (
    <div className="panel p-4 relative overflow-hidden" data-testid={testid}>
      <div className="text-[10px] tracking-[0.2em] uppercase text-slate-500">{label}</div>
      <div className={`kpi-number text-3xl mt-2 ${toneCls}`}>{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

export function StatusPill({ className, children, testid }) {
  return (
    <span data-testid={testid} className={`inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-widest rounded-sm border font-mono ${className}`}>
      {children}
    </span>
  );
}

export function SectionTitle({ title, subtitle, right }) {
  return (
    <div className="flex items-end justify-between mb-4">
      <div>
        <div className="text-[10px] tracking-[0.25em] uppercase text-emerald-400/70 font-mono">
          {subtitle}
        </div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-slate-100 mt-1">{title}</h1>
      </div>
      {right}
    </div>
  );
}
