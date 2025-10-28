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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { WhatsAppHealthCheckService } from '../whatsapp/whatsapp-health-check.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InviteUserDto } from './dto/create-user.dto';
import { BulkInviteUserDto } from './dto/create-user.dto';
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
    private readonly healthCheckService: WhatsAppHealthCheckService,
  ) {}

  @Post()
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN)
  @RequireTenant()
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async create(@Body() createUserDto: CreateUserDto, @Request() req) {
    return this.usersService.create(createUserDto, req.user.sub);
  }

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

  @Get(':id')
  @RequireTenant()
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiResponse({ status: 200, description: 'User retrieved successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(@Param('id') id: string, @Request() req) {
    return this.usersService.findOne(id, req.user.tenantId);
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

  @Get(':id/health-status')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN, UserRole.USER)
  @ApiOperation({ summary: 'Get WhatsApp health check status for user' })
  @ApiResponse({ status: 200, description: 'Health check status retrieved successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUserHealthStatus(@Param('id') id: string) {
    const stats = await this.healthCheckService.getUserHealthStats(id);
    return {
      success: true,
      data: stats,
    };
  }

  @Post(':id/trigger-health-check')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Manually trigger health check for user\'s WhatsApp session' })
  @ApiResponse({ status: 200, description: 'Health check triggered successfully' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async triggerHealthCheck(@Param('id') id: string, @Request() req) {
    try {
      const healthCheck = await this.healthCheckService.triggerManualHealthCheckByUserId(id);
      
      return {
        success: true,
        data: healthCheck,
        message: 'Health check completed',
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Failed to trigger health check',
      };
    }
  }
}
