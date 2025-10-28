import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AlertDocument = Alert & Document;

export enum AlertType {
  ACCOUNT_BLOCKED = 'account_blocked',
  ACCOUNT_SUSPENDED = 'account_suspended',
  CONNECTION_LOST = 'connection_lost',
  MESSAGE_FAILURE = 'message_failure',
  QUOTA_EXCEEDED = 'quota_exceeded',
  SYSTEM_ERROR = 'system_error',
}

export enum AlertSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum AlertStatus {
  OPEN = 'open',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED = 'resolved',
  DISMISSED = 'dismissed',
}

@Schema({ timestamps: true })
export class Alert {
  @Prop({ type: Types.ObjectId, auto: true })
  _id: Types.ObjectId;

  // Alert Details
  @Prop({ required: true, enum: AlertType })
  type: AlertType;

  @Prop({ required: true, enum: AlertSeverity })
  severity: AlertSeverity;

  @Prop({ required: true, enum: AlertStatus, default: AlertStatus.OPEN })
  status: AlertStatus;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  // Related Resources
  @Prop({ type: Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WhatsAppSession' })
  sessionId: Types.ObjectId;

  @Prop()
  phoneNumber: string;

  // Entity & Tenant
  @Prop({ type: Types.ObjectId, ref: 'Entity', required: true })
  entityId: Types.ObjectId;

  @Prop({ type: [Types.ObjectId], default: [] })
  entityIdPath: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'Entity', required: true })
  tenantId: Types.ObjectId;

  // Tracking
  @Prop({ type: Number, default: 1 })
  occurrenceCount: number;

  @Prop({ type: Date })
  firstOccurredAt: Date;

  @Prop({ type: Date })
  lastOccurredAt: Date;

  @Prop({ type: Date })
  acknowledgedAt: Date;

  @Prop({ type: String })
  acknowledgedBy: string;

  @Prop({ type: Date })
  resolvedAt: Date;

  @Prop({ type: String })
  resolvedBy: string;

  @Prop({ type: String })
  resolutionNotes: string;

  // Additional Details
  @Prop({ type: Object })
  metadata: Record<string, any>;

  @Prop({ type: [String], default: [] })
  tags: string[];

  // Notifications
  @Prop({ type: Boolean, default: false })
  notificationSent: boolean;

  @Prop({ type: [String], default: [] })
  notifiedUsers: string[];

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

export const AlertSchema = SchemaFactory.createForClass(Alert);

// Indexes for performance
AlertSchema.index({ type: 1, status: 1 });
AlertSchema.index({ severity: 1, status: 1 });
AlertSchema.index({ entityIdPath: 1, status: 1 });
AlertSchema.index({ userId: 1, status: 1 });
AlertSchema.index({ sessionId: 1, status: 1 });
AlertSchema.index({ createdAt: -1 });
AlertSchema.index({ lastOccurredAt: -1 });

