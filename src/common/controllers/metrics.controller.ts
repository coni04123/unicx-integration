import { Controller, Get, Query, UseGuards, Logger, Req } from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { MetricsService } from '../services/metrics.service';
import { JwtAuthGuard } from '../../modules/auth/jwt-auth.guard';
import { RolesGuard } from '../../modules/auth/roles.guard';
import { Roles } from '../../modules/auth/decorators';
import { UserRole } from '../schemas/user.schema';

@ApiTags('Metrics')
@Controller('metrics')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(private readonly metricsService: MetricsService) {}

  @Get('dashboard')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN, UserRole.USER)
  @ApiOperation({ summary: 'Get metrics dashboard data' })
  @ApiQuery({ name: 'hours', required: false, description: 'Number of hours to include in metrics (default: 24)' })
  @ApiResponse({ status: 200, description: 'Dashboard metrics retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getDashboardMetrics(
    @Req() req: Request,
    @Query('hours') hours?: number,
  ) {
    try {
      const tenantId = req.user['tenantId'];
      const tenantName = req.user['tenantName'] || 'Unknown Tenant';
      
      // Collect fresh metrics
      await this.metricsService.collectAllMetrics(tenantId, tenantName);
      
      // Get dashboard data
      const dashboardData = await this.metricsService.getDashboardMetrics(
        tenantId,
        hours ? parseInt(hours.toString()) : 24,
      );
      
      return {
        success: true,
        data: {
          ...dashboardData,
          tenant: {
            id: tenantId,
            name: tenantName,
          },
        },
      };
    } catch (error) {
      this.logger.error('Failed to get dashboard metrics:', error);
      throw error;
    }
  }

  @Get('throughput')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN, UserRole.USER)
  @ApiOperation({ summary: 'Get message throughput metrics' })
  @ApiQuery({ name: 'hours', required: false, description: 'Number of hours to include' })
  @ApiResponse({ status: 200, description: 'Throughput metrics retrieved successfully' })
  async getThroughputMetrics(
    @Req() req: Request,
    @Query('hours') hours?: number,
  ) {
    try {
      const tenantId = req.user['tenantId'];
      const tenantName = req.user['tenantName'] || 'Unknown Tenant';
      
      await this.metricsService.collectMessageThroughputMetrics(tenantId, tenantName);
      const dashboardData = await this.metricsService.getDashboardMetrics(tenantId, hours ? parseInt(hours.toString()) : 24);
      
      return {
        success: true,
        data: {
          current: dashboardData.messageThroughput,
          trend: dashboardData.trends.messageThroughput,
          unit: 'messages/minute',
        },
      };
    } catch (error) {
      this.logger.error('Failed to get throughput metrics:', error);
      throw error;
    }
  }

  @Get('error-rate')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN, UserRole.USER)
  @ApiOperation({ summary: 'Get error rate metrics' })
  @ApiQuery({ name: 'hours', required: false, description: 'Number of hours to include' })
  @ApiResponse({ status: 200, description: 'Error rate metrics retrieved successfully' })
  async getErrorRateMetrics(
    @Req() req: Request,
    @Query('hours') hours?: number,
  ) {
    try {
      const tenantId = req.user['tenantId'];
      const tenantName = req.user['tenantName'] || 'Unknown Tenant';
      
      await this.metricsService.collectErrorRateMetrics(tenantId, tenantName);
      const dashboardData = await this.metricsService.getDashboardMetrics(tenantId, hours ? parseInt(hours.toString()) : 24);
      
      return {
        success: true,
        data: {
          current: dashboardData.errorRate,
          trend: dashboardData.trends.errorRate,
          unit: 'percentage',
        },
      };
    } catch (error) {
      this.logger.error('Failed to get error rate metrics:', error);
      throw error;
    }
  }

  @Get('latency')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN, UserRole.USER)
  @ApiOperation({ summary: 'Get latency metrics (P95)' })
  @ApiQuery({ name: 'hours', required: false, description: 'Number of hours to include' })
  @ApiResponse({ status: 200, description: 'Latency metrics retrieved successfully' })
  async getLatencyMetrics(
    @Req() req: Request,
    @Query('hours') hours?: number,
  ) {
    try {
      const tenantId = req.user['tenantId'];
      const tenantName = req.user['tenantName'] || 'Unknown Tenant';
      
      await this.metricsService.collectLatencyMetrics(tenantId, tenantName);
      const dashboardData = await this.metricsService.getDashboardMetrics(tenantId, hours ? parseInt(hours.toString()) : 24);
      
      return {
        success: true,
        data: {
          current: dashboardData.latency,
          trend: dashboardData.trends.latency,
          unit: 'milliseconds',
        },
      };
    } catch (error) {
      this.logger.error('Failed to get latency metrics:', error);
      throw error;
    }
  }

  @Get('queue-backlog')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN, UserRole.USER)
  @ApiOperation({ summary: 'Get queue backlog metrics' })
  @ApiResponse({ status: 200, description: 'Queue backlog metrics retrieved successfully' })
  async getQueueBacklogMetrics(@Req() req: Request) {
    try {
      const tenantId = req.user['tenantId'];
      const tenantName = req.user['tenantName'] || 'Unknown Tenant';
      
      await this.metricsService.collectQueueBacklogMetrics(tenantId, tenantName);
      const dashboardData = await this.metricsService.getDashboardMetrics(tenantId, 24);
      
      return {
        success: true,
        data: {
          current: dashboardData.queueBacklog,
          trend: dashboardData.trends.queueBacklog,
          unit: 'count',
        },
      };
    } catch (error) {
      this.logger.error('Failed to get queue backlog metrics:', error);
      throw error;
    }
  }

  @Get('session-health')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN, UserRole.USER)
  @ApiOperation({ summary: 'Get session health metrics' })
  @ApiResponse({ status: 200, description: 'Session health metrics retrieved successfully' })
  async getSessionHealthMetrics(@Req() req: Request) {
    try {
      const tenantId = req.user['tenantId'];
      const tenantName = req.user['tenantName'] || 'Unknown Tenant';
      
      await this.metricsService.collectSessionHealthMetrics(tenantId, tenantName);
      const dashboardData = await this.metricsService.getDashboardMetrics(tenantId, 24);
      
      return {
        success: true,
        data: {
          current: dashboardData.sessionHealth,
          trend: dashboardData.trends.sessionHealth,
          unit: 'health_score',
        },
      };
    } catch (error) {
      this.logger.error('Failed to get session health metrics:', error);
      throw error;
    }
  }
}
