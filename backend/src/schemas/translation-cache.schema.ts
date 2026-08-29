import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TranslationCacheDocument = TranslationCache & Document;

@Schema({ timestamps: true })
export class TranslationCache {
  @Prop({ required: true })
  entityType: string;

  @Prop({ required: true })
  entityId: string;

  @Prop({ required: true })
  field: string;

  @Prop({ required: true })
  sourceLocale: string;

  @Prop({ required: true })
  targetLocale: string;

  @Prop({ required: true })
  sourceHash: string;

  @Prop({ required: true })
  translatedText: string;

  @Prop({ required: true })
  provider: string;

  @Prop({ required: true })
  model: string;
}

export const TranslationCacheSchema =
  SchemaFactory.createForClass(TranslationCache);

TranslationCacheSchema.index(
  { entityType: 1, entityId: 1, field: 1, targetLocale: 1, sourceHash: 1 },
  {
    name: 'translation_cache_entity_field_target_hash_unique',
    unique: true,
  },
);
