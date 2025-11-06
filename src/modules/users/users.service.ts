import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, RegistrationStatus, UserRole, WhatsAppConnectionStatus } from '../../common/schemas/user.schema';
import { Entity } from '../../common/schemas/entity.schema';
import { AuthService } from '../auth/auth.service';
import { EmailService } from '../email/email.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { SYSTEM_ENTITY_ID, isSystemAdmin, isSystemEntity } from '../../common/constants/system-entity';
import { BulkInviteUserDto } from './dto/bulk-invite-user.dto';
import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';
import { randomUUID } from 'crypto';
import { isEmpty } from 'class-validator';

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
  ) {}

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
    // Validate id is provided
    if (!id) {
      throw new BadRequestException('User ID is required');
    }

    // Trim whitespace and convert to string
    const trimmedId = String(id).trim();

    // Validate id is a valid ObjectId format
    if (!Types.ObjectId.isValid(trimmedId)) {
      this.logger.error(`Invalid user ID format: "${trimmedId}" (original: "${id}", type: ${typeof id}, length: ${trimmedId.length})`);
      throw new BadRequestException(`Invalid user ID format. Please log out and log back in to refresh your authentication token. Received: "${trimmedId}"`);
    }

    try {
      const query: any = {
        _id: new Types.ObjectId(trimmedId),
        isActive: true,
      };

      // Only filter by tenantId if provided and valid (SystemAdmin has no tenantId)
      const trimmedTenantId = tenantId ? String(tenantId).trim() : '';
      if (trimmedTenantId && trimmedTenantId !== '' && Types.ObjectId.isValid(trimmedTenantId)) {
        query.tenantId = new Types.ObjectId(trimmedTenantId);
      }

      let user = await this.userModel.findOne(query).populate('entity', 'name path type');

      // If user not found and we filtered by tenantId, try without tenantId filter
      // This handles SystemAdmin users who might not have a tenantId
      if (!user && trimmedTenantId && trimmedTenantId !== '') {
        const fallbackQuery: any = {
          _id: new Types.ObjectId(trimmedId),
          isActive: true,
        };
        this.logger.debug(`User not found with tenantId filter, trying without tenantId: ${trimmedTenantId}`);
        user = await this.userModel.findOne(fallbackQuery).populate('entity', 'name path type');
      }

      if (!user) {
        this.logger.error(`User not found with ID: ${trimmedId}, tenantId: ${trimmedTenantId || 'none'}`);
        throw new NotFoundException('User not found');
      }

      return user;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error finding user with ID ${trimmedId}:`, error);
      throw new BadRequestException(`Failed to find user: ${error.message}`);
    }
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
    // Validate id is provided
    if (!id) {
      throw new BadRequestException('User ID is required');
    }

    // Trim whitespace and convert to string
    const trimmedId = String(id).trim();

    // Validate id is a valid ObjectId format
    if (!Types.ObjectId.isValid(trimmedId)) {
      this.logger.error(`Invalid user ID format in update: "${trimmedId}" (original: "${id}", type: ${typeof id})`);
      throw new BadRequestException(`Invalid user ID format: ${trimmedId}`);
    }

    // Trim tenantId if provided
    const trimmedTenantId = tenantId ? String(tenantId).trim() : '';

    const user = await this.findOne(trimmedId, trimmedTenantId);

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

    // If email is being updated, check if it's different
    if (updateUserDto.email && updateUserDto.email !== user.email) {
      // Normalize email to lowercase for comparison
      const normalizedNewEmail = updateUserDto.email.toLowerCase().trim();
      
      // Check if new email already exists
      const existingUser = await this.userModel.findOne({
        _id: { $ne: new Types.ObjectId(trimmedId) },
        isActive: true,
        email: normalizedNewEmail,
      });

      if (existingUser) {
        throw new BadRequestException('This email address is already in use. Please choose a different email address.');
      }

      // Directly update the email (no verification required)
      updateData.email = normalizedNewEmail;
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

    const updatedUser = await this.userModel.findByIdAndUpdate(new Types.ObjectId(trimmedId), updateData, { new: true });

    if (!updatedUser) {
      throw new NotFoundException('User not found after update');
    }

    // // If email was changed, send verification email
    // if (updateUserDto.email && updateUserDto.email !== user.email) {
    //   try {
    //     const frontendUrl = process.env.FRONTEND_URL || 'https://localhost:3000';
    //     const verificationLink = `${frontendUrl}/verify-email?token=${updateData.emailVerificationToken}&userId=${trimmedId}`;
        
    //     await this.emailService.sendEmailVerificationEmail(
    //       updateData.pendingEmail,
    //       {
    //         firstName: updatedUser.firstName,
    //         lastName: updatedUser.lastName,
    //         verificationLink,
    //         expiryHours: 24,
    //       }
    //     );
    //   } catch (error) {
    //     this.logger.error(`Failed to send email verification email: ${error.message}`);
    //     // Don't throw error - email update was saved, just verification email failed
    //   }
    // }

    return updatedUser;
  }

  async inviteUser(inviteUserDto: InviteUserDto, invitedBy: string): Promise<User> {
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
    const randomPassword = randomUUID(); 
    const hashedPassword = await this.authService.hashPassword(randomPassword);

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
      registrationStatus: RegistrationStatus.REGISTERED,
      createdBy: invitedBy,
    };
    
    // Only include phoneNumber if it exists (not null/undefined)
    if (e164Phone) {
      userData.phoneNumber = e164Phone;
    }

    const user = new this.userModel(userData);

    const savedUser = await user.save();

    // Declare qrCodeData at method level
    // let qrCodeData = null;

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
        // try {
        //   qrCodeData = await this.whatsappService.getQRCode(sessionId);
        //   if (qrCodeData) {
        //     this.logger.log(`QR code generated for session: ${sessionId}`);
        //   }
        // } catch (error) {
        //   this.logger.warn(`Failed to get QR code: ${error.message}`);
        //   throw error;
        // }

        // Send invitation email with QR code
        // if (qrCodeData) {
        //   await this.emailService.sendInvitationEmailWithQR(email, {
        //     firstName,
        //     lastName,
        //     qrCode: qrCodeData.qrCode,
        //     sessionId,
        //     expiresAt: qrCodeData.expiresAt,
        //   });
        //   this.logger.log(`Invitation email with QR code sent to ${email}`);
        // } else {
        //   // Update WhatsApp connection status to FAILED and send invitation without QR code
        //   this.logger.warn(`QR code not generated in time for session: ${sessionId}`);
        //   await this.updateWhatsAppConnectionStatus(
        //     newUserId.toString(),
        //     WhatsAppConnectionStatus.FAILED,
        //     entity.tenantId.toString()
        //   );
        //   await this.emailService.sendInvitationEmail(email, 'invitation', {
        //     firstName,
        //     lastName,
        //     subject: 'Welcome to 2N5 Global - WhatsApp Setup Required',
        //     message: 'Your WhatsApp connection could not be established automatically. Please contact support for assistance in setting up your WhatsApp connection.',
        //   });
        // }
      } catch (error) {
        this.logger.error(`Failed to create WhatsApp session or send email: ${error.message}`, error);
        // Don't fail user creation if WhatsApp/email fails
      }
    } else {
      // For TenantAdmin without phone number, send a beautiful admin invitation email
      this.logger.log(`Sending Manager invitation to: ${email}`);
      try {
        await this.emailService.sendInvitationEmail(email, 'tenant-admin-invitation', {
          firstName,
          lastName,
          subject: 'Welcome to UNICX - Manager Access',
          role: 'Manager',
          tempPassword: randomPassword,
          entity: {
            name: entity.name,
          },
          logoUrl: process.env.LOGO_URL || 'https://system.2n5global.com/favicon.svg',
          loginUrl: process.env.FRONTEND_URL + '/login',
          supportEmail: process.env.SUPPORT_EMAIL || 'support@unicx.com',
          companyName: process.env.COMPANY_NAME || '2N5 Global',
          companyAddress: process.env.COMPANY_ADDRESS || '123 Business Street, Tech City',
          socialLinks: {
            website: process.env.COMPANY_WEBSITE || 'https://unicx.com',
            linkedin: process.env.COMPANY_LINKEDIN,
            twitter: process.env.COMPANY_TWITTER
          }
        });
        this.logger.log(`Manager invitation email sent to ${email}`);
      } catch (error) {
        this.logger.error(`Failed to send Manager invitation email: ${error.message}`, error);
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

  async bulkUploadUsers(bulkUploadDto: any, invitedBy: string): Promise<{ success: number; failed: number; errors: any[]; details: any[] }> {
    const { users, tenantId } = bulkUploadDto;
    let success = 0;
    let failed = 0;
    const errors: any[] = [];
    const details: any[] = [];

    let query: any = {
      isActive: true,
    };

    if (!isEmpty(tenantId))
      query.tenantId = new Types.ObjectId(tenantId);

    // Fetch all entities for this tenant to build a name-to-entity map
    const allEntities = await this.entityModel.find(query).lean();

    // Build a map of entity paths for quick lookup
    const entityPathMap = new Map<string, any>();
    allEntities.forEach(entity => {
      // Store entities by their name for lookup
      if (!entityPathMap.has(entity.name)) {
        entityPathMap.set(entity.name, []);
      }
      entityPathMap.get(entity.name).push(entity);
    });

    for (const userData of users) {
      try {
        let {phoneNumber} = userData;
        const { email, firstName, lastName, entityPathNames } = userData;

        // Validate phone number
        if (!phoneNumber) {
          throw new Error('Phone number is required');
        }

        if (String(phoneNumber)[0] !== '+')
          phoneNumber = '+' + phoneNumber;

        if (!isValidPhoneNumber(phoneNumber)) {
          throw new Error(`Invalid phone number format: ${phoneNumber}`);
        }

        const parsedPhone = parsePhoneNumber(phoneNumber);
        const e164Phone = parsedPhone.format('E.164');

        // Check if user already exists
        const existingUser = await this.userModel.findOne({
          phoneNumber: e164Phone,
          isActive: true,
        });

        if (existingUser) {
          throw new Error(`User with phone number ${e164Phone} already exists`);
        }

        // Resolve entity from path names
        let targetEntity = null;
        if (entityPathNames && entityPathNames.length > 0) {
          // Filter out empty strings
          const cleanPathNames = entityPathNames.filter(name => name && name.trim() !== '');
          
          if (cleanPathNames.length > 0) {
            // Start from root (no parent) and traverse down
            let currentParentId = null;
            
            for (let i = 0; i < cleanPathNames.length; i++) {
              const entityName = cleanPathNames[i].trim();
              const candidates = entityPathMap.get(entityName) || [];

              // Find entity with matching parent
              const matchingEntity = candidates.find(e => {
                if (currentParentId === null) {
                  return e.parentId === null || e.parentId === undefined;
                } else {
                  return e.parentId && e.parentId.toString() === currentParentId.toString();
                }
              });
              
              if (!matchingEntity) {
                throw new Error(`Entity "${entityName}" not found in path: ${cleanPathNames.join(' > ')}`);
              }
              
              // Move to next level
              currentParentId = matchingEntity._id;
              
              // If this is the last element, this is our target entity
              if (i === cleanPathNames.length - 1) {
                targetEntity = matchingEntity;
              }
            }
          }
        }

        if (!targetEntity) {
          throw new Error('Could not resolve entity from path names');
        }

        // Create user
        const tempPassword = randomUUID();
        const hashedPassword = await this.authService.hashPassword(tempPassword);

        const newUser = await this.userModel.create({
          _id: new Types.ObjectId(),
          phoneNumber: e164Phone,
          email: email || undefined,
          firstName,
          lastName,
          password: hashedPassword,
          entityId: targetEntity._id,
          entityIdPath: targetEntity.entityIdPath || [targetEntity._id],
          tenantId: tenantId ? new Types.ObjectId(tenantId) : targetEntity.entityId,
          role: UserRole.USER,
          entityPath: 'test',
          registrationStatus: RegistrationStatus.INVITED,
          isActive: true,
          invitedBy: new Types.ObjectId(invitedBy),
          invitedAt: new Date(),
        });

        // Send invitation email if email provided
        if (email) {
          try {
            this.logger.log(`User ${e164Phone} created successfully. Email: ${email}`);

            try {
              const sessionId = `whatsapp-${e164Phone.slice(1)}`;
              this.logger.log(`Creating WhatsApp session for user: ${sessionId}`);
              
              await this.whatsappService.createSession(
                sessionId,
                newUser._id,
                invitedBy,
                targetEntity._id,
                targetEntity.tenant_id,
              );
            } catch (error) {
              this.logger.error(`Failed to create WhatsApp session or send email: ${error.message}`, error);
            }

          } catch (error) {
            this.logger.warn(`Failed to send invitation email to ${email}: ${error.message}`);
          }
        }

        success++;
        details.push({
          phoneNumber: e164Phone,
          email,
          firstName,
          lastName,
          entityName: targetEntity.name,
          entityPath: targetEntity.path,
          status: 'success',
        });
      } catch (error) {
        failed++;
        errors.push({
          user: userData,
          error: error.message,
        });
        details.push({
          ...userData,
          status: 'failed',
          error: error.message,
        });
      }
    }

    return { success, failed, errors, details };
  }

  async bulkUploadManagers(bulkUploadDto: any, invitedBy: string): Promise<{ success: number; failed: number; errors: any[]; details: any[] }> {
    const { managers, tenantId } = bulkUploadDto;
    let success = 0;
    let failed = 0;
    const errors: any[] = [];
    const details: any[] = [];

    let query: any = {
      isActive: true,
    };

    if (!isEmpty(tenantId))
      query.tenantId = new Types.ObjectId(tenantId);

    // Fetch all entities for this tenant to build a name-to-entity map
    const allEntities = await this.entityModel.find(query).lean();

    // Build a map of entity paths for quick lookup
    const entityPathMap = new Map<string, any>();
    allEntities.forEach(entity => {
      // Store entities by their name for lookup
      if (!entityPathMap.has(entity.name)) {
        entityPathMap.set(entity.name, []);
      }
      entityPathMap.get(entity.name).push(entity);
    });

    for (const managerData of managers) {
      try {
        const { email, firstName, lastName, entityPathNames } = managerData;

        // Validate email
        if (!email) {
          throw new Error('Email is required');
        }

        // Normalize email to lowercase
        const normalizedEmail = email.toLowerCase().trim();

        // Check if manager already exists
        const existingManager = await this.userModel.findOne({
          email: normalizedEmail,
          isActive: true,
        });

        if (existingManager) {
          throw new Error(`Manager with email ${normalizedEmail} already exists`);
        }

        // Resolve entity from path names
        let targetEntity = null;
        if (entityPathNames && entityPathNames.length > 0) {
          // Filter out empty strings
          const cleanPathNames = entityPathNames.filter(name => name && name.trim() !== '');
          
          if (cleanPathNames.length > 0) {
            // Start from root (no parent) and traverse down
            let currentParentId = null;
            
            for (let i = 0; i < cleanPathNames.length; i++) {
              const entityName = cleanPathNames[i].trim();
              const candidates = entityPathMap.get(entityName) || [];

              // Find entity with matching parent
              const matchingEntity = candidates.find(e => {
                if (currentParentId === null) {
                  return e.parentId === null || e.parentId === undefined;
                } else {
                  return e.parentId && e.parentId.toString() === currentParentId.toString();
                }
              });
              
              if (!matchingEntity) {
                throw new Error(`Entity "${entityName}" not found in path: ${cleanPathNames.join(' > ')}`);
              }
              
              // Move to next level
              currentParentId = matchingEntity._id;
              
              // If this is the last element, this is our target entity
              if (i === cleanPathNames.length - 1) {
                targetEntity = matchingEntity;
              }
            }
          }
        }

        if (!targetEntity) {
          throw new Error('Could not resolve entity from path names');
        }

        // Create manager
        const tempPassword = randomUUID();
        const hashedPassword = await this.authService.hashPassword(tempPassword);

        const newManager = await this.userModel.create({
          _id: new Types.ObjectId(),
          email: normalizedEmail,
          firstName,
          lastName,
          password: hashedPassword,
          entityId: targetEntity._id,
          entityIdPath: targetEntity.entityIdPath || [targetEntity._id],
          tenantId: tenantId ? new Types.ObjectId(tenantId) : targetEntity.entityId,
          role: UserRole.TENANT_ADMIN,
          entityPath: 'test',
          registrationStatus: RegistrationStatus.REGISTERED,
          isActive: true,
          invitedBy: new Types.ObjectId(invitedBy),
          invitedAt: new Date(),
        });

        // Send invitation email
        try {
          this.logger.log(`Manager ${normalizedEmail} created successfully.`);
          // TODO: Send manager invitation email template
        } catch (error) {
          this.logger.warn(`Failed to send invitation email to ${normalizedEmail}: ${error.message}`);
        }

        success++;
        details.push({
          email: normalizedEmail,
          firstName,
          lastName,
          entityName: targetEntity.name,
          entityPath: targetEntity.path,
          status: 'success',
        });
      } catch (error) {
        failed++;
        errors.push({
          manager: managerData,
          error: error.message,
        });
        details.push({
          ...managerData,
          status: 'failed',
          error: error.message,
        });
      }
    }

    return { success, failed, errors, details };
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
    const user = await this.findOne(id, tenantId);

    // Disconnect WhatsApp session if user has a phone number
    if (user.phoneNumber) {
      try {
        const sessionId = `whatsapp-${user.phoneNumber.slice(1)}`;
        await this.whatsappService.disconnectSession(sessionId);
        this.logger.log(`WhatsApp session disconnected for user ${id} (${user.phoneNumber})`);
      } catch (error) {
        // Log error but don't fail the deletion if session disconnect fails
        this.logger.warn(`Failed to disconnect WhatsApp session for user ${id}: ${error.message}`);
      }
    }

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
   * Check if a user is a Administrator
   * @param user - The user object to check
   * @returns true if the user is a Administrator
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
  async verifyEmail(token: string, userId: string): Promise<User> {
    const user = await this.userModel.findOne({
      _id: new Types.ObjectId(userId),
      emailVerificationToken: token,
      isActive: true,
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    // Check if token is expired
    if (user.emailVerificationExpires && user.emailVerificationExpires < new Date()) {
      throw new BadRequestException('Verification token has expired');
    }

    // Check if there's a pending email
    if (!user.pendingEmail) {
      throw new BadRequestException('No pending email verification');
    }

    // Normalize pending email for comparison
    const normalizedPendingEmail = user.pendingEmail.toLowerCase().trim();
    
    // Check if pending email already exists for another user (in email or pendingEmail field)
    const existingUser = await this.userModel.findOne({
      _id: { $ne: new Types.ObjectId(userId) },
      isActive: true,
      $or: [
        { email: normalizedPendingEmail },
        { pendingEmail: normalizedPendingEmail },
      ],
    });

    if (existingUser) {
      throw new BadRequestException('This email address is already in use. Please choose a different email address.');
    }

    // Update email and clear verification fields
    const updatedUser = await this.userModel.findByIdAndUpdate(
      userId,
      {
        email: normalizedPendingEmail,
        emailVerified: true,
        pendingEmail: null,
        emailVerificationToken: null,
        emailVerificationExpires: null,
      },
      { new: true }
    );

    return updatedUser;
  }

  async resendEmailVerification(userId: string): Promise<void> {
    const user = await this.findOne(userId, '');

    if (!user.pendingEmail) {
      throw new BadRequestException('No pending email verification');
    }

    // Check if token is expired, regenerate if needed
    let verificationToken = user.emailVerificationToken;
    let verificationExpires = user.emailVerificationExpires;

    if (!verificationToken || !verificationExpires || verificationExpires < new Date()) {
      const crypto = require('crypto');
      verificationToken = crypto.randomBytes(32).toString('hex');
      verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await this.userModel.findByIdAndUpdate(userId, {
        emailVerificationToken: verificationToken,
        emailVerificationExpires: verificationExpires,
      });
    }

    // Send verification email
    const frontendUrl = process.env.FRONTEND_URL || 'https://localhost:3000';
    const verificationLink = `${frontendUrl}/verify-email?token=${verificationToken}&userId=${userId}`;

    await this.emailService.sendEmailVerificationEmail(
      user.pendingEmail,
      {
        firstName: user.firstName,
        lastName: user.lastName,
        verificationLink,
        expiryHours: 24,
      }
    );
  }

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
        user.tenantId ? user.tenantId.toString() : '',
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
