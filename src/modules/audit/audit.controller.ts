import {
  Controller,
  Get,
  Query,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators';
import { UserRole } from '../../common/schemas/user.schema';
import { AuditLogService } from './audit.service';
import { HttpMethod, AuditLogStatus } from '../../common/schemas/audit-log.schema';

@ApiTags('Audit Logs')
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get('logs')
  @ApiOperation({ summary: 'Get audit logs with filters' })
  @ApiResponse({ status: 200, description: 'Audit logs retrieved successfully' })
  @ApiQuery({ name: 'userId', required: false, description: 'Filter by user ID' })
  @ApiQuery({ name: 'tenantId', required: false, description: 'Filter by tenant ID' })
  @ApiQuery({ name: 'method', required: false, enum: HttpMethod, description: 'Filter by HTTP method' })
  @ApiQuery({ name: 'path', required: false, description: 'Filter by path (regex supported)' })
  @ApiQuery({ name: 'statusCode', required: false, type: Number, description: 'Filter by status code' })
  @ApiQuery({ name: 'status', required: false, enum: AuditLogStatus, description: 'Filter by status' })
  @ApiQuery({ name: 'ipAddress', required: false, description: 'Filter by IP address' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date (ISO string)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date (ISO string)' })
  @ApiQuery({ name: 'search', required: false, description: 'Search across multiple fields' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20)' })
  async getLogs(
    @Query('userId') userId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('method') method?: HttpMethod,
    @Query('path') path?: string,
    @Query('statusCode') statusCodeStr?: string,
    @Query('status') status?: AuditLogStatus,
    @Query('ipAddress') ipAddress?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
    @Request() req?: any,
  ) {
    // Parse numeric values, handling empty strings
    const statusCode = statusCodeStr && statusCodeStr.trim() !== '' ? parseInt(statusCodeStr, 10) : undefined;
    const page = pageStr && pageStr.trim() !== '' ? parseInt(pageStr, 10) : undefined;
    const limit = limitStr && limitStr.trim() !== '' ? parseInt(limitStr, 10) : undefined;

    // Validate parsed values
    if (statusCodeStr && statusCodeStr.trim() !== '' && (isNaN(statusCode!) || statusCode! < 0)) {
      throw new BadRequestException('Invalid statusCode: must be a positive number');
    }
    if (pageStr && pageStr.trim() !== '' && (isNaN(page!) || page! < 1)) {
      throw new BadRequestException('Invalid page: must be a positive number >= 1');
    }
    if (limitStr && limitStr.trim() !== '' && (isNaN(limit!) || limit! < 1)) {
      throw new BadRequestException('Invalid limit: must be a positive number >= 1');
    }

    const filters: any = {
      userId: userId && userId.trim() !== '' ? userId : undefined,
      tenantId: tenantId && tenantId.trim() !== '' ? tenantId : undefined,
      method: method && method.trim() !== '' ? method : undefined,
      path: path && path.trim() !== '' ? path : undefined,
      statusCode,
      status: status && status.trim() !== '' ? status : undefined,
      ipAddress: ipAddress && ipAddress.trim() !== '' ? ipAddress : undefined,
      search: search && search.trim() !== '' ? search : undefined,
      page: page || 1, // Default to page 1 if not provided
      limit: limit || 20, // Default to 20 if not provided
    };

    if (startDate && startDate.trim() !== '') {
      filters.startDate = new Date(startDate);
    }

    if (endDate && endDate.trim() !== '') {
      filters.endDate = new Date(endDate);
    }

    // Remove undefined values from filters
    Object.keys(filters).forEach(key => {
      if (filters[key] === undefined) {
        delete filters[key];
      }
    });

    const requestingTenantId = req?.user?.tenantId;
    return this.auditLogService.findAll(filters, requestingTenantId);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get audit log statistics' })
  @ApiResponse({ status: 200, description: 'Statistics retrieved successfully' })
  @ApiQuery({ name: 'days', required: false, type: Number, description: 'Number of days to analyze (default: 30)' })
  async getStats(
    @Query('days') daysStr?: string,
    @Request() req?: any,
  ) {
    const days = daysStr && daysStr.trim() !== '' ? parseInt(daysStr, 10) : 30;
    
    if (isNaN(days) || days < 1) {
      throw new BadRequestException('Invalid days: must be a positive number >= 1');
    }
    
    const tenantId = req?.user?.tenantId;
    return this.auditLogService.getStats(tenantId, days);
  }
}

