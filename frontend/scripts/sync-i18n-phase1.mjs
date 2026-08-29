import fs from 'node:fs';
import path from 'node:path';

const locales = ['en', 'fr', 'ar', 'es', 'de', 'it'];
const compareStrings = (left, right) => left.localeCompare(right);

const enumTranslations = {
  en: {
    roles: { admin: 'Admin', technician: 'Technician', operator: 'Operator' },
    permissions: { read: 'Read', create: 'Create', update: 'Update', delete: 'Delete', approve: 'Approve', reject: 'Reject', export: 'Export', manage: 'Manage' },
    workOrderStatuses: { pending: 'Pending', assigned: 'Assigned', in_progress: 'In progress', waiting_parts: 'Waiting for parts', waiting_validation: 'Waiting for validation', technician_required: 'Technician required', returned: 'Returned', completed: 'Completed', validated: 'Validated', cancelled: 'Cancelled', canceled: 'Cancelled', closed: 'Closed' },
    priorities: { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' },
    maintenanceTypes: { preventive: 'Preventive', corrective: 'Corrective', predictive: 'Predictive', inspection: 'Inspection', lubrication: 'Lubrication' },
    machineStates: { operational: 'Operational', running: 'Running', stopped: 'Stopped', maintenance: 'Maintenance', inactive: 'Inactive', active: 'Active', online: 'Online', offline: 'Offline', warning: 'Warning', error: 'Error', fault: 'Fault' },
    reportTypes: { corrective_downtime: 'Corrective downtime', fault_frequency: 'Fault frequency', preventive_compliance: 'Preventive compliance', maintenance_costs: 'Maintenance costs', technician_workload: 'Technician workload', stock_movements: 'Stock movements', machine_history: 'Machine history', predictive_risk: 'Predictive risk', audit_history: 'Audit history', mttr_mtbf_trends: 'MTTR / MTBF trends' },
    notificationTypes: { work_order_assigned: 'Work order assigned', work_order_updated: 'Work order updated', work_order_completed: 'Work order completed', validation_required: 'Validation required', part_request_created: 'Part request created', part_request_approved: 'Part request approved', part_request_rejected: 'Part request rejected', preventive_due: 'Preventive maintenance due', preventive_overdue: 'Preventive maintenance overdue', report_ready: 'Report ready', system: 'System' },
  },
  fr: {
    roles: { admin: 'Administrateur', technician: 'Technicien', operator: 'Operateur' },
    permissions: { read: 'Lire', create: 'Creer', update: 'Modifier', delete: 'Supprimer', approve: 'Approuver', reject: 'Rejeter', export: 'Exporter', manage: 'Gerer' },
    workOrderStatuses: { pending: 'En attente', assigned: 'Assigne', in_progress: 'En cours', waiting_parts: 'En attente de pieces', waiting_validation: 'En attente de validation', technician_required: 'Technicien requis', returned: 'Retourne', completed: 'Termine', validated: 'Valide', cancelled: 'Annule', canceled: 'Annule', closed: 'Cloture' },
    priorities: { urgent: 'Urgent', high: 'Elevee', medium: 'Moyenne', low: 'Faible' },
    maintenanceTypes: { preventive: 'Preventive', corrective: 'Corrective', predictive: 'Predictive', inspection: 'Inspection', lubrication: 'Lubrification' },
    machineStates: { operational: 'Operationnelle', running: 'En marche', stopped: 'Arretee', maintenance: 'Maintenance', inactive: 'Inactive', active: 'Active', online: 'En ligne', offline: 'Hors ligne', warning: 'Avertissement', error: 'Erreur', fault: 'Panne' },
    reportTypes: { corrective_downtime: 'Arrets correctifs', fault_frequency: 'Frequence des pannes', preventive_compliance: 'Conformite preventive', maintenance_costs: 'Couts de maintenance', technician_workload: 'Charge des techniciens', stock_movements: 'Mouvements de stock', machine_history: 'Historique machine', predictive_risk: 'Risque predictif', audit_history: 'Historique d audit', mttr_mtbf_trends: 'Tendances MTTR / MTBF' },
    notificationTypes: { work_order_assigned: 'Ordre de travail assigne', work_order_updated: 'Ordre de travail mis a jour', work_order_completed: 'Ordre de travail termine', validation_required: 'Validation requise', part_request_created: 'Demande de piece creee', part_request_approved: 'Demande de piece approuvee', part_request_rejected: 'Demande de piece rejetee', preventive_due: 'Maintenance preventive a realiser', preventive_overdue: 'Maintenance preventive en retard', report_ready: 'Rapport pret', system: 'Systeme' },
  },
  ar: {
    roles: { admin: 'مسؤول', technician: 'فني', operator: 'مشغل' },
    permissions: { read: 'قراءة', create: 'إنشاء', update: 'تحديث', delete: 'حذف', approve: 'موافقة', reject: 'رفض', export: 'تصدير', manage: 'إدارة' },
    workOrderStatuses: { pending: 'قيد الانتظار', assigned: 'معين', in_progress: 'قيد التنفيذ', waiting_parts: 'بانتظار القطع', waiting_validation: 'بانتظار التحقق', technician_required: 'يتطلب فنيا', returned: 'مرجع', completed: 'مكتمل', validated: 'تم التحقق', cancelled: 'ملغى', canceled: 'ملغى', closed: 'مغلق' },
    priorities: { urgent: 'عاجل', high: 'عالية', medium: 'متوسطة', low: 'منخفضة' },
    maintenanceTypes: { preventive: 'وقائية', corrective: 'تصحيحية', predictive: 'تنبؤية', inspection: 'فحص', lubrication: 'تشحيم' },
    machineStates: { operational: 'تشغيلية', running: 'تعمل', stopped: 'متوقفة', maintenance: 'صيانة', inactive: 'غير نشطة', active: 'نشطة', online: 'متصلة', offline: 'غير متصلة', warning: 'تحذير', error: 'خطأ', fault: 'عطل' },
    reportTypes: { corrective_downtime: 'توقفات الصيانة التصحيحية', fault_frequency: 'تكرار الأعطال', preventive_compliance: 'امتثال الصيانة الوقائية', maintenance_costs: 'تكاليف الصيانة', technician_workload: 'عبء عمل الفنيين', stock_movements: 'حركات المخزون', machine_history: 'سجل الآلة', predictive_risk: 'الخطر التنبؤي', audit_history: 'سجل التدقيق', mttr_mtbf_trends: 'اتجاهات MTTR / MTBF' },
    notificationTypes: { work_order_assigned: 'تم تعيين أمر عمل', work_order_updated: 'تم تحديث أمر العمل', work_order_completed: 'اكتمل أمر العمل', validation_required: 'التحقق مطلوب', part_request_created: 'تم إنشاء طلب قطعة', part_request_approved: 'تمت الموافقة على طلب القطعة', part_request_rejected: 'تم رفض طلب القطعة', preventive_due: 'صيانة وقائية مستحقة', preventive_overdue: 'صيانة وقائية متأخرة', report_ready: 'التقرير جاهز', system: 'النظام' },
  },
  es: {
    roles: { admin: 'Administrador', technician: 'Tecnico', operator: 'Operador' },
    permissions: { read: 'Leer', create: 'Crear', update: 'Actualizar', delete: 'Eliminar', approve: 'Aprobar', reject: 'Rechazar', export: 'Exportar', manage: 'Gestionar' },
    workOrderStatuses: { pending: 'Pendiente', assigned: 'Asignada', in_progress: 'En curso', waiting_parts: 'Esperando piezas', waiting_validation: 'Esperando validacion', technician_required: 'Tecnico requerido', returned: 'Devuelta', completed: 'Completada', validated: 'Validada', cancelled: 'Cancelada', canceled: 'Cancelada', closed: 'Cerrada' },
    priorities: { urgent: 'Urgente', high: 'Alta', medium: 'Media', low: 'Baja' },
    maintenanceTypes: { preventive: 'Preventivo', corrective: 'Correctivo', predictive: 'Predictivo', inspection: 'Inspeccion', lubrication: 'Lubricacion' },
    machineStates: { operational: 'Operativa', running: 'En marcha', stopped: 'Detenida', maintenance: 'Mantenimiento', inactive: 'Inactiva', active: 'Activa', online: 'En linea', offline: 'Fuera de linea', warning: 'Advertencia', error: 'Error', fault: 'Falla' },
    reportTypes: { corrective_downtime: 'Tiempo de parada correctivo', fault_frequency: 'Frecuencia de fallas', preventive_compliance: 'Cumplimiento preventivo', maintenance_costs: 'Costes de mantenimiento', technician_workload: 'Carga de tecnicos', stock_movements: 'Movimientos de stock', machine_history: 'Historial de maquina', predictive_risk: 'Riesgo predictivo', audit_history: 'Historial de auditoria', mttr_mtbf_trends: 'Tendencias MTTR / MTBF' },
    notificationTypes: { work_order_assigned: 'Orden de trabajo asignada', work_order_updated: 'Orden de trabajo actualizada', work_order_completed: 'Orden de trabajo completada', validation_required: 'Validacion requerida', part_request_created: 'Solicitud de pieza creada', part_request_approved: 'Solicitud de pieza aprobada', part_request_rejected: 'Solicitud de pieza rechazada', preventive_due: 'Mantenimiento preventivo pendiente', preventive_overdue: 'Mantenimiento preventivo vencido', report_ready: 'Informe listo', system: 'Sistema' },
  },
  de: {
    roles: { admin: 'Administrator', technician: 'Techniker', operator: 'Bediener' },
    permissions: { read: 'Lesen', create: 'Erstellen', update: 'Aktualisieren', delete: 'Loschen', approve: 'Genehmigen', reject: 'Ablehnen', export: 'Exportieren', manage: 'Verwalten' },
    workOrderStatuses: { pending: 'Ausstehend', assigned: 'Zugewiesen', in_progress: 'In Bearbeitung', waiting_parts: 'Wartet auf Teile', waiting_validation: 'Wartet auf Validierung', technician_required: 'Techniker erforderlich', returned: 'Zuruckgegeben', completed: 'Abgeschlossen', validated: 'Validiert', cancelled: 'Storniert', canceled: 'Storniert', closed: 'Geschlossen' },
    priorities: { urgent: 'Dringend', high: 'Hoch', medium: 'Mittel', low: 'Niedrig' },
    maintenanceTypes: { preventive: 'Vorbeugend', corrective: 'Korrektiv', predictive: 'Pradiktiv', inspection: 'Inspektion', lubrication: 'Schmierung' },
    machineStates: { operational: 'Betriebsbereit', running: 'Lauft', stopped: 'Gestoppt', maintenance: 'Wartung', inactive: 'Inaktiv', active: 'Aktiv', online: 'Online', offline: 'Offline', warning: 'Warnung', error: 'Fehler', fault: 'Storung' },
    reportTypes: { corrective_downtime: 'Korrektive Ausfallzeit', fault_frequency: 'Storungshaufigkeit', preventive_compliance: 'Vorbeugende Konformitat', maintenance_costs: 'Wartungskosten', technician_workload: 'Technikerauslastung', stock_movements: 'Bestandsbewegungen', machine_history: 'Maschinenhistorie', predictive_risk: 'Pradiktives Risiko', audit_history: 'Auditverlauf', mttr_mtbf_trends: 'MTTR-/MTBF-Trends' },
    notificationTypes: { work_order_assigned: 'Arbeitsauftrag zugewiesen', work_order_updated: 'Arbeitsauftrag aktualisiert', work_order_completed: 'Arbeitsauftrag abgeschlossen', validation_required: 'Validierung erforderlich', part_request_created: 'Teileanfrage erstellt', part_request_approved: 'Teileanfrage genehmigt', part_request_rejected: 'Teileanfrage abgelehnt', preventive_due: 'Vorbeugende Wartung fallig', preventive_overdue: 'Vorbeugende Wartung uberfallig', report_ready: 'Bericht bereit', system: 'System' },
  },
  it: {
    roles: { admin: 'Amministratore', technician: 'Tecnico', operator: 'Operatore' },
    permissions: { read: 'Leggere', create: 'Creare', update: 'Aggiornare', delete: 'Eliminare', approve: 'Approvare', reject: 'Rifiutare', export: 'Esportare', manage: 'Gestire' },
    workOrderStatuses: { pending: 'In attesa', assigned: 'Assegnato', in_progress: 'In corso', waiting_parts: 'In attesa di parti', waiting_validation: 'In attesa di validazione', technician_required: 'Tecnico richiesto', returned: 'Restituito', completed: 'Completato', validated: 'Validato', cancelled: 'Annullato', canceled: 'Annullato', closed: 'Chiuso' },
    priorities: { urgent: 'Urgente', high: 'Alta', medium: 'Media', low: 'Bassa' },
    maintenanceTypes: { preventive: 'Preventiva', corrective: 'Correttiva', predictive: 'Predittiva', inspection: 'Ispezione', lubrication: 'Lubrificazione' },
    machineStates: { operational: 'Operativa', running: 'In esecuzione', stopped: 'Ferma', maintenance: 'Manutenzione', inactive: 'Inattiva', active: 'Attiva', online: 'Online', offline: 'Offline', warning: 'Avviso', error: 'Errore', fault: 'Guasto' },
    reportTypes: { corrective_downtime: 'Fermo correttivo', fault_frequency: 'Frequenza guasti', preventive_compliance: 'Conformita preventiva', maintenance_costs: 'Costi di manutenzione', technician_workload: 'Carico tecnici', stock_movements: 'Movimenti stock', machine_history: 'Storico macchina', predictive_risk: 'Rischio predittivo', audit_history: 'Storico audit', mttr_mtbf_trends: 'Trend MTTR / MTBF' },
    notificationTypes: { work_order_assigned: 'Ordine di lavoro assegnato', work_order_updated: 'Ordine di lavoro aggiornato', work_order_completed: 'Ordine di lavoro completato', validation_required: 'Validazione richiesta', part_request_created: 'Richiesta parte creata', part_request_approved: 'Richiesta parte approvata', part_request_rejected: 'Richiesta parte rifiutata', preventive_due: 'Manutenzione preventiva in scadenza', preventive_overdue: 'Manutenzione preventiva scaduta', report_ready: 'Report pronto', system: 'Sistema' },
  },
};

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function flatten(value, prefix = '') {
  return Object.entries(value).flatMap(([key, nested]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    return isRecord(nested) ? flatten(nested, next) : [next];
  });
}

function getByPath(value, dottedKey) {
  return dottedKey.split('.').reduce((acc, part) => (isRecord(acc) ? acc[part] : undefined), value);
}

function setByPath(value, dottedKey, leaf) {
  const parts = dottedKey.split('.');
  let cursor = value;
  for (const part of parts.slice(0, -1)) {
    if (!isRecord(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = leaf;
}

const messagesDir = path.join(process.cwd(), 'messages');
const messages = Object.fromEntries(
  locales.map((locale) => [
    locale,
    JSON.parse(fs.readFileSync(path.join(messagesDir, `${locale}.json`), 'utf8')),
  ]),
);

for (const locale of locales) {
  messages[locale].common ??= {};
  messages[locale].common.enums = enumTranslations[locale];
}

const allKeys = [...new Set(locales.flatMap((locale) => flatten(messages[locale])))].sort(compareStrings);

for (const locale of locales) {
  for (const key of allKeys) {
    if (getByPath(messages[locale], key) !== undefined) continue;

    const englishValue = getByPath(messages.en, key);
    const fallbackValue =
      englishValue ??
      locales.map((candidate) => getByPath(messages[candidate], key)).find((value) => value !== undefined) ??
      key.split('.').at(-1);
    setByPath(messages[locale], key, fallbackValue);
  }
}

for (const locale of locales) {
  fs.writeFileSync(
    path.join(messagesDir, `${locale}.json`),
    `${JSON.stringify(messages[locale], null, 2)}\n`,
    'utf8',
  );
}
