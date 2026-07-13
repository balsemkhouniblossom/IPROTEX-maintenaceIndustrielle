require('../dist/load-env.js');

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const MACHINE_TYPE_NAME = 'Rolling';
const SOURCE_FILE = path.resolve(
  __dirname,
  '../../resources/FM_6-5e_Rolling_Maintenance_Sheet_EN.xlsx',
);
const TARGET_FILE_NAME = 'FM_6-5e_Rolling_Maintenance_Sheet_EN.xlsx';
const TARGET_FILE = path.resolve(__dirname, `../uploads/${TARGET_FILE_NAME}`);
const FILE_PATH = `/uploads/${TARGET_FILE_NAME}`;
const PREVIEW_PATH = '/uploads/FM_6-5e_Rolling_Maintenance_Sheet_EN_preview.pdf';

async function main() {
  if (!fs.existsSync(SOURCE_FILE)) {
    throw new Error(`Source file not found: ${SOURCE_FILE}`);
  }

  fs.copyFileSync(SOURCE_FILE, TARGET_FILE);

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const machineType = await db.collection('machinetypes').findOne({ name: MACHINE_TYPE_NAME });
  if (!machineType) {
    throw new Error(`Machine type not found: ${MACHINE_TYPE_NAME}`);
  }

  const machines = await db
    .collection('machines')
    .find({ type_id: String(machineType._id) })
    .sort({ machine_id: 1 })
    .toArray();

  if (!machines.length) {
    throw new Error(`No machines found for machine type: ${MACHINE_TYPE_NAME}`);
  }

  const summary = [];

  for (const machine of machines) {
    const document_id = `DOC-ROLLING-MANUAL-${machine.machine_id
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toUpperCase()}`;

    await db.collection('documententities').updateOne(
      { document_id },
      {
        $set: {
          document_id,
          machine_id: machine._id,
          type_document: 'excel-manual',
          file_path: FILE_PATH,
          file_name: TARGET_FILE_NAME,
          preview_path: PREVIEW_PATH,
          description: 'Rolling maintenance sheet workbook',
          tags: ['rolling', 'manual', 'excel', 'maintenance-plan'],
          uploaded_by: 'codex-sync',
          date_ajout: new Date(),
        },
      },
      { upsert: true },
    );

    summary.push({
      machine_id: machine.machine_id,
      document_id,
      file_path: FILE_PATH,
      preview_path: PREVIEW_PATH,
    });
  }

  console.log(
    JSON.stringify(
      {
        machineType: MACHINE_TYPE_NAME,
        copiedFile: TARGET_FILE,
        documents: summary,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
