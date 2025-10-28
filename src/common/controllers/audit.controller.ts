import { Controller, Get, Query, UseGuards, Logger, Req } from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { AuditService } from '../services/audit.service';
import { JwtAuthGuard } from '../../modules/auth/jwt-auth.guard';
import { RolesGuard } from '../../modules/auth/roles.guard';
import { Roles } from '../../modules/auth/decorators';
import { UserRole } from '../schemas/user.schema';
import { AuditAction, AuditResource, AuditResult } from '../schemas/audit-log.schema';

@ApiTags('Audit')
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AuditController {
  private readonly logger = new Logger(AuditController.name);

  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Get audit logs with filters' })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Filter by tenant ID' })
  @ApiQuery({ name: 'userId', required: false, description: 'Filter by user ID' })
  @ApiQuery({ name: 'action', required: false, enum: AuditAction, description: 'Filter by action' })
  @ApiQuery({ name: 'resource', required: false, enum: AuditResource, description: 'Filter by resource' })
  @ApiQuery({ name: 'resourceId', required: false, description: 'Filter by resource ID' })
  @ApiQuery({ name: 'result', required: false, enum: AuditResult, description: 'Filter by result' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date filter (ISO string)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date filter (ISO string)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Number of results per page' })
  @ApiQuery({ name: 'offset', required: false, description: 'Number of results to skip' })
  @ApiResponse({ status: 200, description: 'Audit logs retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getAuditLogs(
    @Query() query: any,
    @Req() req: Request,
  ) {
    try {
      const filters = {
        ...query,
        tenantId: query.tenantId || req.user['tenantId'], // Default to user's tenant
        limit: query.limit ? parseInt(query.limit) : undefined,
        offset: query.offset ? parseInt(query.offset) : undefined,
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
      };

      const result = await this.auditService.getAuditLogs(filters);
      
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      this.logger.error('Failed to get audit logs:', error);
      throw error;
    }
  }

  @Get('stats')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Get audit statistics' })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Filter by tenant ID' })
  @ApiQuery({ name: 'days', required: false, description: 'Number of days to include in stats' })
  @ApiResponse({ status: 200, description: 'Audit statistics retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getAuditStats(
    @Req() req: Request,
    @Query('tenantId') tenantId?: string,
    @Query('days') days?: number,
  ) {
    try {
      const stats = await this.auditService.getAuditStats(
        tenantId || req.user['tenantId'],
        days ? parseInt(days.toString()) : 30,
      );
      
      return {
        success: true,
        data: stats,
      };
    } catch (error) {
      this.logger.error('Failed to get audit stats:', error);
      throw error;
    }
  }
}
