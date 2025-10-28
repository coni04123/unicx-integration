import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WhatsAppSessionDocument = WhatsAppSession & Document;

export enum SessionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  QR_REQUIRED = 'qr_required',
  AUTHENTICATED = 'authenticated',
  READY = 'ready',
  FAILED = 'failed',
}

@Schema({ timestamps: true })
export class WhatsAppSession {
  @Prop({ type: Types.ObjectId, auto: true })
  _id: Types.ObjectId;

  // Session Identification
  @Prop({ required: true, unique: true })
  sessionId: string; // Unique identifier for this WhatsApp session

  @Prop({ type: Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId; // User who owns this session

  @Prop({ type: Types.ObjectId, ref: 'Entity', required: true })
  entityId: Types.ObjectId;

  @Prop({ type: [Types.ObjectId], default: [] })
  entityIdPath: Types.ObjectId[]; // Array of entity IDs representing the path from root to leaf

  @Prop({ type: Types.ObjectId, ref: 'Entity', required: true })
  tenantId: Types.ObjectId;

  // WhatsApp Information
  @Prop()
  phoneNumber: string; // Connected phone number (E.164 format)

  @Prop()
  whatsappName: string; // Display name on WhatsApp

  @Prop()
  whatsappId: string; // WhatsApp ID

  // Session Status
  @Prop({ required: true, enum: SessionStatus, default: SessionStatus.DISCONNECTED })
  status: SessionStatus;

  @Prop()
  qrCode: string; // Base64 encoded QR code image

  @Prop()
  qrCodeUrl: string; // URL to QR code image

  @Prop()
  qrCodeGeneratedAt: Date;

  @Prop()
  qrCodeExpiresAt: Date;

  // Connection Tracking
  @Prop()
  connectedAt: Date;

  @Prop()
  disconnectedAt: Date;

  @Prop()
  lastActivityAt: Date;

  @Prop({ type: Number, default: 0 })
  reconnectAttempts: number;

  // Session Data (encrypted)
  @Prop({ type: String })
  sessionData: string; // Encrypted WhatsApp Web session data

  // Statistics
  @Prop({ type: Number, default: 0 })
  messagesSent: number;

  @Prop({ type: Number, default: 0 })
  messagesReceived: number;

  @Prop({ type: Number, default: 0 })
  messagesDelivered: number;

  @Prop({ type: Number, default: 0 })
  messagesFailed: number;

  // Configuration
  @Prop({ type: Object, default: {} })
  settings: Record<string, any>;

  // Flags
  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  autoReconnect: boolean;

  // Error Tracking
  @Prop()
  lastError: string;

  @Prop()
  lastErrorAt: Date;

  // Audit
  @Prop()
  createdBy: string;

  @Prop()
  updatedBy: string;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const WhatsAppSessionSchema = SchemaFactory.createForClass(WhatsAppSession);

// Indexes
WhatsAppSessionSchema.index({ sessionId: 1 }, { unique: true });
WhatsAppSessionSchema.index({ userId: 1 });
WhatsAppSessionSchema.index({ entityId: 1 });
WhatsAppSessionSchema.index({ entityIdPath: 1 });
WhatsAppSessionSchema.index({ tenantId: 1, isActive: 1 });
WhatsAppSessionSchema.index({ status: 1 });
WhatsAppSessionSchema.index({ phoneNumber: 1 });

