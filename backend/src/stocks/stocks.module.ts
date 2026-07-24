import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Stock, StockSchema } from '../schemas/stock.schema';
import { Catalogue, CatalogueSchema } from '../schemas/catalogue.schema';
import {
  StockMovement,
  StockMovementSchema,
} from '../schemas/stock-movement.schema';
import { StocksController } from './stocks.controller';
import { StocksService } from './stocks.service';
import { StockMovementsModule } from '../stock-movements/stock-movements.module';

@Module({
  imports: [
    StockMovementsModule,
    MongooseModule.forFeature([
      { name: Stock.name, schema: StockSchema },
      { name: Catalogue.name, schema: CatalogueSchema },
      { name: StockMovement.name, schema: StockMovementSchema },
    ]),
  ],
  controllers: [StocksController],
  providers: [StocksService],
  exports: [StocksService],
})
export class StocksModule {}
