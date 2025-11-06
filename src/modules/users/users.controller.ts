import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InviteUserDto } from './dto/create-user.dto';
import { BulkInviteUserDto } from './dto/create-user.dto';
import { BulkUploadUsersDto } from './dto/create-user.dto';
import { BulkUploadManagersDto } from './dto/create-user.dto';
import { UpdateRegistrationStatusDto } from './dto/create-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequireTenant } from '../auth/decorators';
import { UserRole, RegistrationStatus, WhatsAppConnectionStatus } from '../../common/schemas/user.schema';

@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
  ) {}

  @Post('invite')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN)
  @RequireTenant()
  @ApiOperation({ summary: 'Invite a new user' })
  @ApiResponse({ status: 201, description: 'User invited successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async invite(@Body() inviteUserDto: InviteUserDto, @Request() req) {
    return this.usersService.inviteUser(inviteUserDto, req.user.sub);
  }

  @Post('bulk-invite')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN)
  @RequireTenant()
  @ApiOperation({ summary: 'Bulk invite users' })
  @ApiResponse({ status: 201, description: 'Users invited successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async bulkInvite(@Body() bulkInviteDto: BulkInviteUserDto, @Request() req) {
    return this.usersService.bulkInviteUsers(bulkInviteDto, req.user.sub);
  }

  @Post('bulk-upload')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN)
  @RequireTenant()
  @ApiOperation({ summary: 'Bulk upload users with entity path resolution' })
  @ApiResponse({ status: 201, description: 'Users uploaded successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async bulkUpload(@Body() bulkUploadDto: BulkUploadUsersDto, @Request() req) {
    return this.usersService.bulkUploadUsers(bulkUploadDto, req.user.sub);
  }

  @Post('bulk-upload-managers')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN)
  @RequireTenant()
  @ApiOperation({ summary: 'Bulk upload managers with entity path resolution' })
  @ApiResponse({ status: 201, description: 'Managers uploaded successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async bulkUploadManagers(@Body() bulkUploadDto: BulkUploadManagersDto, @Request() req) {
    return this.usersService.bulkUploadManagers(bulkUploadDto, req.user.sub);
  }

  @Get()
  @RequireTenant()
  @ApiOperation({ summary: 'Get all users with pagination' })
  @ApiQuery({ name: 'registrationStatus', required: false, enum: RegistrationStatus })
  @ApiQuery({ name: 'role', required: false, enum: UserRole })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'whatsappConnectionStatus', required: false, enum: WhatsAppConnectionStatus })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page (default: 10)' })
  @ApiResponse({ status: 200, description: 'Users retrieved successfully with pagination' })
  async findAll(@Query() query: any, @Request() req) {
    return this.usersService.findAll(req.user.tenantId, query);
  }

  @Get('stats')
  @RequireTenant()
  @ApiOperation({ summary: 'Get user statistics' })
  @ApiResponse({ status: 200, description: 'User statistics retrieved successfully' })
  async getStats(@Request() req) {
    return this.usersService.getUserStats(req.user.tenantId);
  }

  @Get('search')
  @RequireTenant()
  @ApiOperation({ summary: 'Search users' })
  @ApiQuery({ name: 'q', required: true })
  @ApiResponse({ status: 200, description: 'Users found successfully' })
  async search(@Query('q') query: string, @Request() req) {
    return this.usersService.searchUsers(query, req.user.tenantId);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile retrieved successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getProfile(@Request() req) {
    if (!req.user || !req.user.sub) {
      throw new BadRequestException('User ID not found in token');
    }
    
    // Ensure we have a valid user ID
    const userId = String(req.user.sub).trim();
    const tenantId = req.user.tenantId ? String(req.user.tenantId).trim() : '';
    
    return this.usersService.findOne(userId, tenantId);
  }

  @Get(':id')
  @RequireTenant()
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiResponse({ status: 200, description: 'User retrieved successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(@Param('id') id: string, @Request() req) {
    return this.usersService.findOne(id, req.user.tenantId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({ status: 200, description: 'Profile updated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateProfile(
    @Body() updateUserDto: UpdateUserDto,
    @Request() req,
  ) {
    return this.usersService.update(req.user.sub, updateUserDto, req.user.sub, req.user.tenantId || '');
  }

  @Post('verify-email')
  @ApiOperation({ summary: 'Verify email address with token' })
  @ApiResponse({ status: 200, description: 'Email verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async verifyEmail(
    @Body('token') token: string,
    @Body('userId') userId: string,
  ) {
    return this.usersService.verifyEmail(token, userId);
  }

  @Post('resend-email-verification')
  @ApiOperation({ summary: 'Resend email verification email' })
  @ApiResponse({ status: 200, description: 'Verification email sent successfully' })
  @ApiResponse({ status: 400, description: 'No pending email verification' })
  async resendEmailVerification(@Request() req) {
    await this.usersService.resendEmailVerification(req.user.sub);
    return { message: 'Verification email sent successfully' };
  }

  @Patch(':id')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN)
  @RequireTenant()
  @ApiOperation({ summary: 'Update user' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Request() req,
  ) {
    return this.usersService.update(id, updateUserDto, req.user.sub, req.user.tenantId);
  }

  @Patch(':id/registration-status')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN)
  @RequireTenant()
  @ApiOperation({ summary: 'Update user registration status' })
  @ApiResponse({ status: 200, description: 'Registration status updated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateRegistrationStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateRegistrationStatusDto,
    @Request() req,
  ) {
    return this.usersService.updateRegistrationStatus(
      id,
      updateStatusDto.status,
      req.user.sub,
      req.user.tenantId,
    );
  }

  @Patch(':id/whatsapp-status')
  @RequireTenant()
  @ApiOperation({ summary: 'Update WhatsApp connection status' })
  @ApiResponse({ status: 200, description: 'WhatsApp status updated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateWhatsAppStatus(
    @Param('id') id: string,
    @Body('status') status: WhatsAppConnectionStatus,
    @Request() req,
  ) {
    return this.usersService.updateWhatsAppConnectionStatus(id, status, req.user.tenantId);
  }

  @Delete(':id')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN)
  @RequireTenant()
  @ApiOperation({ summary: 'Delete user' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async remove(@Param('id') id: string, @Request() req) {
    await this.usersService.remove(id, req.user.sub, req.user.tenantId);
    return { message: 'User deleted successfully' };
  }

  @Post(':id/regenerate-qr')
  @RequireTenant()
  @ApiOperation({ summary: 'Regenerate WhatsApp QR code for user' })
  @ApiResponse({ status: 200, description: 'QR code regenerated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - User has no phone number or QR generation failed' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async regenerateQRCode(@Param('id') id: string, @Request() req) {
    return this.usersService.regenerateQRCode(id, req.user.tenantId);
  }
}
