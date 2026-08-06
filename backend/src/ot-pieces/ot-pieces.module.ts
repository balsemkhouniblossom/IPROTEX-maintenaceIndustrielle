import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OTPieces, OTPiecesSchema } from '../schemas/ot-pieces.schema';
import { Stock, StockSchema } from '../schemas/stock.schema';
import { StockMovementsModule } from '../stock-movements/stock-movements.module';
import { OtPiecesController } from './ot-pieces.controller';
import { OtPiecesService } from './ot-pieces.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OTPieces.name, schema: OTPiecesSchema },
      { name: Stock.name, schema: StockSchema },
    ]),
    StockMovementsModule,
  ],
  controllers: [OtPiecesController],
  providers: [OtPiecesService],
  exports: [OtPiecesService],
})
export class OtPiecesModule {}
