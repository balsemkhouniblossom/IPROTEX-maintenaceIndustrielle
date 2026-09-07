**GMAO — audit from the perspective of factory employees, 6 September 2026**

**Verdict: 🔴 NOT READY for unsupervised daily use in the current working tree.** The product has useful role-specific building blocks. Its main weakness is continuity: a user can recognize an action, start it, and then lose the selected record, entered information, or the route to follow-up. Styling is not the release priority.

This is an implementation-based product audit. I inspected route implementations, their shared components, actual navigation definitions, form handlers, state transitions, translations, and relevant backend contracts. The in-app browser returned no available browsers after the prescribed connection checks, so I did not perform live visual inspection, authenticated click-throughs, or device testing. The sessions below are source-traced simulations, not observed user"'" tests. Scores are expert estimates, not usability-study measurements. No code or database changes were made; this report is the deliverable. The earlier technical audit's compilation findings are relevant only where they block an employee's workflow.

**1. Navigation available to each role**

All paths below are preceded by the selected locale, such as `/en`. Labels are the current English menu translations, not names inferred from files. The source is `frontend/src/components/DashboardLayout.tsx:192` onward.

| Role / menu group | Every sidebar destination |
|---|---|
| Admin / Overview | Dashboard `/`; Digital Twin – Factory `/digital-twin` |
| Admin / Maintenance | Machines `/machines`, with Devices `/devices`; Maintenance `/work-orders`, with Maintenance Plans `/maintenance-plans`, Preventive Task Checklist `/preventive-task-checklist`, Intervention Reports `/intervention-reports`, Lubrication Logs `/lubrification-logs`; Alerts & Failures `/pannes`; Inventory `/catalogues`, with Module Parts `/module-pieces`, Stocks `/stocks`, Lubricants `/lubrifiants`, OT Pieces `/ot-pieces` |
| Admin / Insights | Machine Health `/capteurs`, with Sensor Measurements `/mesures`; AI Analytics `/ai-anomaly`; Analytics & Reports `/reports`; Documents `/documents`, with Knowledge Base `/knowledge-base` |
| Admin / Management | Administration `/users`, with Machine Types `/machine-types` and Module Types `/module-types` |
| Technician / Overview | Dashboard `/technician` |
| Technician / My Work | Work Orders `/technician/work-orders` |
| Technician / Equipment | Machines `/machines`; Machine Health `/technician/machine-health` |
| Technician / Resources | Parts `/technician/parts`; Manuals `/technician/manuals`; Knowledge Base `/technician/knowledge-base` |
| Technician / History | Completed Work `/technician/history` |
| Operator / Overview | Dashboard `/operator` |
| Operator / Operations | Machines `/operator/machines`; Report a Problem `/operator/corrective`; Preventive Tasks `/operator/preventive` |
| Operator / Follow-up | My Reports `/operator/my-reports`; Notifications `/operator/notifications` |

The header also offers language, theme, notifications, user identity/logout, and a mobile menu. A global AI launcher appears in the protected application layout. No additional primary destinations are supplied by those controls.

**Admin: 24 destinations, but the grouping reflects configuration entities more than decisions.** The number alone is not the problem. “Machine Health” opens sensor CRUD, “Alerts & Failures” opens fault codes and reusable solutions, and “Inventory” opens the parts catalogue rather than stock availability. An administrator investigating an urgent warning can reach the wrong kind of page while following a reasonable label. Devices belong in equipment configuration, sensor measurements in diagnostics, and lubrication/consumption logs in work or machine history. Keep catalogue and stock distinctions, but present them together as Parts & Stock. Keep reusable faults/solutions together; their existing redirect already supports that consolidation.

**Technician: eight destinations, mostly appropriate.** My Work, machine context, parts availability, manuals, and history match the job. Keep them. Machine Health currently presents dataset replay as an operational risk view and should be clearly separated from live condition information. Completed Work and the Completed work-order tab are legitimate alternate entry points only if they expose the same records and filters.

**Operator: six destinations, the strongest menu simplification.** “Report a Problem” is much clearer than “Corrective Maintenance.” However, existing `/operator/manuals`, `/operator/knowledge-base`, and `/operator/smart-maintenance-calendar` pages are absent from this sidebar. The calendar need not become another permanent menu item, but machine instructions must remain reachable from the current machine/task. KnowledgeSuggestions exists contextually in the reporting/inspection pages; that is useful, but it does not replace a reliable machine-manual route.

**Cross-page navigation findings:**

- Sidebar highlighting compares exact paths (`DashboardLayout.tsx:578`), so detail pages lose their parent highlight. Use parent-route matching and a visible route back.
- Parent labels navigate while the small adjacent arrow expands children. This is usable if made explicit, but expanding a section must not be mistaken for opening its parent page. The active-child expression also forces a section open even after its toggle is clicked.
- Operator dashboard View Machine goes to `/machines/:id` (`operator/page.tsx:391`), while the Machines list uses `/operator/machines/:id`. The same employee reaches two different machine experiences.
- The dashboard opens preventive work with only `machine`; the machine detail uses `workOrder`; the calendar uses `workOrderId`; the preventive page consumes `plan` plus `machine`. These links do not reliably open the selected task. Sources: `operator/page.tsx:386`, `operator/machines/[id]/page.tsx:262`, `operator/smart-maintenance-calendar/page.tsx:1004`, `operator/preventive/page.tsx:41`.
- MachineHeader shortcuts link to unfiltered work/plan lists and discard the machine context (`components/machine-timeline/MachineHeader.tsx:47`). A user investigating one machine must search for it again.
- There is no common breadcrumb pattern. Some machine and technician headers provide back links; operator detail/error states are less consistent. Preserve machine, work-order, filter, and tab context when returning.
- Sidebar separation is better than direct-route UX separation. Several generic admin CRUD pages use DashboardLayout without an explicit role gate. The layout checks authentication, not role suitability. Backend authorization may reject the operation, but an employee following an old/bookmarked link can still encounter the wrong page shell and controls. Treat this as confusing UI exposure, not a demonstrated backend permission bypass.

**2. Important workflows, traced end to end**

**Operator: machine → report problem → submit → follow status.**

The starting point is obvious: a dedicated menu action and Report Problem beside machines. Preselecting a machine from `?machine=` is implemented. The five stages—machine, symptom, observation/photo, urgency, review—are understandable, but optional observation/photo and urgency occupy separate screens. For a noisy production-floor situation, keep machine and symptom explicit and consider combining the optional details and urgency. Do not require the employee to diagnose a fault code; the existing Other/free-text path is the right basis.

Functional blocker: corrective calls reference `apiService` without its import, and initial loading errors are logged rather than displayed. The resulting empty-machine state can imply there are no assigned machines instead of showing a failed load (`operator/corrective/page.tsx:183`).

The success screen provides a work-order reference and confirmation, which is good. But View Status only displays an alert, and View Existing Issue does the same (`:405`, `:466`). Back to Machines resets the wizard rather than opening the machine list. Recent-report buttons and machine activity likewise lead to the whole My Reports list rather than the selected record. The employee cannot follow the promised link to a live status/history.

Photo upload happens after report creation; upload errors are console-only (`:308`). “Report sent” can therefore conceal a missing photo. Show partial success and a retry for the attachment without asking for a second report. If duplicate submission returns an existing issue, explain that existing reference instead of giving the same generic creation success.

Changing machine clears the selected fault but keeps observation, urgency, and photo. Those may describe the previous machine. Warn or explicitly reset machine-specific evidence. English regex-based fault grouping and hardcoded English category labels also behave poorly when fault descriptions are in another language.

**Operator: preventive task → inspection → completion → history.**

Today/Upcoming/Completed and an OK/Problem checklist are easy concepts. Progress counts, machine context, and a review screen are worth keeping. However, the working tree breaks the underlying experience:

- The list effect repeatedly resets inspection state because it depends on a newly created hook result (`operator/preventive/page.tsx:61`).
- Grouping by plan/machine lets a completed past occurrence hide a scheduled new occurrence (`hooks/useOperatorPreventiveTasks.ts:112`). A job due later today can also be categorized as Upcoming by comparison with midnight.
- The chosen occurrence ID is not passed to the submission hook. Submit tries to schedule a new occurrence, causing a duplicate conflict or leaving the original job overdue (`hooks/usePreventiveInspection.ts:140`).
- Checkbox responses appear saved before requests complete; failed saves are only logged. The review step does not display the submission error rendered on the checklist step.
- View Results on completed cards enters the editable checklist. It does not load a saved historical inspection.
- Problem is initially only a checklist answer. A separate Report This Problem link opens a new tab after a native confirmation, carrying only machine identity—not the selected instruction or a link back to the inspection. The employee must repeat the symptom and cannot see reliable reporting confirmation in the original flow.
- No-checks state explains the absence but gives no responsible next step. Distinguish “No checklist configured—contact maintenance planner” from a load failure. Do not invite submission of an empty inspection.

These are release blockers, not reasons for a visual redesign. Keep the simple checklist, repair occurrence continuity, and make history read-only.

**Technician: assigned work → diagnosis → parts → intervention → completion → follow-up.**

This is the best organized workspace. The dashboard prioritizes work and the detail page groups Overview, Intervention, Parts, Documents, History. Status-dependent actions and contextual manuals reduce navigation. Completion provides a reference and Back to My Work.

Start on the dashboard/list changes status and reloads the list; it does not open the intervention workspace (`TechnicianWorkspace.tsx:801`, `:1112`). Continue Intervention similarly resumes then reloads. Either open the work order on its intervention tab, or call the action Resume Work and show a separate Open Intervention link. The existing labels imply navigation.

**Entered information can be lost.** The shared action helper reloads all detail after any part/status operation (`TechnicianWorkOrderDetail.tsx:82`). That load replaces local report fields with saved server fields (`:1105`). Typing a diagnosis, adding a part, and returning to the intervention can discard the draft. Save/preserve the report before related actions or warn about unsaved edits; the user should not need to learn an internal save order.

**Completion asks for information twice and overwrites it.** The intervention requires Action Performed and Observations. The completion modal asks for Final Result and Final Notes. Completion then replaces `etat_final` with the final result/notes, dropping the earlier Observations (`:1231`). Retain observations and make the final result a clear review decision. Also label the action Submit for Validation when that is the actual next state; “Intervention completed” plus “submitted for validation” needs a consistent distinction between work finished and work accepted.

**Parts hand-off is incomplete in the UI.** Requests are displayed from browser localStorage (`hooks/useTechnicianPartRequests.ts:9`), not refreshed from authoritative request status. They can disappear on another workstation and miss approval changes. An API decision helper exists at `services/api.ts:931`, but no UI consumer was found. Thus the requester's action lacks a visible receiving queue in the inspected application. Add that queue inside existing work-order/inventory pages, not a new procurement module. Do not infer fulfillment simply because the same part appears among used parts; show the actual request quantity/status. The request button is also offered by editability/shortage while its backend path accepts corrective work only; unsupported preventive cases need correct gating or an explicit alternative.

Completed work has useful read-only history, but one View Report button has no handler (`TechnicianWorkOrderDetail.tsx:612`). Parts, manuals, and completed-history browsers fetch at most 200 records and filter/paginate those locally. An older intervention or a part outside that slice appears absent. Server-wide search/history is necessary for real shift handovers.

**Administrator: dashboard → setup → schedule/assign → review outcomes.**

User approval is a strong flow: pending badges, filters, bulk actions, identity/role confirmation, and a reason for rejection. Machines have recognizable identifiers, creation/editing, manuals, and a timeline. Keep these foundations.

The setup journey becomes obscure at maintenance plans. The form starts with Plan Code, requires a module, and exposes frequency, frequency unit, frequency label, maintenance code, instructions, responsible person, oil/grease, and documentation. Some are legitimate metadata; they do not all need equal prominence. Start with machine/component, task, recurrence, and responsible role; reveal optional/import-specific fields afterward. Show a plain-language schedule preview and the resulting next task. Source: `maintenance-plans/components/PlanFormModal.tsx:95` onward.

A prerequisite is missing from the admin journey: I found APIs for module creation but no frontend caller to create an installed machine module. Module Types defines a template, and Module Parts defines compatibility/standard quantity; neither creates the actual module demanded by plan/sensor forms. A newly created machine should offer its existing component-management capability in context. This is a genuine UI gap, not a proposal to redesign the backend.

Admin Work Orders has search, sorting, saved views, assignment fields, and validation controls, but review is fragmented. Approve/Request Correction/Reject appear directly in a wide row alongside Edit/Delete; the row lacks a direct report-review action, and confirmation has no correction/rejection reason input (`work-orders/page.tsx:272`, `:454`). An administrator must cross to Intervention Reports and match identifiers before making a decision. Provide a review panel for the selected work order with report, parts, outcome, and reason. The intervention-report page's general Create/Edit/Delete form duplicates information already generated by execution and exposes a free-text validation field. Keep exceptional correction capability, but make normal history read-only and normal acceptance a deliberate workflow action.

**Cross-role corrective chain.** Operator report → admin assignment → technician work is recognizable, but the hand-offs need explicit ownership: Reported → Awaiting assignment → Assigned → In progress → Waiting for parts → Submitted for validation → Accepted/Returned. The product currently presents multiple report/work-order status vocabularies and relies on users matching references across lists. Every confirmation should name the record, current state, next responsible person/role, and a link to follow it.

**3. Dashboard assessment**

| Dashboard | What works | What prevents an immediate decision |
|---|---|---|
| Operator | Machine cards, report action, due tasks, recent reports, notifications match daily responsibilities | Summary cards are non-clickable; critical action appears below machines/tasks; selected-task links lose identity; Today’s Preventive Tasks is assembled from assigned open work without a preventive-type filter; missing data can look like no work |
| Technician | Assigned/in-progress/waiting-parts/urgent counts, priority work, direct record links, retries | Start does not take the user into the work; priority-empty state renders WO-…/Machine…/Urgent and fake action-shaped placeholders; no authoritative parts-request hand-off |
| Admin | Due/overdue work, waiting validation, stock alerts, recent activity, machine attention are useful inputs | Repeated count/KPI cards lack a dominant decision queue; critical-alert card opens fault-reference CRUD; missing/insufficient health data counts as healthy; failed loads default to reassuring zeros; machine preview is capped at 200 |

Sources: `app/Dashboard.tsx:81–156`; `operator/page.tsx:237–290` and its dashboard JSX; `TechnicianWorkspace.tsx:680–776`.

Admin “healthy machines” must separate Healthy, Needs Attention, and No Recent Assessment. Missing data is not evidence of health. The hardcoded System Online label in the sidebar also conflicts with the offline banner and API connection failures. Use an actual connection state and show last update. Do not replace operational loading failures with zero counts.

The digital twin has a labeled Simulation State control and locally simulated metrics, so it should be preserved as an optional demonstrator/layout aid, not removed merely for being 3D. Move it out of the primary operations overview until it supports a real floor-location decision. Its simulation badge should apply clearly to every health/metric reading, not just the controls. Sources: `components/digital-twin/FactoryTwinScene.tsx:648`, `:706`, `:834`.

The technician Machine Health screen explicitly requests `DATASET_REPLAY` but calls itself an operational view of machine risk. Its top-level copy does not explain the replay data source, and the detail hardcodes persistence as 1 of 5. An employee must see data origin, measurement time, and what can actually be concluded before acting. Keep live condition, historical replay, and simulation visibly distinct. Sources: `technician/machine-health/page.tsx:73`, `components/technician/MachineHealthDetail.tsx:77`, `messages/en.json` technician machine-health copy.

**4. Page inventory and complexity decisions**

This inventory includes sidebar pages, linked details, existing non-sidebar pages, and authentication states. Shared implementations were followed through their imports.

| Page/interface | Decision | Employee problem and intended improvement |
|---|---|---|
| Admin Dashboard | SIMPLIFY | Prioritize overdue/unassigned/awaiting-review queues; make each count open its matching filtered records |
| Machines, admin | KEEP / SIMPLIFY | Useful asset list; retain identification, search, edit and manuals; add contextual component/setup continuation |
| Machines, technician | KEEP | Actual implementation is a role-specific card/search/filter view, not admin CRUD; preserve this distinction |
| Machine detail `/machines/:id` | KEEP / SIMPLIFY | Technician tabs are useful; admin timeline is useful; retain machine identity in shortcuts and back navigation |
| Users | KEEP | Approval and managed-user views fit admin work; explain active/verified/approved as distinct states without making the admin infer login eligibility |
| Maintenance / Work Orders | SIMPLIFY | Replace a row of competing validation/edit/delete choices with Open/Review plus secondary actions |
| Maintenance Plans | SIMPLIFY | Make the recurrence understandable and the actual next occurrence visible; separate optional codes/import metadata |
| Preventive Task Checklist | MERGE | Put template/checklist management under a selected plan; distinguish editing a procedure from recording an occurrence’s completion |
| Intervention Reports | MERGE | Open from work order and history; default to read-only review rather than normal manual report construction |
| Alerts & Failures `/pannes` | MOVE | Label this as Fault Reference/Failure Library; show operational alarms with affected machines/work orders elsewhere in the existing views |
| Panne Solutions `/panne-solutions` | KEEP redirect | It already redirects to `/pannes`; do not restore another redundant menu destination |
| Inventory `/catalogues` | MERGE | Parts master data belongs with stock availability as separate views of Parts & Stock |
| Stocks | KEEP / SIMPLIFY | Adjustment reason and movement history are valuable; explain available/reserved/on-hand and signed adjustment before save |
| Module Parts | MOVE | Compatibility/standard quantity is configuration for equipment/parts, not a daily transaction queue |
| OT Pieces | MERGE | It is a read-only usage table with untranslated headings and no pagination control; put “Parts used” on work orders/history with complete navigation |
| Lubricants | KEEP / SIMPLIFY | Useful reference list; use localized language and full-dataset search, and distinguish reference viewing from management capabilities |
| Lubrication Logs | MERGE | Read-only records fit machine/work history; do not require staff to search a separate unpaginated list |
| Machine Types | MOVE | Keep in equipment settings; fixed English labels should follow the chosen language |
| Module Types | MOVE | Configuration/template terminology belongs behind equipment settings; explain its difference from installed components |
| Machine Health `/capteurs` | MOVE | Actual page is Sensors CRUD; name it Sensors and place it with device configuration |
| Sensor Measurements `/mesures` | MOVE | Raw measurement CRUD is specialist diagnostics; do not present it as ordinary machine condition monitoring |
| Devices | MOVE | Registration, heartbeat interval and key rotation belong to authorized equipment/integration setup, not routine technician/operator work |
| AI Analytics `/ai-anomaly` | KEEP / SIMPLIFY | Keep source/validation/limitations; place raw reason codes and model metadata behind details |
| Analytics & Reports | KEEP / SIMPLIFY | Builder, generated history, scheduled reports are useful; separate one-off creation from recurring setup and preserve selected machine/date context |
| Documents | KEEP / SIMPLIFY | Upload, publish, replace, history and archive serve a real lifecycle; keep Open primary and distinguish metadata edit from new file version |
| Knowledge Base, admin | KEEP / SIMPLIFY | Authoring/publishing/revision valuable; make machine/fault context easier than entering article IDs/tags/error codes equally prominently |
| Digital Twin | MOVE | Optional clearly labeled simulation/layout demonstration; not a primary live-operations destination |
| Operator Dashboard | KEEP / SIMPLIFY | Preserve machine/task/report structure; prioritize due work, accurate states, contextual navigation |
| Operator Machines | KEEP | Search/status cards fit quick selection; offer consistent machine detail and reporting links |
| Operator machine detail | KEEP / ADD | Overview/preventive/activity fit the role; add a reliable return and machine-instructions entry, and open the exact task/activity |
| Report a Problem | KEEP / SIMPLIFY | Symptom-first approach is appropriate; repair submission and status follow-up; reduce optional-screen overhead |
| Preventive Tasks | KEEP / SIMPLIFY | Keep checklist clarity; repair occurrence identity, saved feedback, history, and problem hand-off |
| My Reports | KEEP | Make entries directly addressable; filter all reports server-side, not only the current 12-record page |
| Operator Notifications | MERGE | Use the same notification behavior as the header; add destination links, complete pagination, persistent errors, and clear-all scope |
| Operator Manuals | MOVE | Existing read-only viewer should open from machine/task with the machine already selected; avoid forcing type selection again |
| Operator Knowledge Base | MOVE | Keep contextual read-only help and an intentional findable entry; it is currently absent from the sidebar |
| Operator Smart Maintenance Calendar | MOVE | Keep as optional calendar view of the same work queue, sharing occurrence links and actions; do not maintain a separate lifecycle experience |
| Technician Dashboard | KEEP | Priority queue and counters match the job; remove dummy empty-state work cards and improve Start continuation |
| Technician Work Orders | KEEP | Search/status/priority/due-date filters and executable cards are useful; preserve filters/back context and route Continue to the workspace |
| Technician work-order detail | KEEP / SIMPLIFY | Five tabs are coherent; protect drafts, expose state-dependent next action, and unify completion/report semantics |
| Technician Parts | KEEP | Keep availability/location read-only; request/use parts in work-order context; retrieve beyond first 200 |
| Technician Manuals | KEEP | Read-only document browser with filters/preview is appropriate; complete dataset retrieval and contextual entry |
| Technician Knowledge Base | KEEP | Read-only search/detail suits diagnosis; contextual suggestions complement it |
| Technician Completed Work | KEEP / MERGE | Keep a history shortcut using the same complete work-order dataset and report detail; avoid competing status logic |
| Technician Machine Health + analysis detail | HIDE operational replay / SIMPLIFY | Keep diagnostic evidence, but visibly separate replay from real factory condition; remove invented persistence counts |
| Login | KEEP | Labels, show-password, recovery and approval messages are useful; shared-terminal session persistence should be explicit |
| Register | SIMPLIFY | Role/department/profile fields should match actual account provisioning; explain requested role and approval delay |
| Complete Profile | KEEP / SIMPLIFY | Required identity fields are legitimate; align phone behavior and password guidance with registration |
| Forgot/Reset Password | KEEP | Clear return to login and status feedback; keep localized messages and form presentation consistent |
| Verify Email / Google Result | KEEP | Existing transitional/pending/rejected states explain access conditions; ensure a clear next step and contact for pending approval |
| Legacy auth success | KEEP redirect | It redirects to a failed Google result; avoid exposing this legacy URL as a normal sign-in destination |
| Root/locale entry, not-found, error/loading states | KEEP / SIMPLIFY | Preserve role landing and localized recovery; offer return/retry without losing record context where possible |
| Shared modal/table/search shell | KEEP / SIMPLIFY | Reuse focus management, loading/empty conventions and paging; protect dirty forms and localize accessible control names |

**5. Role suitability**

**Operator: can this person use it without development knowledge? Not reliably yet.** The six-item menu is appropriate. Keep assigned machines, report symptoms, approved preventive checks, report status, and read-only instructions. Hide fault-library editing, sensor/measurement CRUD, raw IDs, device keys, model controls, stock adjustment, and validation administration. The missing experience is exact-item follow-up and a reliable “this problem has been reported” hand-off. Show plain stages with who acts next. “OK/Problem” is understandable but a permitted “Unable to check” with a required explanation may be needed for inaccessible checks; this is an operational-policy decision, not permission to bypass a mandatory procedure.

**Technician: mostly understandable, but unsafe for unsupervised note/parts handling yet.** The work-order workspace is grounded in the job. Keep machine facts, diagnosis, performed actions, approved documentation, parts availability/use/request, and history. Keep asset/catalogue administration read-only. Clarify Claim versus Start versus Intervene versus Return, since these represent different ownership/review decisions. A technician should see the required next action for the current state, with a reason when it is unavailable. Returned work needs a clear correction reason. Live machine state and analytical estimates must not be conflated.

**Administrator: usable with substantial training, not self-explanatory.** Separate daily work control from master-data settings. The admin needs unassigned work, overdue work, waiting validation, parts requests, and access approvals before raw telemetry. Show an intervention's evidence before acceptance; give data correction and deletion secondary placement. Reuse existing modules and endpoints for the missing UI hand-offs. Do not add another parallel work-order/report system.

**Terminology to standardize:** Work order as the shared record; Report a Problem for operator entry; My Work for technician queue; Parts Used instead of OT Pieces; Sensors instead of Machine Health for sensor configuration; Failure Library instead of Alerts for fault definitions; Submitted for Validation distinct from Accepted/Completed; Observations distinct from Final Result. Technical identifiers may be secondary references but must not substitute for machine names, part names, instructions, or status labels.

**6. Interface behavior, consistency, and error prevention**

- **Search and pagination:** modern Work Orders/Plans use server tables, while ResourceCrudPage filters only the currently loaded page, My Reports filters the current 12 reports, and technician Parts/Manuals/History cap retrieval at 200. Searching must mean the same thing everywhere. A “no result” should not mean “not on this slice.” Sources: `ResourceCrudPage.tsx:118`, `operator/my-reports/page.tsx:114`, `TechnicianWorkspace.tsx:1425`, `:1735`.
- **Error/empty/loading:** technician pages often show retryable errors; operator reporting/notifications and some reference lists silently log failures or show empty content. Preserve the difference between no assigned machines, no matches, service failure, and no permission. GlobalApiErrorBanner exposes method/URL and “backend API” terminology to every role; replace with an employee-facing explanation and retry/contact route. The global banner does not repair page-level empty-state ambiguity.
- **Status/color:** urgent admin work orders fall through to the green priority default, while technician urgent is red (`work-orders/page.tsx:82`). Technician machine status is always rendered with green styling regardless of its value (`TechnicianWorkspace.tsx:535`). Operator pages mix raw status strings and translations. Use one semantic mapping with text as well as color.
- **Dates:** some pages use the UI locale; others use browser defaults; some due dates use browser midnight while business scheduling has its own timezone. Show the factory timezone where needed and use one Today/Overdue rule. Test midnight/shift boundaries before rollout.
- **Confirmation:** native alert/confirm, timed toast, inline error, and modal confirmations coexist. Native alerts should not impersonate record navigation. Critical persistence failures must stay visible until recovered. Ordinary filtering does not need a “filter updated” success toast.
- **Forms:** several labels are not programmatically associated with inputs; shared Modal has useful focus trapping/restoration, but its Close Modal accessible names are hardcoded English and it permits backdrop/Escape dismissal without a built-in dirty-draft warning. Add protection in editing workflows, not indiscriminate confirmations everywhere.
- **Primary actions:** technician action sets are state-aware; admin tables place many equally weighted operations side by side. Keep one main action and secondary actions, with validation decisions inside evidence review.
- **Touch/responsiveness:** responsive grids, horizontal tab overflow, table scrolling, modal viewport bounds, and mobile sidebar are present. Risks remain in long five-step labels, fixed flex checklist answer buttons beside long instructions, dense action rows, small notification text, and 24/28px shell controls. These are inspection risks requiring real phone/tablet/keyboard testing; no contrast, target-size compliance, or glove-use claim is made without rendering/testing.
- **Language:** active screens contain hardcoded English/French such as OT Pieces, Lubrifiants, Work Order, Quantity, Mechanical, Problem, and API connection issue. Fix high-frequency operator/technician labels first. Do not report unused translation entries as visible UI defects.
- **Notification consistency:** header loads 10 items, operator page 50; neither item provides record navigation. The operator page's Clear All acts on all notifications despite displaying only the first 50. Show scope, paginate, and offer confirmation/undo for bulk clearing; keep unread counts synchronized.
- **Technical analysis:** progressive disclosure already exists in technician detail. Keep it. Make uncertainty, provenance and last update explicit before a risk score influences work; there is no benefit in exposing raw sensor/model metadata equally to all roles.

**7. Simulated normal working sessions**

**Operator, start of shift.** “I see my machine and a Report Problem button.” Good. “I opened the machine from the dashboard and it looks different from Machines.” Inconsistent destination. “I clicked today’s task; why must I select it again?” Lost task identity. “I marked Problem—is maintenance informed?” Not yet; a separate link opens a second form. “It says reported; where is its progress?” The promised status action is an alert. “I filtered My Reports and see nothing—did it disappear?” Filtering only this page can hide the answer. This employee needs record continuity, dependable saves, and plain hand-off states more than additional features.

**Technician, assigned repair.** “Urgent work is visible; I can inspect machine context and documents.” Good. “I clicked Start; am I supposed to click View Details now?” The action stays on the queue. “I wrote my diagnosis, added a bearing, and my notes vanished.” Draft reset after reload. “I requested a missing part yesterday from another computer—where is it?” Browser-local request history. “Why did I enter observations if completion replaces them?” Duplicated/overwritten entry. “Completed—or awaiting validation?” Unclear closure vocabulary. Fixing these interruptions is more important than reducing useful technical detail.

**Administrator, morning review.** “There are critical alerts, so I open them.” Lands in the failure library. “I want a plan for the new machine, but the module field has no suitable option—where do I create it?” Missing in-context prerequisite. “There are reports awaiting approval; where is the report behind this row?” Fragmented review. “The technician is waiting for parts—where do I decide the request?” No visible UI consumer for the decision endpoint. “A machine without assessment is counted as healthy?” Misleading aggregate. The admin needs a decision queue and linked evidence, not more overview cards.

**8. Scores and readiness**

| Dimension | Score / 10 | Reason |
|---|---:|---|
| Navigation | 5 | Good role menus; misleading admin labels and broken/lossy deep links |
| Ease of use | 4 | Recognizable controls but users must recover workflow context themselves |
| Interface clarity | 5 | Some focused workspaces; inconsistent states, terminology and evidence |
| Workflow logic | 3 | Preventive occurrence, parts hand-off and report-review continuity failures |
| Role separation | 6 | Appropriate dedicated views; generic-route UI exposure and misplaced diagnostics remain |
| Consistency | 4 | Different status, search, date, modal and navigation conventions |
| Learnability | 5 | Operator menu approachable; admin prerequisites/internal terms require training |
| Efficiency | 4 | Extra re-selection, duplicated final entry, missing direct record actions |
| Error prevention | 3 | Lost notes, silent partial saves, misleading health/priority and editable history |
| Overall readiness for real users | 4 | Useful product foundation with blocking daily-work defects |

**🔴 NOT READY.** A guided demonstration of selected working screens is different from a full-shift pilot. Release acceptance should require the exact selected job to survive every transition; report/attachment saves to show their real outcome; drafts to survive parts actions; history to remain read-only; and each hand-off to expose the next owner and authoritative status. Browser verification remains outstanding because no browser was available in this session.

**9. Prioritized improvement plan**

Effort is relative: S = localized UI/copy change; M = coordinated page/state/integration work; L = several connected views with workflow verification. These are not calendar estimates. P0 blocks or seriously confuses users; P1 is an important usability issue; P2 improves daily use; P3 is optional polish. ADD below means a missing UI step using the existing product capabilities, not a new backend module.

| Priority | Role | Page/Flow | Problem | Why it matters | Recommended change | Effort |
|---|---|---|---|---|---|---|
| P0 | Operator | Corrective / preventive entry | Missing API import/type failures and preventive reset loop | Core work cannot be completed reliably | Repair blockers before UX acceptance; retain the existing focused flows | S–M |
| P0 | Operator | Preventive occurrence | Selected ID lost, past completion hides current work, submit schedules again | Due maintenance can disappear or remain overdue | Carry one occurrence ID through all entry points; submit that record; separate history | M |
| P0 | Technician | Intervention → parts/status | Detail reload overwrites unsaved notes | Diagnosis/work evidence is lost | Preserve/save draft before related actions and explain save state | M |
| P0 | Technician | Complete intervention | Observations replaced by final-result text | Staff repeat information and lose their account of the repair | Keep observations; review once; label submission versus acceptance accurately | S–M |
| P0 | Technician / Admin | Parts request → decision → follow-up | Local-browser history and no visible decision queue | Requests cannot be tracked across shifts/devices | ADD request review inside existing work/inventory views and authoritative status retrieval | M–L |
| P0 | Operator | View status / existing issue / results | Alerts, generic lists, or editable checklists instead of selected record | Employee cannot confirm what happened | Open exact report/work-order history; make completed results read-only | M |
| P0 | Admin / Technician | Health and urgency | Missing data counted healthy; urgent default green; replay resembles live condition | Attention can go to the wrong machine/work | Separate unknown/live/replay; correct priority mapping; remove invented persistence count | M |
| P1 | Operator | Checklist/report/photo saving | Silent failure or error outside current step | Apparent success can omit evidence | Show persistent save/partial-success state; retry attachments; wait for answers to persist | M |
| P1 | Admin | New machine → maintenance plan | Required installed component has no visible creation path | Planner cannot finish normal setup without outside help | ADD contextual component setup using existing module capability | M |
| P1 | Admin | Validate intervention | Decisions separated from report and no correction-reason input | Acceptance lacks evidence; returned work lacks instructions | MERGE report/parts/history into selected-work review with reason and next owner | M |
| P1 | Admin | Sidebar / dashboard links | Health/alerts/inventory names lead to different concepts | Reasonable navigation leads to wrong task | Rename and MOVE configuration; link dashboard counts to matching filtered queues | S–M |
| P1 | Operator | Machine → task / problem | Two machine experiences and mismatched query parameters | Re-selection and unexpected pages interrupt shift work | Use one operator destination; preserve occurrence/machine/report context | M |
| P1 | Operator | Inspection problem hand-off | New tab loses symptom and reporting outcome | Employee repeats a problem and cannot tell whether it was sent | Prefill symptom, link resulting issue to inspection, return with confirmation | M |
| P1 | All | Search/history | Page-only filters, 200-record caps, unpaginated logs | Existing records look absent | Search/page the full authorized dataset; show matching totals consistently | M |
| P1 | All | Notifications | No destination links; hidden Clear All scope | Alerts do not lead to action; unseen notifications may be cleared | Link affected records, paginate, explain bulk scope and synchronize unread counts | M |
| P1 | Technician | Start / Continue / View Report | Labels imply navigation but controls reload or do nothing | Next action is unclear | Open intervention/report tab; distinguish state change from navigation | S–M |
| P1 | All | Load/error states | Failed requests resemble empty data or online success | Staff trust stale/absent information | Distinguish failure/no-match/no-assignment; retry and show connection/last update | M |
| P1 | Operator / Technician | Role-specific UI | Old/direct links expose generic management shells | Employees encounter irrelevant or denied actions | HIDE management controls via consistent page guards/read-only variants | M |
| P2 | Admin | Plan authoring | Too many equal-priority codes and recurrence fields | Planner must understand storage/import concepts | SIMPLIFY core task/recurrence; advanced metadata; plain next-task preview | M |
| P2 | Admin | Inventory/reports/reference navigation | Separate relationship/log screens fragment one job | User matches IDs across pages | MERGE Parts & Stock views and contextual usage/lubrication/report history | M |
| P2 | All | Status, dates, language | Raw/mixed labels and different due-date conventions | Employees interpret the same event differently | Shared translated status vocabulary and factory-time display | M |
| P2 | Operator | Problem wizard | Optional steps and retained data after machine change | Slower reporting and possible wrong-machine evidence | Combine optional details; clear/confirm machine-specific draft changes | S–M |
| P2 | Operator | Instructions | Existing manuals/help are hard to discover | Employee cannot find approved task guidance | MOVE existing reader links into machine/task context | S |
| P2 | All | Navigation and dirty forms | Detail highlight/back context weak; dismiss can discard work | Staff lose location or drafts | Parent highlighting, contextual back links and targeted dirty-form protection | M |
| P2 | All | Mobile/keyboard | Dense controls, long labels, varied responsive patterns | Tablet use may need precision/extra scrolling | Verify narrow/wide screens and keyboard; fix observed crowding and labels | M |
| P3 | Admin | Digital twin placement | Simulation competes with daily operational overview | Decorative exploration distracts from decisions | MOVE to optional demonstration/layout area; label all simulated outputs | S |
| P3 | Technician / All | Empty states and decorative feedback | Fake WO placeholders and routine success toasts | Empty work looks unfinished; feedback becomes noise | REMOVE dummy work cards; give plain empty-state next steps | S |
