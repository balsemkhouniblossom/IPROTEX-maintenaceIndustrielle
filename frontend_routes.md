# GMAO Frontend Routes — Manual Test Checklist (by user role)

Base URL (dev): `http://localhost:3000` — locale used below: `en` (swap for `fr`, `ar`, `es`, `de`, `it`)

Roles in this app: `admin`, `technician`, `operator` (from `frontend/src/services/sessionGuard.ts`). Sidebar navigation per role is defined in `frontend/src/components/DashboardLayout.tsx`.

---

## 0. Public / shared (no login required)
- [ ] http://localhost:3000/en/auth/login
- [ ] http://localhost:3000/en/auth/register
- [ ] http://localhost:3000/en/auth/forgot-password
- [ ] http://localhost:3000/en/auth/reset-password
- [ ] http://localhost:3000/en/auth/verify-email
- [ ] http://localhost:3000/en/auth/google-result
- [ ] http://localhost:3000/en/auth/success
- [ ] http://localhost:3000/en/auth/complete-profile *(shown to any role with an incomplete profile)*
- [ ] http://localhost:3000/en/this-page-does-not-exist ← 404 fallback

---

## 1. Admin (`role: admin`)
Dashboard: http://localhost:3000/en

| Page | URL | Add/Edit |
|---|---|---|
| Dashboard | http://localhost:3000/en | — |
| Users | http://localhost:3000/en/users | modal on page |
| Machines | http://localhost:3000/en/machines | modal on page |
| Machine Types | http://localhost:3000/en/machine-types | modal on page |
| Module Types | http://localhost:3000/en/module-types | modal on page |
| Devices | http://localhost:3000/en/devices | modal on page |
| Work Orders | http://localhost:3000/en/work-orders | modal on page |
| Maintenance Plans | http://localhost:3000/en/maintenance-plans | modal on page |
| Preventive Task Checklist | http://localhost:3000/en/preventive-task-checklist | modal on page *(also allows `technician`)* |
| Intervention Reports | http://localhost:3000/en/intervention-reports | modal on page |
| Pannes | http://localhost:3000/en/pannes | modal on page |
| Panne Solutions | http://localhost:3000/en/panne-solutions | modal on page |
| Capteurs | http://localhost:3000/en/capteurs | modal on page |
| Mesures | http://localhost:3000/en/mesures | modal on page |
| Catalogues | http://localhost:3000/en/catalogues | modal on page |
| Module Pieces | http://localhost:3000/en/module-pieces | modal on page |
| Stocks | http://localhost:3000/en/stocks | modal on page |
| Lubrifiants | http://localhost:3000/en/lubrifiants | modal on page |
| Lubrification Logs | http://localhost:3000/en/lubrification-logs | modal on page |
| OT Pieces | http://localhost:3000/en/ot-pieces | modal on page |
| Documents | http://localhost:3000/en/documents | modal on page |
| Knowledge Base | http://localhost:3000/en/knowledge-base | modal on page |
| Reports | http://localhost:3000/en/reports | — (`requiredRole="admin"`, strictly admin-only) |

---

## 2. Technician (`role: technician`)
Dashboard: http://localhost:3000/en/technician

| Page | URL |
|---|---|
| Dashboard | http://localhost:3000/en/technician |
| Alt. dashboard | http://localhost:3000/en/technician-dashboard |
| Work Orders (list) | http://localhost:3000/en/technician/work-orders |
| Work Order detail | http://localhost:3000/en/technician/work-orders/{id} ← replace `{id}` with a real work order ID (grab one from the list first) |
| Current Interventions | http://localhost:3000/en/technician/interventions |
| Waiting Parts | http://localhost:3000/en/technician/waiting-parts |
| History | http://localhost:3000/en/technician/history |
| Manuals | http://localhost:3000/en/technician/manuals |
| Knowledge Base | http://localhost:3000/en/technician/knowledge-base |
| Preventive Task Checklist *(shared with admin)* | http://localhost:3000/en/preventive-task-checklist |

---

## 3. Operator (`role: operator`)
Dashboard: http://localhost:3000/en/operator

| Page | URL |
|---|---|
| Dashboard | http://localhost:3000/en/operator |
| Start Preventive Maintenance | http://localhost:3000/en/operator/preventive |
| Start Corrective Maintenance | http://localhost:3000/en/operator/corrective |
| Report Problem | http://localhost:3000/en/operator/report-problem |
| Smart Maintenance Calendar | http://localhost:3000/en/operator/smart-maintenance-calendar |
| Machines | http://localhost:3000/en/operator/machines |
| Manuals | http://localhost:3000/en/operator/manuals |
| Knowledge Base | http://localhost:3000/en/operator/knowledge-base |
| My Reports | http://localhost:3000/en/operator/my-reports |

Note: `frontend/src/app/[locale]/pannes/page.tsx` also renders conditionally for operators (`isOperator` flag alters form fields), but Pannes is not in the operator sidebar — it's an admin-nav item, so don't expect operators to reach it through normal navigation.

---

## Testing tips
- **Cross-role access check**: while logged in as `operator` or `technician`, manually try hitting an admin-only URL (e.g. `/en/users`, `/en/reports`) directly in the address bar — `ProtectedRoute` should redirect you back to your own dashboard (see `evaluateProtectedRouteAccess` in `sessionGuard.ts`). Same test in reverse: as `admin`, try `/en/operator` or `/en/technician` directly.
- **Add/Edit forms**: for every admin CRUD page above, there's no separate URL — click "Add" or "Edit" on the list page to open the modal.
- **Locale check**: repeat a handful of pages per role in `ar` (RTL) and one other locale to catch layout/i18n regressions.
- **Account-state redirects** (worth testing once, not per-page): incomplete profile → `/auth/complete-profile`; pending/rejected/inactive/unverified account → redirected to login with the relevant error.
