require('../dist/load-env.js');

const { runManualExcelAttachment } = require('./lib/manual-excel-attachment');

runManualExcelAttachment({
  machineTypeName: 'Rolling',
  sourceFileName: 'FM_6-5e_Rolling_Maintenance_Sheet_EN.xlsx',
  targetFileName: 'FM_6-5e_Rolling_Maintenance_Sheet_EN.xlsx',
  previewPath: '/uploads/FM_6-5e_Rolling_Maintenance_Sheet_EN_preview.pdf',
  documentPrefix: 'DOC-ROLLING-MANUAL',
  description: 'Rolling maintenance sheet workbook',
  tags: ['rolling', 'manual', 'excel', 'maintenance-plan'],
});
