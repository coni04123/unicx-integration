import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditLog, AuditLogDocument, AuditAction, AuditResource, AuditResult } from '../schemas/audit-log.schema';

export interface AuditLogData {
  action: AuditAction;
  resource: AuditResource;
  resourceId: string;
  resourceName: string;
  userId: string;
  userEmail: string;
  userName: string;
  tenantId: string;
  tenantName: string;
  result: AuditResult;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  metadata?: Record<string, any>;
  ipAddress: string;
  userAgent: string;
  errorMessage?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditLog.name)
    private auditLogModel: Model<AuditLogDocument>,
  ) {}

  /**
   * Log an audit event
   */
  async logAuditEvent(data: AuditLogData): Promise<AuditLogDocument> {
    try {
      const auditLog = new this.auditLogModel({
        action: data.action,
        resource: data.resource,
        resourceId: data.resourceId,
        resourceName: data.resourceName,
        userId: new Types.ObjectId(data.userId),
        userEmail: data.userEmail,
        userName: data.userName,
        tenantId: new Types.ObjectId(data.tenantId),
        tenantName: data.tenantName,
        result: data.result,
        oldValues: data.oldValues,
        newValues: data.newValues,
        metadata: data.metadata,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        errorMessage: data.errorMessage,
      });

      const savedLog = await auditLog.save();
      this.logger.log(`Audit log created: ${data.action} ${data.resource} by ${data.userEmail}`);
      
      return savedLog;
    } catch (error) {
      this.logger.error(`Failed to create audit log: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Log a successful action
   */
  async logSuccess(
    action: AuditAction,
    resource: AuditResource,
    resourceId: string,
    resourceName: string,
    userId: string,
    userEmail: string,
    userName: string,
    tenantId: string,
    tenantName: string,
    ipAddress: string,
    userAgent: string,
    oldValues?: Record<string, any>,
    newValues?: Record<string, any>,
    metadata?: Record<string, any>,
  ): Promise<AuditLogDocument> {
    return this.logAuditEvent({
      action,
      resource,
      resourceId,
      resourceName,
      userId,
      userEmail,
      userName,
      tenantId,
      tenantName,
      result: AuditResult.SUCCESS,
      oldValues,
      newValues,
      metadata,
      ipAddress,
      userAgent,
    });
  }

  /**
   * Log a failed action
   */
  async logFailure(
    action: AuditAction,
    resource: AuditResource,
    resourceId: string,
    resourceName: string,
    userId: string,
    userEmail: string,
    userName: string,
    tenantId: string,
    tenantName: string,
    ipAddress: string,
    userAgent: string,
    errorMessage: string,
    metadata?: Record<string, any>,
  ): Promise<AuditLogDocument> {
    return this.logAuditEvent({
      action,
      resource,
      resourceId,
      resourceName,
      userId,
      userEmail,
      userName,
      tenantId,
      tenantName,
      result: AuditResult.FAILURE,
      metadata,
      ipAddress,
      userAgent,
      errorMessage,
    });
  }

  /**
   * Get audit logs with filters
   */
  async getAuditLogs(filters: {
    tenantId?: string;
    userId?: string;
    action?: AuditAction;
    resource?: AuditResource;
    resourceId?: string;
    result?: AuditResult;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: AuditLogDocument[]; total: number; limit: number; offset: number }> {
    const query: any = { isActive: true };

    if (filters.tenantId) {
      query.tenantId = new Types.ObjectId(filters.tenantId);
    }
    if (filters.userId) {
      query.userId = new Types.ObjectId(filters.userId);
    }
    if (filters.action) {
      query.action = filters.action;
    }
    if (filters.resource) {
      query.resource = filters.resource;
    }
    if (filters.resourceId) {
      query.resourceId = filters.resourceId;
    }
    if (filters.result) {
      query.result = filters.result;
    }
    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) query.createdAt.$gte = filters.startDate;
      if (filters.endDate) query.createdAt.$lte = filters.endDate;
    }

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    const total = await this.auditLogModel.countDocuments(query);
    const logs = await this.auditLogModel
      .find(query)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .populate('userId', 'firstName lastName email')
      .populate('tenantId', 'name');

    return {
      logs,
      total,
      limit,
      offset,
    };
  }

  /**
   * Get audit statistics
   */
  async getAuditStats(tenantId?: string, days: number = 30): Promise<any> {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const query: any = {
      isActive: true,
      createdAt: { $gte: startDate },
    };

    if (tenantId) {
      query.tenantId = new Types.ObjectId(tenantId);
    }

    const stats = await this.auditLogModel.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalActions: { $sum: 1 },
          successfulActions: {
            $sum: { $cond: [{ $eq: ['$result', AuditResult.SUCCESS] }, 1, 0] },
          },
          failedActions: {
            $sum: { $cond: [{ $eq: ['$result', AuditResult.FAILURE] }, 1, 0] },
          },
          actionsByType: {
            $push: {
              action: '$action',
              resource: '$resource',
              result: '$result',
            },
          },
        },
      },
    ]);

    if (stats.length === 0) {
      return {
        totalActions: 0,
        successfulActions: 0,
        failedActions: 0,
        successRate: 0,
        actionsByType: {},
        resourcesByType: {},
      };
    }

    const result = stats[0];
    const successRate = result.totalActions > 0 ? (result.successfulActions / result.totalActions) * 100 : 0;

    // Group actions by type
    const actionsByType = {};
    const resourcesByType = {};

    result.actionsByType.forEach((item) => {
      if (!actionsByType[item.action]) {
        actionsByType[item.action] = { total: 0, success: 0, failure: 0 };
      }
      actionsByType[item.action].total++;
      if (item.result === AuditResult.SUCCESS) {
        actionsByType[item.action].success++;
      } else {
        actionsByType[item.action].failure++;
      }

      if (!resourcesByType[item.resource]) {
        resourcesByType[item.resource] = { total: 0, success: 0, failure: 0 };
      }
      resourcesByType[item.resource].total++;
      if (item.result === AuditResult.SUCCESS) {
        resourcesByType[item.resource].success++;
      } else {
        resourcesByType[item.resource].failure++;
      }
    });

    return {
      totalActions: result.totalActions,
      successfulActions: result.successfulActions,
      failedActions: result.failedActions,
      successRate: Math.round(successRate * 100) / 100,
      actionsByType,
      resourcesByType,
    };
  }

  /**
   * Clean up old audit logs (for maintenance)
   */
  async cleanupOldLogs(daysToKeep: number = 365): Promise<number> {
    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
    
    const result = await this.auditLogModel.deleteMany({
      createdAt: { $lt: cutoffDate },
    });

    this.logger.log(`Cleaned up ${result.deletedCount} old audit logs`);
    return result.deletedCount;
  }
}
