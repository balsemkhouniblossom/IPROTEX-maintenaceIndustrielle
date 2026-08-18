require('../dist/load-env.js');

const { runManualExcelAttachment } = require('./lib/manual-excel-attachment');

runManualExcelAttachment({
  machineTypeName: 'Braiding',
  sourceFileName: 'Plan_maintenance_tresseuses_EN.xlsx',
  targetFileName: 'Plan_maintenance_tresseuses_EN.xlsx',
  previewPath: '/uploads/Plan_maintenance_tresseuses_EN_preview.pdf',
  documentPrefix: 'DOC-BRAIDING-MANUAL',
  description: 'Braiding machines maintenance plan workbook',
  tags: ['braiding', 'manual', 'excel', 'maintenance-plan'],
});
