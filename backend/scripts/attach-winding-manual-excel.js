require('../dist/load-env.js');

const { runManualExcelAttachment } = require('./lib/manual-excel-attachment');

runManualExcelAttachment({
  machineTypeName: 'Winding',
  sourceFileName: 'FM_6-5_Winding_Maintenance_Plan_EN.xlsx',
  targetFileName: 'FM_6-5_Winding_Maintenance_Plan_EN.xlsx',
  previewPath: '/uploads/FM_6-5_Winding_Maintenance_Plan_EN_preview.pdf',
  documentPrefix: 'DOC-WINDING-MANUAL',
  description: 'Winding maintenance plan workbook',
  tags: ['winding', 'manual', 'excel', 'maintenance-plan'],
});
