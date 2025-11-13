import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: { updatedAt: true } })
export class UserLocation extends Document {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, index: true })
  roomId: string;

  @Prop({ required: true })
  username: string;

  @Prop({ required: true })
  x: number;

  @Prop({ required: true })
  y: number;
}

export const UserLocationSchema =
  SchemaFactory.createForClass(UserLocation);

UserLocationSchema.index({ roomId: 1, userId: 1 }, { unique: true });