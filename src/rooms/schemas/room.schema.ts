import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Room extends Document {
  @Prop({ required: true, unique: true, index: true })
  roomId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ type: [String], default: [] })
  activeUsers: string[];

  @Prop({ default: true })
  isActive: boolean;
}

export const RoomSchema = SchemaFactory.createForClass(Room);