 
const fs = require('node:fs');
const files = ['en.json', 'fr.json', 'ar.json'];
const baseDir = process.cwd();

const workOrdersEn = {
  "title": "Work Orders",
  "heading": "Work Orders Management",
  "subtitle": "Track, manage, and assign maintenance work orders",
  "totalWorkOrders": "Total Work Orders",
  "addWorkOrder": "Add Work Order",
  "allWorkOrders": "All Work Orders",
  "searchPlaceholder": "Search work orders...",
  "unassigned": "Unassigned",
  "confirmDelete": "Are you sure you want to delete this work order?",
  "table": {
    "otId": "OT ID",
    "description": "Description",
    "machine": "Machine",
    "technician": "Technician",
    "status": "Status",
    "priority": "Priority",
    "created": "Created At",
    "startDate": "Start Date",
    "endDate": "End Date"
  },
  "empty": {
    "search": "No work orders match your search",
    "default": "No work orders found"
  },
  "modal": {
    "editTitle": "Edit Work Order",
    "addTitle": "Add Work Order"
  },
  "form": {
    "otId": "OT Number",
    "priority": "Priority",
    "description": "Description",
    "machine": "Machine",
    "technician": "Assigned Technician",
    "status": "Status",
    "estimatedDuration": "Est. Duration (hours)",
    "startDate": "Start Date",
    "endDate": "End Date"
  },
  "priority": {
    "low": "Low",
    "medium": "Medium",
    "high": "High"
  },
  "placeholders": {
    "selectMachine": "Select a machine...",
    "selectTechnician": "Select a technician..."
  },
  "status": {
    "pending": "Pending",
    "in_progress": "In Progress",
    "completed": "Completed",
    "cancelled": "Cancelled"
  },
  "actions": {
    "update": "Update Work Order",
    "create": "Create Work Order"
  },
  "validation": {
    "workOrderIdRequired": "OT ID is required",
    "machineRequired": "Machine selection is required",
    "technicianRequired": "Technician assignment is required"
  },
  "notifications": {
    "deleted": "Work order deleted successfully",
    "deleteFailed": "Failed to delete work order",
    "updated": "Work order updated successfully",
    "created": "Work order created successfully",
    "saveFailed": "Failed to save work order"
  }
};

const workOrdersFr = { ...workOrdersEn, title: "Bons de Travail", heading: "Gestion des Bons de Travail" };
const workOrdersAr = { ...workOrdersEn, title: "????? ?????", heading: "????? ????? ?????" };

files.forEach(f => {
  const p = baseDir + '/messages/' + f;
  if (!fs.existsSync(p)) return;
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  
  if (!data.workOrders) {
    if (f === 'en.json') data.workOrders = workOrdersEn;
    else if (f === 'fr.json') data.workOrders = workOrdersFr;
    else if (f === 'ar.json') data.workOrders = workOrdersAr;
  }
  
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
});
console.log('WorkOrders patched.');
