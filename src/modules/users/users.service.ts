import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef, Logger } from '@nestjs/common';
import { DLQService } from '../dlq/dlq.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, RegistrationStatus, UserRole, WhatsAppConnectionStatus } from '../../common/schemas/user.schema';
import { Entity } from '../../common/schemas/entity.schema';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../email/email.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { SYSTEM_ENTITY_ID, isSystemAdmin } from '../../common/constants/system-entity';
import { BulkInviteUserDto } from './dto/bulk-invite-user.dto';
import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';
const bcrypt = require('bcryptjs');

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name)
    private userModel: Model<User>,
    @InjectModel(Entity.name)
    private entityModel: Model<Entity>,
    private authService: AuthService,
    private emailService: EmailService,
    @Inject(forwardRef(() => WhatsAppService))
    private whatsappService: WhatsAppService,
    private dlqService: DLQService,
  ) {}

  async create(createUserDto: CreateUserDto, createdBy: string): Promise<User> {
    const { phoneNumber, email, firstName, lastName, entityId, tenantId, role } = createUserDto;

    // Validate E164 phone number only if provided (required for User, optional for TenantAdmin)
    let e164Phone = null;
    if (phoneNumber) {
      if (!isValidPhoneNumber(phoneNumber)) {
        throw new BadRequestException('Invalid phone number format');
      }
      const parsedPhone = parsePhoneNumber(phoneNumber);
      e164Phone = parsedPhone.format('E.164');
    } else if (role !== UserRole.TENANT_ADMIN) {
      // Phone number is required for regular Users
      throw new BadRequestException('Phone number is required for User role');
    }

    // Check if user already exists
    const existingUserQuery: any[] = [{ email }];
    if (e164Phone) {
      existingUserQuery.push({ phoneNumber: e164Phone });
    }
    
    const existingUser = await this.userModel.findOne({
      $or: existingUserQuery,
    });

    if (existingUser) {
      throw new BadRequestException('User with this phone number or email already exists');
    }

    // Validate entity exists
    const entity = await this.entityModel.findOne({
      _id: entityId,
      isActive: true,
    });

    if (!entity) {
      throw new NotFoundException('Entity not found');
    }

    // Generate password hash
    // const password = await this.authService.hashPassword("tenant123");
    const password = bcrypt.hashSync('tenant123', 12);

    // Build user data - only include phoneNumber if provided
    const userData: any = {
      email,
      firstName,
      lastName,
      password,
      entityId,
      entityPath: entity.path,
      tenantId: entity.tenantId,
      role: role || UserRole.USER,
      registrationStatus: RegistrationStatus.REGISTERED,
      createdBy,
    };
    
    // Only include phoneNumber if it exists (not null/undefined)
    if (e164Phone) {
      userData.phoneNumber = e164Phone;
    }

    const user = new this.userModel(userData);

    return user.save();
  }

  async findAll(tenantId: string, filters?: any): Promise<{ users: User[], total: number, page: number, limit: number, totalPages: number }> {
    const query: any = { isActive: true };

    // Only filter by tenantId if provided (SystemAdmin has no tenantId)
    if (tenantId && tenantId !== '') {
      query.tenantId = new Types.ObjectId(tenantId);
    }

    if (filters?.registrationStatus) {
      query.registrationStatus = filters.registrationStatus;
    }

    if (filters?.role) {
      query.role = filters.role;
    }

    if (filters?.entityId) {
      if (filters?.entityId !== SYSTEM_ENTITY_ID.toString())
        query.entityIdPath = new Types.ObjectId(filters.entityId);
    }

    if (filters?.whatsappConnectionStatus) {
      query.whatsappConnectionStatus = filters.whatsappConnectionStatus;
    }

    if (filters?.search) {
      query.$or = [
        { firstName: { $regex: filters.search, $options: 'i' } },
        { lastName: { $regex: filters.search, $options: 'i' } },
        { email: { $regex: filters.search, $options: 'i' } },
        { phoneNumber: { $regex: filters.search, $options: 'i' } },
      ];
    }

    // Pagination
    const page = parseInt(filters?.page) || 1;
    const limit = parseInt(filters?.limit) || 10;
    const skip = (page - 1) * limit;

    // Get total count for pagination
    const total = await this.userModel.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

    // Get paginated users
    const users = await this.userModel
      .find(query)
      .populate('entityId', 'name path type')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Get WhatsApp QR codes for users with phone numbers
    const usersWithQR = await Promise.all(users.map(async (user) => {
      const userObj = user.toObject();
      
      if (user.phoneNumber) {
        try {
          const sessionId = `whatsapp-${user.phoneNumber.slice(1)}`;
          const qrData = await this.whatsappService.getQRCode(sessionId);
          if (qrData) {
            return {
              ...userObj,
              whatsappQR: {
                qrCode: qrData.qrCode,
                expiresAt: qrData.expiresAt,
                sessionId: sessionId
              }
            };
          }
        } catch (error) {
          this.logger.warn(`Failed to get QR code for user ${user._id}: ${error.message}`);
        }
      }
      
      return userObj;
    }));

    return {
      users: usersWithQR,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async findOne(id: string, tenantId: string): Promise<User> {
    const user = await this.userModel.findOne({
      _id: new Types.ObjectId(id),
      isActive: true,
    }).populate('entity', 'name path type');

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async findByPhoneNumber(phoneNumber: string, tenantId: string): Promise<User> {
    const query: any = {
      phoneNumber,
      isActive: true,
    };
    
    // Only filter by tenantId if provided (SystemAdmin has no tenantId)
    if (tenantId && tenantId !== '') {
      query.tenantId = new Types.ObjectId(tenantId);
    }
    
    const user = await this.userModel.findOne(query);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto, updatedBy: string, tenantId: string): Promise<User> {
    const user = await this.findOne(id, tenantId);

    const updateData: any = {
      ...updateUserDto,
      updatedBy,
    };

    // If phone number is being updated, validate E164 format
    if (updateUserDto.phoneNumber) {
      if (!isValidPhoneNumber(updateUserDto.phoneNumber)) {
        throw new BadRequestException('Invalid phone number format');
      }
      const parsedPhone = parsePhoneNumber(updateUserDto.phoneNumber);
      updateData.phoneNumber = parsedPhone.format('E.164');
    }

    // If entity is being updated, validate and update path
    if (updateUserDto.entityId) {
      const entity = await this.entityModel.findOne({
        _id: updateUserDto.entityId,
        tenantId,
        isActive: true,
      });

      if (!entity) {
        throw new NotFoundException('Entity not found');
      }

      updateData.entityPath = entity.path;
    }

    // If password is being updated, hash it
    if (updateUserDto.password) {
      updateData.password = await this.authService.hashPassword(updateUserDto.password);
    }

    return this.userModel.findByIdAndUpdate(id, updateData, { new: true });
  }

  async inviteUser(inviteUserDto: InviteUserDto, invitedBy: string, retryCount: number = 0): Promise<User> {
    const { phoneNumber, email, firstName, lastName, entityId, tenantId, role } = inviteUserDto;

    // Validate E164 phone number only if provided (required for User, optional for TenantAdmin)
    let e164Phone = null;
    if (phoneNumber) {
      if (!isValidPhoneNumber(phoneNumber)) {
        throw new BadRequestException('Invalid phone number format');
      }
      const parsedPhone = parsePhoneNumber(phoneNumber);
      e164Phone = parsedPhone.format('E.164');
    } else if (role !== UserRole.TENANT_ADMIN) {
      // Phone number is required for regular Users
      throw new BadRequestException('Phone number is required for User role');
    }

    // Check if user already exists
    const existingUserQuery: any[] = [{ email }];
    if (e164Phone) {
      existingUserQuery.push({ phoneNumber: e164Phone });
    }
    
    const existingUser = await this.userModel.findOne({
      $or: existingUserQuery,
    });

    if (existingUser) {
      throw new BadRequestException('User with this phone number or email already exists');
    }

    // Validate entity exists
    const entity = await this.entityModel.findOne({
      _id: new Types.ObjectId(entityId),
      isActive: true,
    });

    if (!entity) {
      throw new NotFoundException('Entity not found');
    }

    // Generate password hash for user
    const hashedPassword = bcrypt.hashSync('Welcome@123', 12);

    const newUserId:Types.ObjectId = new Types.ObjectId();

    // Build user data - only include phoneNumber if provided
    const userData: any = {
      _id: newUserId,
      email,
      firstName,
      lastName,
      password: hashedPassword,
      entityId: new Types.ObjectId(entityId),
      entityIdPath: entity.entityIdPath,
      entityPath: entity.path,
      tenantId: entity.tenantId,
      role: role || UserRole.USER,
      registrationStatus: RegistrationStatus.INVITED,
      createdBy: invitedBy,
    };
    
    // Only include phoneNumber if it exists (not null/undefined)
    if (e164Phone) {
      userData.phoneNumber = e164Phone;
    }

    const user = new this.userModel(userData);

    const savedUser = await user.save();

    // Declare qrCodeData at method level
    let qrCodeData = null;

    // Create WhatsApp session and send QR code via email (only for users with phone numbers)
    if (e164Phone) {
        try {
          const sessionId = `whatsapp-${e164Phone.slice(1)}`;
          this.logger.log(`Creating WhatsApp session for user: ${sessionId}`);
          
          await this.whatsappService.createSession(
            sessionId,
            newUserId,
            invitedBy,
            entityId,
            entity.tenantId.toString(),
          );

      // Try to get QR code
      try {
        qrCodeData = await this.whatsappService.getQRCode(sessionId);
        if (qrCodeData) {
          this.logger.log(`QR code generated for session: ${sessionId}`);
        }
      } catch (error) {
        this.logger.warn(`Failed to get QR code: ${error.message}`);
        
        // Send to DLQ for retry
        await this.dlqService.sendToDLQ(
          {
            email,
            firstName,
            lastName,
            entity,
            sessionId,
            type: 'user-invitation-qr'
          },
          error,
          {
            topic: 'user-qr-codes',
            subscription: 'qr-retry',
            maxRetries: 3,
            retryDelay: 60000 // 1 minute
          }
        );
        throw error;
      }

          // Send invitation email with QR code
          if (qrCodeData) {
            await this.emailService.sendInvitationEmailWithQR(email, {
              firstName,
              lastName,
              qrCode: qrCodeData.qrCode,
              sessionId,
              expiresAt: qrCodeData.expiresAt,
            });
            this.logger.log(`Invitation email with QR code sent to ${email}`);
          } else {
            // Update WhatsApp connection status to FAILED and send invitation without QR code
            this.logger.warn(`QR code not generated in time for session: ${sessionId}`);
            await this.updateWhatsAppConnectionStatus(
              newUserId.toString(),
              WhatsAppConnectionStatus.FAILED,
              entity.tenantId.toString()
            );
            await this.emailService.sendInvitationEmail(email, 'invitation', {
              firstName,
              lastName,
              subject: 'Welcome to UNICX - WhatsApp Setup Required',
              message: 'Your WhatsApp connection could not be established automatically. Please contact support for assistance in setting up your WhatsApp connection.',
            });
          }
        } catch (error) {
          this.logger.error(`Failed to create WhatsApp session or send email: ${error.message}`, error);
          // Don't fail user creation if WhatsApp/email fails
        }
    } else {
      // For TenantAdmin without phone number, send a beautiful admin invitation email
      this.logger.log(`Sending Tenant Admin invitation to: ${email}`);
      try {
        await this.emailService.sendInvitationEmail(email, 'tenant-admin-invitation', {
          firstName,
          lastName,
          subject: 'Welcome to UNICX - Tenant Administrator Access',
          role: 'Tenant Administrator',
          entity: {
            name: entity.name,
            path: entity.path,
            type: entity.type
          },
          loginUrl: process.env.FRONTEND_URL + '/login',
          features: [
            {
              title: 'User Management',
              description: 'Invite and manage users within your organization'
            },
            {
              title: 'Entity Structure',
              description: 'Organize your company structure and departments'
            },
            {
              title: 'Communication Monitoring',
              description: 'Monitor and analyze WhatsApp communications'
            },
            {
              title: 'Advanced Analytics',
              description: 'Access detailed reports and analytics'
            }
          ],
          supportEmail: process.env.SUPPORT_EMAIL || 'support@unicx.com',
          companyName: process.env.COMPANY_NAME || 'UNICX',
          companyAddress: process.env.COMPANY_ADDRESS || '123 Business Street, Tech City',
          socialLinks: {
            website: process.env.COMPANY_WEBSITE || 'https://unicx.com',
            linkedin: process.env.COMPANY_LINKEDIN,
            twitter: process.env.COMPANY_TWITTER
          }
        });
        this.logger.log(`Tenant Admin invitation email sent to ${email}`);
      } catch (error) {
        this.logger.error(`Failed to send Tenant Admin invitation email: ${error.message}`, error);
        
        // Send to DLQ for retry if not already from DLQ
        if (retryCount === 0) {
          await this.dlqService.sendToDLQ(
            {
              email,
              firstName,
              lastName,
              entity,
              type: 'tenant-admin-invitation'
            },
            error,
            {
              topic: 'user-invitations',
              subscription: 'invitation-retry',
              maxRetries: 3,
              retryDelay: 300000, // 5 minutes
            }
          );
        }
        // Don't fail user creation if email fails
      }
    }

    return savedUser;
  }

  async bulkInviteUsers(bulkInviteDto: BulkInviteUserDto, invitedBy: string): Promise<{ success: number; failed: number; errors: any[] }> {
    const { users, tenantId } = bulkInviteDto;
    let success = 0;
    let failed = 0;
    const errors: any[] = [];

    for (const userData of users) {
      try {
        await this.inviteUser({ ...userData, tenantId }, invitedBy);
        success++;
      } catch (error) {
        failed++;
        errors.push({
          user: userData,
          error: error.message,
        });
      }
    }

    return { success, failed, errors };
  }

  async updateRegistrationStatus(
    id: string,
    status: RegistrationStatus,
    updatedBy: string,
    tenantId: string,
  ): Promise<User> {
    const user = await this.findOne(id, tenantId);

    const updateData: any = {
      registrationStatus: status,
      updatedBy,
    };

    if (status === RegistrationStatus.REGISTERED) {
      updateData.registeredAt = new Date();
    }

    return this.userModel.findByIdAndUpdate(id, updateData, { new: true });
  }

  async updateWhatsAppConnectionStatus(
    id: string,
    status: WhatsAppConnectionStatus,
    tenantId: string,
  ): Promise<User> {
    const user = await this.findOne(id, tenantId);

    const updateData: any = {
      whatsappConnectionStatus: status,
    };

    if (status === WhatsAppConnectionStatus.CONNECTED) {
      updateData.whatsappConnectedAt = new Date();
    }

    return this.userModel.findByIdAndUpdate(id, updateData, { new: true });
  }

  async remove(id: string, deletedBy: string, tenantId: string): Promise<void> {
    await this.findOne(id, tenantId);

    // Soft delete
    await this.userModel.findByIdAndUpdate(new Types.ObjectId(id), {
      isActive: false,
      updatedBy: deletedBy,
    });
  }

  async getUserStats(tenantId: string): Promise<any> {
    // Build match query - only include tenantId if provided (SystemAdmin has no tenantId)
    const matchQuery: any = { isActive: true };
    if (tenantId && tenantId !== '') {
      matchQuery.tenantId = new Types.ObjectId(tenantId);
    }

    const stats = await this.userModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$registrationStatus',
          count: { $sum: 1 },
        },
      },
    ]);

    const roleStats = await this.userModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 },
        },
      },
    ]);

    const whatsappStats = await this.userModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$whatsappConnectionStatus',
          count: { $sum: 1 },
        },
      },
    ]);

    const totalUsers = await this.userModel.countDocuments(matchQuery);
    const onlineUsersQuery = { ...matchQuery, isOnline: true };
    const onlineUsers = await this.userModel.countDocuments(onlineUsersQuery);

    return {
      totalUsers,
      onlineUsers,
      byRegistrationStatus: stats,
      byRole: roleStats,
      byWhatsAppStatus: whatsappStats,
    };
  }

  /**
   * Check if a user is a System Administrator
   * @param user - The user object to check
   * @returns true if the user is a System Administrator
   */
  isSystemAdmin(user: User): boolean {
    return isSystemAdmin(user);
  }

  /**
   * Get the System entity ID constant
   * @returns The System entity ObjectId
   */
  getSystemEntityId(): Types.ObjectId {
    return SYSTEM_ENTITY_ID;
  }

  /**
   * Process failed invitations from DLQ
   */
  /**
   * Process QR code generation retries from DLQ
   */
  async processQRCodeDLQ(): Promise<void> {
    await this.dlqService.processDLQ(
      'user-qr-codes',
      'qr-retry',
      async (message) => {
        if (message.type === 'qr-code-regeneration') {
          // Retry QR code regeneration
          const { userId, tenantId, sessionId } = message;
          await this.regenerateQRCode(userId, tenantId);
        } else if (message.type === 'user-invitation-qr') {
          // Retry QR code generation for new user
          const { email, firstName, lastName, entity, sessionId } = message;
          const qrCodeData = await this.whatsappService.getQRCode(sessionId);
          if (qrCodeData) {
            await this.emailService.sendInvitationEmailWithQR(email, {
              firstName,
              lastName,
              qrCode: qrCodeData.qrCode,
              sessionId,
              expiresAt: qrCodeData.expiresAt,
            });
          }
        }
      }
    );
  }

  /**
   * Process invitation email retries from DLQ
   */
  async processInvitationDLQ(): Promise<void> {
    await this.dlqService.processDLQ(
      'user-invitations',
      'invitation-retry',
      async (message) => {
        const { email, firstName, lastName, entity, type } = message;
        
        if (type === 'tenant-admin-invitation') {
          await this.emailService.sendInvitationEmail(email, type, {
            firstName,
            lastName,
            subject: 'Welcome to UNICX - Tenant Administrator Access',
            role: 'Tenant Administrator',
            entity,
            loginUrl: process.env.FRONTEND_URL + '/login',
            features: [
              {
                title: 'User Management',
                description: 'Invite and manage users within your organization'
              },
              {
                title: 'Entity Structure',
                description: 'Organize your company structure and departments'
              },
              {
                title: 'Communication Monitoring',
                description: 'Monitor and analyze WhatsApp communications'
              },
              {
                title: 'Advanced Analytics',
                description: 'Access detailed reports and analytics'
              }
            ],
            supportEmail: process.env.SUPPORT_EMAIL || 'support@unicx.com',
            companyName: process.env.COMPANY_NAME || 'UNICX',
            companyAddress: process.env.COMPANY_ADDRESS || '123 Business Street, Tech City',
            socialLinks: {
              website: process.env.COMPANY_WEBSITE || 'https://unicx.com',
              linkedin: process.env.COMPANY_LINKEDIN,
              twitter: process.env.COMPANY_TWITTER
            }
          });
        } else {
          await this.emailService.sendInvitationEmailWithQR(email, {
            firstName,
            lastName,
            qrCode: message.qrCode,
            sessionId: message.sessionId,
            expiresAt: message.expiresAt,
          });
        }
      }
    );
  }

  async searchUsers(query: string, tenantId: string): Promise<User[]> {
    const searchQuery: any = {
      isActive: true,
      $or: [
        { firstName: { $regex: query, $options: 'i' } },
        { lastName: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } },
        { phoneNumber: { $regex: query, $options: 'i' } },
      ],
    };
    
    // Only filter by tenantId if provided (SystemAdmin has no tenantId)
    if (tenantId && tenantId !== '') {
      searchQuery.tenantId = new Types.ObjectId(tenantId);
    }
    
    return this.userModel.find(searchQuery).limit(20);
  }

  /**
   * Regenerate WhatsApp QR code for a user
   * @param userId - The ID of the user
   * @param tenantId - The tenant ID
   * @returns Object containing the new QR code data
   */
  async regenerateQRCode(userId: string, tenantId: string): Promise<{ qrCode: string; expiresAt: Date; sessionId: string }> {
    // Find the user and verify they have a phone number
    const user = await this.findOne(userId, tenantId);
    if (!user.phoneNumber) {
      throw new BadRequestException('User does not have a phone number configured');
    }

    const sessionId = `whatsapp-${user.phoneNumber.slice(1)}`;

    try {
      // Disconnect existing session if any
      await this.whatsappService.disconnectSession(sessionId);
      // Create new session
      await this.whatsappService.createSession(
        sessionId,
        new Types.ObjectId(userId),
        userId, // Use the user's ID as the creator since we don't have updatedBy/createdBy
        user.entityId.toString(),
        user.tenantId.toString(),
      );


      // Update user status to connecting
      await this.updateWhatsAppConnectionStatus(
        userId,
        WhatsAppConnectionStatus.CONNECTING,
        tenantId
      );

      // Try to get QR code
      let qrCodeData = null;
      try {
        qrCodeData = await this.whatsappService.getQRCode(sessionId);
        if (qrCodeData) {
          this.logger.log(`QR code generated for session: ${sessionId}`);
        }
      } catch (error) {
        this.logger.warn(`Failed to get QR code: ${error.message}`);
        
        // Send to DLQ for retry
        await this.dlqService.sendToDLQ(
          {
            userId,
            tenantId,
            sessionId,
            type: 'qr-code-regeneration'
          },
          error,
          {
            topic: 'user-qr-codes',
            subscription: 'qr-retry',
            maxRetries: 3,
            retryDelay: 60000 // 1 minute
          }
        );

        // Update status to failed
        await this.updateWhatsAppConnectionStatus(
          userId,
          WhatsAppConnectionStatus.FAILED,
          tenantId
        );
        throw error;
      }

      if (!qrCodeData) {
        // Update status to failed if QR generation failed
        await this.updateWhatsAppConnectionStatus(
          userId,
          WhatsAppConnectionStatus.FAILED,
          tenantId
        );
        throw new Error('Failed to generate QR code after multiple attempts');
      }

      // Update status to QR_REQUIRED since we successfully got a QR code
      await this.updateWhatsAppConnectionStatus(
        userId,
        WhatsAppConnectionStatus.CONNECTING,
        tenantId
      );

      console.log({
        qrCode: qrCodeData.qrCode,
        expiresAt: qrCodeData.expiresAt,
        sessionId
      });

      return {
        qrCode: qrCodeData.qrCode,
        expiresAt: qrCodeData.expiresAt,
        sessionId
      };
    } catch (error) {
      // Update status to failed on error
      await this.updateWhatsAppConnectionStatus(
        userId,
        WhatsAppConnectionStatus.FAILED,
        tenantId
      );
      throw new BadRequestException(`Failed to regenerate QR code: ${error.message}`);
    }
  }
}
