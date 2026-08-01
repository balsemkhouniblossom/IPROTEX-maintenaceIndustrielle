import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SavedView, SavedViewSchema } from '../schemas/saved-view.schema';
import { SavedViewsService } from './saved-views.service';
import { SavedViewsController } from './saved-views.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SavedView.name, schema: SavedViewSchema },
    ]),
  ],
  controllers: [SavedViewsController],
  providers: [SavedViewsService],
  exports: [SavedViewsService],
})
export class SavedViewsModule {}
