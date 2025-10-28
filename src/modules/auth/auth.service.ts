import { Injectable, UnauthorizedException, ConflictException, BadRequestException, NotFoundException, HttpStatus, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserRole } from '../../common/schemas/user.schema';
import { Entity } from '../../common/schemas/entity.schema';
import { EmailService } from '../email/email.service';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  tenantId: string;
  entityId: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    tenantId?: string;
    entityId?: string;
    entityPath?: string;
  };
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name)
    private userModel: Model<User>,
    @InjectModel(Entity.name)
    private entityModel: Model<Entity>,
    private jwtService: JwtService,
    private emailService: EmailService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.userModel.findOne({ 
      email,
      isActive: true
    }).select('+password');

    if (!user) {
      throw new UnauthorizedException({
        statusCode: HttpStatus.UNAUTHORIZED,
        message: 'No account found with this email address',
        error: 'Unauthorized'
      });
    }

    if (!user.isActive) {
      throw new UnauthorizedException({
        statusCode: HttpStatus.UNAUTHORIZED,
        message: 'This account has been deactivated',
        error: 'Unauthorized'
      });
    }

    if (user.registrationStatus !== 'registered') {
      throw new UnauthorizedException({
        statusCode: HttpStatus.UNAUTHORIZED,
        message: 'Please complete your registration before logging in',
        error: 'Unauthorized'
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException({
        statusCode: HttpStatus.UNAUTHORIZED,
        message: 'Invalid username or password',
        error: 'Unauthorized'
      });
    }

    const { password: _, ...result } = user.toObject();
    return result;
  }

  async login(user: any): Promise<LoginResponse> {
    const payload: JwtPayload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
      tenantId: user?.tenantId?.toString(),
      entityId: user?.entityId?.toString(),
    };

    const access_token = this.jwtService.sign(payload);
    const refresh_token = this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    });

    return {
      access_token,
      refresh_token,
      user: {
        id: user._id.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantId: user?.tenantId?.toString(),
        entityId: user?.entityId?.toString(),
        entityPath: user?.entityPath,
      },
    };
  }

  async refreshToken(refreshToken: string): Promise<{ access_token: string }> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });

      const user = await this.userModel.findById(payload.sub);
      if (!user || !user.isActive) {
        throw new UnauthorizedException('User not found or inactive');
      }

      const newPayload: JwtPayload = {
        sub: user._id.toString(),
        email: user.email,
        role: user.role,
        tenantId: user.tenantId?.toString(),
        entityId: user.entityId?.toString(),
      };

      return {
        access_token: this.jwtService.sign(newPayload),
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async validateToken(token: string): Promise<JwtPayload> {
    try {
      return this.jwtService.verify(token);
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  async logout(): Promise<void> {
    // Simple logout - client will remove token
    return;
  }

  async hashPassword(password: string): Promise<string> {
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
    return bcrypt.hash(password, saltRounds);
  }

  async comparePassword(password: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }

  async register(registerDto: RegisterDto): Promise<LoginResponse> {
    // Check if user already exists
    const existingUser = await this.userModel.findOne({
      $or: [{ email: registerDto.email }, { phoneNumber: registerDto.phoneNumber }],
    });

    if (existingUser) {
      throw new ConflictException('User with this email or phone number already exists');
    }

    // If entityId and tenantId not provided, find or create a default entity
    let entityId = registerDto.entityId;
    let tenantId = registerDto.tenantId;
    let entityPath = '';

    if (!entityId || !tenantId) {
      // Find the first available entity or create a default one
      const defaultEntity = await this.entityModel.findOne({ type: 'E164' });
      
      if (!defaultEntity) {
        throw new BadRequestException('No default entity available. Please contact administrator.');
      }

      entityId = defaultEntity._id.toString();
      tenantId = defaultEntity.tenantId.toString();
      entityPath = defaultEntity.path;
    } else {
      // Get entity path
      const entity = await this.entityModel.findById(entityId);
      if (!entity) {
        throw new BadRequestException('Invalid entity ID');
      }
      entityPath = entity.path;
    }

    // Hash password
    const hashedPassword = await this.hashPassword(registerDto.password);

    // Create new user
    const newUser = new this.userModel({
      phoneNumber: registerDto.phoneNumber,
      email: registerDto.email,
      firstName: registerDto.firstName,
      lastName: registerDto.lastName,
      password: hashedPassword,
      entityId: new Types.ObjectId(entityId),
      tenantId,
      entityPath,
      role: UserRole.USER,
      registrationStatus: 'registered',
      isActive: true,
    });

    const savedUser = await newUser.save();

    // Return login response with tokens
    const userObj = savedUser.toObject();
    const { password: _, ...userWithoutPassword } = userObj;
    
    return this.login(userWithoutPassword);
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<{ message: string }> {
    const { email } = forgotPasswordDto;

    // Find user by email
    const user = await this.userModel.findOne({ 
      email, 
      isActive: true 
    });

    // Always return success message to prevent email enumeration
    if (!user) {
      return { 
        message: 'If an account exists with this email, a password reset link has been sent.' 
      };
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = await bcrypt.hash(resetToken, 10);
    const resetTokenExpires = new Date(Date.now() + 3600000); // 1 hour from now

    // Save reset token to user
    user.resetPasswordToken = resetTokenHash;
    user.resetPasswordExpires = resetTokenExpires;
    await user.save();

    // Create reset link
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    
    // Send password reset email
    await this.emailService.sendPasswordResetEmail(email, {
      firstName: user.firstName,
      resetLink,
      expiryHours: 1,
      logoUrl: `${process.env.FRONTEND_URL}/images/logo.png`,
      companyName: process.env.COMPANY_NAME,
      companyAddress: process.env.COMPANY_ADDRESS,
      supportEmail: process.env.SUPPORT_EMAIL,
      socialLinks: {
        website: process.env.COMPANY_WEBSITE,
        linkedin: process.env.COMPANY_LINKEDIN,
        twitter: process.env.COMPANY_TWITTER
      }
    });

    return { 
      message: 'If an account exists with this email, a password reset link has been sent.',
      // Include token in response for development/testing only
      ...(process.env.NODE_ENV === 'development' && { resetToken })
    };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<{ message: string }> {
    const { token, newPassword } = resetPasswordDto;

    // Find all users with non-expired reset tokens
    const users = await this.userModel.find({
      resetPasswordExpires: { $gt: new Date() },
      isActive: true
    }).select('+resetPasswordToken +password');

    // Find user by matching token
    let matchedUser = null;
    for (const user of users) {
      if (user.resetPasswordToken && await bcrypt.compare(token, user.resetPasswordToken)) {
        matchedUser = user;
        break;
      }
    }

    if (!matchedUser) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Hash new password
    const hashedPassword = await this.hashPassword(newPassword);

    // Update user password and clear reset token
    matchedUser.password = hashedPassword;
    matchedUser.resetPasswordToken = undefined;
    matchedUser.resetPasswordExpires = undefined;
    await matchedUser.save();

    return { message: 'Password has been reset successfully' };
  }
}
