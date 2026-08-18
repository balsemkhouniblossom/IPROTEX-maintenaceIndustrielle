 
const fs = require('node:fs');
const files = ['en.json', 'fr.json', 'ar.json'];

files.forEach(f => {
  const p = './messages/' + f;
  if (!fs.existsSync(p)) return;
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));

  // Fix dashboard namespaces
  if (!data.dashboard) data.dashboard = {};
  if (!data.dashboard.admin && data.dashboardHome) data.dashboard.admin = data.dashboardHome;
  if (!data.dashboard.operator && data.operatorDashboard) data.dashboard.operator = data.operatorDashboard;
  if (!data.dashboard.technician && data.technicianDashboard) data.dashboard.technician = data.technicianDashboard;

  // Fix health namespace
  if (!data.health && data.dashboardHome && data.dashboardHome.health) data.health = data.dashboardHome.health;

  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
});
console.log('JSON structurally patched.');
