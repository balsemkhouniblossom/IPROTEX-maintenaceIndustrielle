require('../dist/load-env.js');

const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

const apply = process.argv.includes('--apply');
const rows = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../frontend/src/data/braidingInventory.json'), 'utf8'));

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is unavailable');
  const catalogues = db.collection('catalogues');
  const stocks = db.collection('stocks');
  const movements = db.collection('stockmovements');
  const summary = { sourceRows: rows.length, catalogueCreates: 0, stockCreates: 0, existing: 0, conflicts: [] };

  for (const row of rows) {
    const stockCode = `STK-${row.reference}`;
    const [part, stock] = await Promise.all([
      catalogues.findOne({ part_id: row.reference }),
      stocks.findOne({ stock_id: stockCode }),
    ]);
    if (part && part.nom_piece !== row.name) {
      summary.conflicts.push(`${row.reference}: existing Catalogue name differs`);
      continue;
    }
    if (stock && part && String(stock.part_id) !== String(part._id)) {
      summary.conflicts.push(`${stockCode}: existing Stock points to another Catalogue record`);
      continue;
    }
    if (part && stock) {
      summary.existing += 1;
      continue;
    }
    if (!part) summary.catalogueCreates += 1;
    if (!stock) summary.stockCreates += 1;
    if (!apply) continue;

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const catalogue = part || (await catalogues.insertOne({
          part_id: row.reference,
          nom_piece: row.name,
          ref_constructeur: row.reference,
          fabricant: row.supplier || undefined,
          categorie_piece: row.category,
        }, { session })).insertedId;
        const partId = part?._id || catalogue;
        if (!stock) {
          const stockId = (await stocks.insertOne({
            stock_id: stockCode,
            part_id: partId,
            quantite_en_stock: row.quantity,
            quantite_reservee: 0,
            seuil_alerte_stock: row.minimumQuantity || undefined,
            quantite_minimale: row.minimumQuantity || undefined,
            emplacement: row.location || undefined,
            version: 1,
          }, { session })).insertedId;
          if (row.quantity > 0) {
            await movements.insertOne({
              movement_id: `MOV-IMPORT-${row.reference}`,
              type: 'adjustment',
              stock_id: stockId,
              part_id: partId,
              quantity_delta: row.quantity,
              reserved_delta: 0,
              quantite_en_stock_after: row.quantity,
              quantite_reservee_after: 0,
              reason: 'Initial stock imported from consolidated FM 7.5-102 sheets',
              createdAt: new Date(),
              updatedAt: new Date(),
            }, { session });
          }
        }
      });
    } finally {
      await session.endSession();
    }
  }

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...summary }, null, 2));
  if (summary.conflicts.length) process.exitCode = 2;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
