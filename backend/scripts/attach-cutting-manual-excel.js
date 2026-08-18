require('../dist/load-env.js');

const { runManualExcelAttachment } = require('./lib/manual-excel-attachment');

runManualExcelAttachment({
  machineTypeName: 'Cutting',
  sourceFileName: 'FM_6-5c_Maintenance_Plan_HSGM_English.xlsx',
  targetFileName: 'FM_6-5c_Maintenance_Plan_HSGM_English.xlsx',
  previewPath: '/uploads/FM_6-5c_Maintenance_Plan_HSGM_English_preview.pdf',
  documentPrefix: 'DOC-CUTTING-MANUAL',
  description: 'HSGM cutting maintenance plan workbook',
  tags: ['cutting', 'manual', 'excel', 'maintenance-plan', 'hsgm'],
});
