const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

function toDocumentIdSuffix(value) {
  let suffix = '';
  let pendingSeparator = false;

  for (const character of String(value).toUpperCase()) {
    const code = character.codePointAt(0);
    if (code === undefined) {
      continue;
    }

    const isDigit = code >= 48 && code <= 57;
    const isUppercaseLetter = code >= 65 && code <= 90;

    if (isDigit || isUppercaseLetter) {
      if (pendingSeparator && suffix) {
        suffix += '-';
      }
      suffix += character;
      pendingSeparator = false;
    } else if (suffix) {
      pendingSeparator = true;
    }
  }

  return suffix;
}

async function attachManualExcel(config) {
  const {
    machineTypeName,
    sourceFileName,
    targetFileName,
    previewPath,
    documentPrefix,
    description,
    tags,
  } = config;
  const sourceFile = path.resolve(__dirname, '../../../resources', sourceFileName);
  const targetFile = path.resolve(__dirname, '../../uploads', targetFileName);
  const filePath = `/uploads/${targetFileName}`;

  if (!fs.existsSync(sourceFile)) {
    throw new Error(`Source file not found: ${sourceFile}`);
  }

  fs.copyFileSync(sourceFile, targetFile);

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const machineType = await db.collection('machinetypes').findOne({ name: machineTypeName });
  if (!machineType) {
    throw new Error(`Machine type not found: ${machineTypeName}`);
  }

  const machines = await db
    .collection('machines')
    .find({ type_id: String(machineType._id) })
    .sort({ machine_id: 1 })
    .toArray();

  if (!machines.length) {
    throw new Error(`No machines found for machine type: ${machineTypeName}`);
  }

  const summary = [];

  for (const machine of machines) {
    const document_id = `${documentPrefix}-${toDocumentIdSuffix(machine.machine_id)}`;

    await db.collection('documententities').updateOne(
      { document_id },
      {
        $set: {
          document_id,
          machine_id: machine._id,
          type_document: 'excel-manual',
          file_path: filePath,
          file_name: targetFileName,
          preview_path: previewPath,
          description,
          tags,
          uploaded_by: 'codex-sync',
          date_ajout: new Date(),
        },
      },
      { upsert: true },
    );

    summary.push({
      machine_id: machine.machine_id,
      document_id,
      file_path: filePath,
      preview_path: previewPath,
    });
  }

  console.log(
    JSON.stringify(
      {
        machineType: machineTypeName,
        copiedFile: targetFile,
        documents: summary,
      },
      null,
      2,
    ),
  );
}

function runManualExcelAttachment(config) {
  attachManualExcel(config)
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = { attachManualExcel, runManualExcelAttachment };
