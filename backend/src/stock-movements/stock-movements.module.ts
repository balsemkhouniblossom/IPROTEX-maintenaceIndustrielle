import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Stock, StockSchema } from '../schemas/stock.schema';
import {
  StockMovement,
  StockMovementSchema,
} from '../schemas/stock-movement.schema';
import { PartRequest, PartRequestSchema } from '../schemas/part-request.schema';
import { CounterModule } from '../counters/counter.module';
import { StockMovementsService } from './stock-movements.service';

@Module({
  imports: [
    CounterModule,
    MongooseModule.forFeature([
      { name: Stock.name, schema: StockSchema },
      { name: StockMovement.name, schema: StockMovementSchema },
      { name: PartRequest.name, schema: PartRequestSchema },
    ]),
  ],
  providers: [StockMovementsService],
  exports: [StockMovementsService],
})
export class StockMovementsModule {}
