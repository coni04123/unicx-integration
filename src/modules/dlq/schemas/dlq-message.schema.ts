import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DLQMessageDocument = DLQMessage & Document;

export type ErrorDetails = {
  name: string;
  message: string;
  stack?: string;
};

export type DLQMessageStatus = 'pending' | 'processing' | 'completed' | 'failed';

@Schema({ timestamps: true })
export class DLQMessage {
  @Prop({ type: Types.ObjectId, auto: true })
  _id: Types.ObjectId;

  @Prop({ required: true, type: Object })
  originalMessage: any;

  @Prop({ required: true, type: Object })
  error: ErrorDetails;

  @Prop({ type: Object })
  lastError?: ErrorDetails;

  @Prop({ required: true })
  topic: string;

  @Prop({ required: true })
  subscription: string;

  @Prop({ required: true, default: 0 })
  retryCount: number;

  @Prop({ required: true })
  maxRetries: number;

  @Prop({ required: true })
  retryDelay: number;

  @Prop({ required: true, type: Date })
  nextRetryAt: Date;

  @Prop({ required: true, enum: ['pending', 'processing', 'completed', 'failed'] })
  status: DLQMessageStatus;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const DLQMessageSchema = SchemaFactory.createForClass(DLQMessage);

// Indexes for performance
DLQMessageSchema.index({ status: 1, nextRetryAt: 1 });
DLQMessageSchema.index({ topic: 1, subscription: 1 });
DLQMessageSchema.index({ createdAt: 1 });
