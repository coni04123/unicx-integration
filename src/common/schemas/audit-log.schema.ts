import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AuditLogDocument = AuditLog & Document;

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  CONFIG_CHANGE = 'CONFIG_CHANGE',
  PERMISSION_CHANGE = 'PERMISSION_CHANGE',
  SESSION_CREATE = 'SESSION_CREATE',
  SESSION_DELETE = 'SESSION_DELETE',
  MESSAGE_SEND = 'MESSAGE_SEND',
  MESSAGE_RECEIVE = 'MESSAGE_RECEIVE',
}

export enum AuditResource {
  USER = 'USER',
  ENTITY = 'ENTITY',
  WHATSAPP_SESSION = 'WHATSAPP_SESSION',
  MESSAGE = 'MESSAGE',
  SPY_CONFIG = 'SPY_CONFIG',
  TENANT = 'TENANT',
  SYSTEM_CONFIG = 'SYSTEM_CONFIG',
  AUDIT_LOG = 'AUDIT_LOG',
}

export enum AuditResult {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
}

@Schema({ timestamps: true })
export class AuditLog {
  @Prop({ required: true, enum: AuditAction })
  action: AuditAction;

  @Prop({ required: true, enum: AuditResource })
  resource: AuditResource;

  @Prop({ required: true })
  resourceId: string;

  @Prop({ required: true })
  resourceName: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({ required: true })
  userEmail: string;

  @Prop({ required: true })
  userName: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Tenant' })
  tenantId: Types.ObjectId;

  @Prop({ required: true })
  tenantName: string;

  @Prop({ required: true, enum: AuditResult })
  result: AuditResult;

  @Prop({ type: Object })
  oldValues?: Record<string, any>;

  @Prop({ type: Object })
  newValues?: Record<string, any>;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop({ required: true })
  ipAddress: string;

  @Prop({ required: true })
  userAgent: string;

  @Prop()
  errorMessage?: string;

  @Prop({ default: true })
  isActive: boolean;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

// Indexes for better query performance
AuditLogSchema.index({ tenantId: 1, createdAt: -1 });
AuditLogSchema.index({ userId: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, resource: 1 });
AuditLogSchema.index({ resourceId: 1 });
AuditLogSchema.index({ createdAt: -1 });
