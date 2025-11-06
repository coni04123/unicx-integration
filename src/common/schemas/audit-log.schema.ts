import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AuditLogDocument = AuditLog & Document;

export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',
  OPTIONS = 'OPTIONS',
}

export enum AuditLogStatus {
  SUCCESS = 'success',
  ERROR = 'error',
  FAILED = 'failed',
}

@Schema({ timestamps: true })
export class AuditLog {
  @Prop({ type: Types.ObjectId, auto: true })
  _id: Types.ObjectId;

  // Request Information
  @Prop({ required: true, enum: HttpMethod })
  method: HttpMethod;

  @Prop({ required: true })
  url: string;

  @Prop({ required: true })
  path: string;

  @Prop({ type: Object, default: {} })
  queryParams: Record<string, any>;

  @Prop({ type: Object, default: {} })
  requestBody: Record<string, any>;

  @Prop({ type: Object, default: {} })
  requestHeaders: Record<string, any>;

  // Response Information
  @Prop({ required: true })
  statusCode: number;

  @Prop({ type: Object, default: {} })
  responseBody: Record<string, any>;

  @Prop({ type: Object, default: {} })
  responseHeaders: Record<string, any>;

  // User Information
  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Entity', required: false })
  tenantId: Types.ObjectId;

  @Prop({ required: false })
  userEmail: string;

  @Prop({ required: false })
  userRole: string;

  // Request Metadata
  @Prop({ required: true })
  ipAddress: string;

  @Prop({ required: false })
  userAgent: string;

  @Prop({ required: true, enum: AuditLogStatus })
  status: AuditLogStatus;

  @Prop({ required: false })
  errorMessage: string;

  @Prop({ required: false })
  errorStack: string;

  // Performance Metrics
  @Prop({ required: true, default: 0 })
  duration: number; // in milliseconds

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

// Create indexes for better query performance
AuditLogSchema.index({ userId: 1, createdAt: -1 });
AuditLogSchema.index({ tenantId: 1, createdAt: -1 });
AuditLogSchema.index({ method: 1, path: 1 });
AuditLogSchema.index({ statusCode: 1 });
AuditLogSchema.index({ status: 1 });
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ ipAddress: 1 });

