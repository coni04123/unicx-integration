import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MetricsDocument = Metrics & Document;

export enum MetricType {
  MESSAGE_THROUGHPUT = 'MESSAGE_THROUGHPUT',
  ERROR_RATE = 'ERROR_RATE',
  LATENCY = 'LATENCY',
  QUEUE_BACKLOG = 'QUEUE_BACKLOG',
  SESSION_HEALTH = 'SESSION_HEALTH',
  USER_ACTIVITY = 'USER_ACTIVITY',
  SYSTEM_HEALTH = 'SYSTEM_HEALTH',
}

export enum MetricUnit {
  PER_MINUTE = 'PER_MINUTE',
  PERCENTAGE = 'PERCENTAGE',
  MILLISECONDS = 'MILLISECONDS',
  COUNT = 'COUNT',
  HEALTH_SCORE = 'HEALTH_SCORE',
}

@Schema({ timestamps: true })
export class Metrics {
  @Prop({ required: true, enum: MetricType })
  type: MetricType;

  @Prop({ required: true, enum: MetricUnit })
  unit: MetricUnit;

  @Prop({ required: true })
  value: number;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Tenant' })
  tenantId: Types.ObjectId;

  @Prop({ required: true })
  tenantName: string;

  @Prop({ type: Types.ObjectId, ref: 'Entity' })
  entityId?: Types.ObjectId;

  @Prop()
  entityName?: string;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop({ required: true })
  timestamp: Date;

  @Prop({ default: true })
  isActive: boolean;
}

export const MetricsSchema = SchemaFactory.createForClass(Metrics);

// Indexes for better query performance
MetricsSchema.index({ tenantId: 1, type: 1, timestamp: -1 });
MetricsSchema.index({ type: 1, timestamp: -1 });
MetricsSchema.index({ timestamp: -1 });
MetricsSchema.index({ tenantId: 1, timestamp: -1 });
