import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SavedViewDocument = SavedView & Document;

/**
 * A user's saved combination of search/filter/sort/column-visibility state
 * for one list page (`page_key`, e.g. `"work-orders"`), so they can return
 * to a specific slice of a large dataset without re-entering every filter.
 * `query` is stored opaque (whatever query-string params that page's
 * `useServerTable` hook produces) — this schema never interprets it, so
 * adding a new filter to a page never requires a saved-view migration.
 */
@Schema({ timestamps: true })
export class SavedView {
  @Prop({ required: true, unique: true })
  view_id!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user_id!: Types.ObjectId;

  @Prop({ required: true })
  page_key!: string;

  @Prop({ required: true, trim: true, maxlength: 100 })
  name!: string;

  @Prop({ default: false })
  is_default!: boolean;

  @Prop({ type: Object, required: true })
  query!: Record<string, unknown>;
}

export const SavedViewSchema = SchemaFactory.createForClass(SavedView);
SavedViewSchema.index({ user_id: 1, page_key: 1 });
SavedViewSchema.index({ user_id: 1, page_key: 1, name: 1 }, { unique: true });
