import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WhatsAppQR = {
  qrCode: string;
  expiresAt: Date;
  sessionId: string;
};

export type UserDocument = User & Document & {
  whatsappQR?: WhatsAppQR;
};

export enum UserRole {
  SYSTEM_ADMIN = 'SystemAdmin',
  TENANT_ADMIN = 'TenantAdmin',
  USER = 'User',
}

export enum RegistrationStatus {
  PENDING = 'pending',
  INVITED = 'invited',
  REGISTERED = 'registered',
  CANCELLED = 'cancelled',
}

export enum WhatsAppConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  FAILED = 'failed',
}

@Schema({ timestamps: true })
export class UserPreferences {
  @Prop({ default: 'en' })
  language: string;

  @Prop({ default: 'UTC' })
  timezone: string;

  @Prop({ default: true })
  emailNotifications: boolean;

  @Prop({ default: true })
  pushNotifications: boolean;

  @Prop({ default: true })
  whatsappNotifications: boolean;
}

@Schema({ timestamps: true })
export class QRInvitationHistory {
  @Prop({ required: true })
  qrCodeId: string;

  @Prop({ required: true })
  sentAt: Date;

  @Prop({ required: true, default: 1 })
  attemptCount: number;

  @Prop()
  scannedAt: Date;

  @Prop()
  expiredAt: Date;

  @Prop({ default: false })
  isExpired: boolean;
}

@Schema({ timestamps: true })
export class User {
  @Prop({ type: Types.ObjectId, auto: true })
  _id: Types.ObjectId;

  @Prop({ required: false, sparse: true })
  phoneNumber: string; // E164 format - Optional for TenantAdmin

  @Prop({ required: true })
  firstName: string;

  @Prop({ required: true })
  lastName: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ required: true, enum: RegistrationStatus, default: RegistrationStatus.PENDING })
  registrationStatus: RegistrationStatus;

  @Prop({ required: true, enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Prop({ type: Object, required: false })
  entity: Object;

  @Prop({ type: Types.ObjectId, ref: 'Entity', required: true })
  entityId: Types.ObjectId;

  @Prop({ required: true })
  entityPath: string;

  @Prop({ type: [Types.ObjectId], ref: 'Entity', default: [] })
  entityIdPath: Types.ObjectId[]; // Array of all ancestor entity IDs from root to current entity

  @Prop({ type: Types.ObjectId, ref: 'Entity', required: false })
  tenantId: Types.ObjectId; // Root/first ancestor entity ID for tenant isolation

  @Prop({ type: Types.ObjectId, ref: 'Entity' })
  companyId: Types.ObjectId; // Nearest ancestor entity with type 'company'

  @Prop({ enum: WhatsAppConnectionStatus, default: WhatsAppConnectionStatus.DISCONNECTED })
  whatsappConnectionStatus: WhatsAppConnectionStatus;

  @Prop()
  whatsappConnectedAt: Date;

  @Prop({ type: [QRInvitationHistory], default: [] })
  qrInvitationHistory: QRInvitationHistory[];

  @Prop({ type: UserPreferences, default: () => new UserPreferences() })
  preferences: UserPreferences;

  @Prop()
  avatar: string;

  @Prop()
  initials: string;

  @Prop({ default: false })
  isOnline: boolean;

  @Prop()
  lastSeenAt: Date;

  @Prop({ required: true, default: true })
  isActive: boolean;

  @Prop({ select: false })
  resetPasswordToken: string;

  @Prop()
  resetPasswordExpires: Date;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Indexes for performance
// Use partial index to ensure uniqueness only for non-null phone numbers
UserSchema.index(
  { phoneNumber: 1 },
  { 
    unique: true,
    sparse: true,
    partialFilterExpression: { phoneNumber: { $type: 'string' } }
  }
);
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ tenantId: 1, isActive: 1 });
UserSchema.index({ entityId: 1 });
UserSchema.index({ companyId: 1 });
UserSchema.index({ entityIdPath: 1 });
UserSchema.index({ registrationStatus: 1, tenantId: 1 });
UserSchema.index({ role: 1, tenantId: 1 });
UserSchema.index({ whatsappConnectionStatus: 1 });

// Virtual for full name
UserSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Auto-generate initials
UserSchema.pre('save', function () {
  if (this.isModified('firstName') || this.isModified('lastName')) {
    this.initials = `${this.firstName.charAt(0)}${this.lastName.charAt(0)}`.toUpperCase();
  }
});

UserSchema.set('toJSON', { virtuals: true });
UserSchema.set('toObject', { virtuals: true });
