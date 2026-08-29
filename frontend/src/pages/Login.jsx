import React, { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Navigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Factory, Envelope, LockKey } from "@phosphor-icons/react";

export default function Login() {
  const { user, login, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/dashboard" replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    await login(email, password);
    setLoading(false);
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-5 relative">
      <div className="lg:col-span-3 hidden lg:flex flex-col justify-between p-12 relative overflow-hidden">
        <div className="flex items-center gap-2">
          <Factory size={22} weight="duotone" className="text-emerald-400" />
          <div className="font-mono text-[11px] tracking-[0.3em] text-emerald-400/80">METHATRACK</div>
        </div>
        <div className="max-w-xl">
          <div className="font-mono text-[10px] tracking-[0.3em] text-emerald-400/70">SYSTÈME DE SUIVI // v1.0</div>
          <h1 className="text-5xl font-extrabold text-slate-100 leading-[1.05] mt-4">
            Pilotez vos unités de méthanisation.
            <br />
            <span className="text-emerald-400">Sans chaos.</span>
          </h1>
          <p className="text-slate-400 mt-6 max-w-md">
            Pannes, équipements, stock de pièces, analyses digestat et maintenance préventive — un seul poste de commande multi-sites.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-3 max-w-lg font-mono text-xs">
            {["01 // PANNES", "02 // STOCK", "03 // DIGESTAT"].map((t) => (
              <div key={t} className="panel px-3 py-2 text-emerald-300/80">{t}</div>
            ))}
          </div>
        </div>
        <div className="font-mono text-[10px] text-slate-600">© {new Date().getFullYear()} MethaTrack — accès restreint</div>
      </div>

      <div className="lg:col-span-2 flex items-center justify-center p-6">
        <div className="panel w-full max-w-sm p-8 fade-in">
          <div className="font-mono text-[10px] tracking-[0.3em] text-emerald-400/70">AUTHENTIFICATION</div>
          <h2 className="text-2xl font-extrabold text-slate-100 mt-1">Connexion</h2>
          <p className="text-sm text-slate-500 mt-1">Accédez à votre poste de suivi.</p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-xs text-slate-400 flex items-center gap-1.5"><Envelope size={12} /> Email</span>
              <Input
                data-testid="login-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 h-10 rounded-sm bg-[#0D1411] border-white/10 focus-visible:ring-emerald-500/30"
                placeholder="vous@exploitation.fr"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-400 flex items-center gap-1.5"><LockKey size={12} /> Mot de passe</span>
              <Input
                data-testid="login-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 h-10 rounded-sm bg-[#0D1411] border-white/10 focus-visible:ring-emerald-500/30"
                placeholder="••••••••"
              />
            </label>

            {error && <div data-testid="login-error" className="text-xs text-red-400 border border-red-500/20 bg-red-500/5 px-3 py-2 rounded-sm">{error}</div>}

            <Button
              data-testid="login-submit"
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded-sm bg-emerald-500 hover:bg-emerald-600 text-white font-medium"
            >
              {loading ? "Connexion..." : "Se connecter"}
            </Button>
          </form>

          <div className="mt-6 text-[10px] font-mono text-slate-600 leading-relaxed">
            SYSTÈME PRIVÉ // Accès sur invitation uniquement
          </div>
        </div>
      </div>
    </div>
  );
}
