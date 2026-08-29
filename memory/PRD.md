# MethaTrack — PRD & Progress

## Problem Statement
Application web (FR) pour digitaliser le suivi des pannes, équipements, stock de pièces et analyses digestat sur plusieurs unités de méthanisation, en équipe.

## Users
- ~10 utilisateurs, 3 rôles :
  - Admin (owner) — accès total, gestion users/sites
  - Technicien — écriture sur ses site(s) affectés
  - Lecture seule — dashboard/rapports uniquement

## Stack
- Backend FastAPI + MongoDB (Motor), JWT bcrypt auth
- Frontend React + shadcn + Tailwind + Recharts, thème sombre gris-vert radial
- Emergent Object Storage pour photos équipements + PDF manuels

## Implemented (Feb 2026)
- Auth JWT (login/logout/refresh/me), brute-force lockout email-based
- Users & Sites admin CRUD, RBAC + site-scoped queries (list) & site-ownership assertion (write)
- Modules Pannes (CRUD, filtres statut/gravité/recherche, gravité colorée, coût, durée)
- Module Équipement (CRUD, photos jusqu'à 6, upload PDF, historique pannes)
- Module Stock (CRUD pièces, seuil d'alerte visible, journal mouvements entree/sortie/ajustement, valorisation)
- Sortie stock automatique quand une panne consomme des pièces
- Module Analyses digestat (10 paramètres) avec interprétation auto (Stable/À surveiller/Risque)
- Module Maintenance préventive (récurrence, historique interventions, avance auto de next_due)
- Dashboard multi-site : 4 KPIs, chart pH + AGV/TAC, chart pannes par type (dual Y-axis)
- Seed demo : 2 sites, 5 équipements, 5 pièces, 3 pannes, 5 analyses, 1 tâche maintenance
- Cascade delete parts→stock_movements, tasks→maintenance_history
- 65+ pytest tests, RBAC site-scope matrix, tous verts

## Backlog (P1 — next phases)
- Phase 4 Notifications : Resend (email) + Twilio (SMS) — critique panne, stock bas, échéance maintenance, analyse Risque
- Phase 5 App mobile React Native + Expo avec mode hors ligne (SQLite + sync queue)
- Phase 6 Polish : shadcn AlertDialog pour deletes, DialogDescription a11y, DatePicker Popover, pagination listes >500, CORS explicite en prod

## Backlog (P2)
- Seuils digestat paramétrables par site (sites thermophiles)
- Export CSV/PDF des rapports mensuels
- Import initial depuis proto (localStorage → MongoDB)
- Log des conflits de sync mobile (last-write-wins)
