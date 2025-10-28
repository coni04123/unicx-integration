import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WhatsAppHealthCheckDocument = WhatsAppHealthCheck & Document;

export enum HealthCheckStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
  WARNING = 'warning',
}

export enum HealthCheckType {
  CONNECTION = 'connection',
  MESSAGE_SEND = 'message_send',
  QR_SCAN = 'qr_scan',
  SESSION_VALIDITY = 'session_validity',
}

@Schema({ timestamps: true })
export class WhatsAppHealthCheck {
  @Prop({ type: Types.ObjectId, auto: true })
  _id: Types.ObjectId;

  // Session Information
  @Prop({ type: Types.ObjectId, ref: 'WhatsAppSession', required: true })
  sessionId: Types.ObjectId;

  @Prop({ required: true })
  phoneNumber: string;

  // User Information
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  // Entity & Tenant
  @Prop({ type: Types.ObjectId, ref: 'Entity', required: true })
  entityId: Types.ObjectId;

  @Prop({ type: [Types.ObjectId], default: [] })
  entityIdPath: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'Entity', required: true })
  tenantId: Types.ObjectId;

  // Health Check Details
  @Prop({ required: true, enum: HealthCheckType })
  checkType: HealthCheckType;

  @Prop({ required: true, enum: HealthCheckStatus })
  status: HealthCheckStatus;

  @Prop({ type: Date, default: Date.now })
  checkedAt: Date;

  @Prop({ type: Number, default: 0 })
  responseTime: number; // in milliseconds

  // Consecutive Failure Tracking
  @Prop({ type: Number, default: 0 })
  consecutiveFailures: number;

  @Prop({ type: Boolean, default: false })
  alertTriggered: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Alert' })
  alertId: Types.ObjectId;

  // Error Details
  @Prop({ type: String })
  errorMessage: string;

  @Prop({ type: String })
  errorCode: string;

  @Prop({ type: Object })
  errorDetails: Record<string, any>;

  // Additional Metadata
  @Prop({ type: Object })
  metadata: Record<string, any>;

  // Audit
  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  createdBy: string;

  @Prop()
  updatedBy: string;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const WhatsAppHealthCheckSchema = SchemaFactory.createForClass(WhatsAppHealthCheck);

// Indexes for performance
WhatsAppHealthCheckSchema.index({ sessionId: 1, checkedAt: -1 });
WhatsAppHealthCheckSchema.index({ userId: 1, status: 1 });
WhatsAppHealthCheckSchema.index({ entityIdPath: 1, status: 1 });
WhatsAppHealthCheckSchema.index({ phoneNumber: 1, checkedAt: -1 });
WhatsAppHealthCheckSchema.index({ consecutiveFailures: 1, alertTriggered: 1 });
WhatsAppHealthCheckSchema.index({ createdAt: 1 }); // For cleanup jobs

