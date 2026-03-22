import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CachedScoreDocument = HydratedDocument<CachedScore>;

@Schema({ timestamps: true })
export class CachedScore {
  @Prop({ required: true, unique: true, index: true })
  scoreId: string;

  @Prop({ type: Object, required: true })
  data: Record<string, unknown>;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const CachedScoreSchema = SchemaFactory.createForClass(CachedScore);
