import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditLog, AuditLogDocument } from '../../common/schemas/audit-log.schema';
import { HttpMethod, AuditLogStatus } from '../../common/schemas/audit-log.schema';

export interface AuditLogFilters {
  userId?: string;
  tenantId?: string;
  method?: HttpMethod;
  path?: string;
  statusCode?: number;
  status?: AuditLogStatus;
  ipAddress?: string;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectModel(AuditLog.name)
    private auditLogModel: Model<AuditLogDocument>,
  ) {}

  async findAll(filters: AuditLogFilters, requestingTenantId?: string): Promise<{
    logs: AuditLog[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const query: any = {};

    // Apply filters
    if (filters.userId) {
      query.userId = new Types.ObjectId(filters.userId);
    }

    if (filters.tenantId) {
      query.tenantId = new Types.ObjectId(filters.tenantId);
    } else if (requestingTenantId) {
      // If no tenant filter specified, filter by requesting user's tenant
      query.tenantId = new Types.ObjectId(requestingTenantId);
    }

    if (filters.method) {
      query.method = filters.method;
    }

    if (filters.path) {
      query.path = { $regex: filters.path, $options: 'i' };
    }

    if (filters.statusCode) {
      query.statusCode = filters.statusCode;
    }

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.ipAddress) {
      query.ipAddress = { $regex: filters.ipAddress, $options: 'i' };
    }

    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) {
        query.createdAt.$gte = filters.startDate;
      }
      if (filters.endDate) {
        query.createdAt.$lte = filters.endDate;
      }
    }

    // Search across multiple fields
    if (filters.search) {
      query.$or = [
        { url: { $regex: filters.search, $options: 'i' } },
        { path: { $regex: filters.search, $options: 'i' } },
        { userEmail: { $regex: filters.search, $options: 'i' } },
        { ipAddress: { $regex: filters.search, $options: 'i' } },
        { errorMessage: { $regex: filters.search, $options: 'i' } },
      ];
    }

    // Pagination
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    // Get total count
    const total = await this.auditLogModel.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

    // Get paginated logs
    const logs = await this.auditLogModel
      .find(query)
      .populate('userId', 'firstName lastName email')
      .populate('tenantId', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return {
      logs: logs as AuditLog[],
      total,
      page,
      limit,
      totalPages,
    };
  }

  async getStats(tenantId?: string, days: number = 30): Promise<any> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const query: any = {
      createdAt: { $gte: startDate },
    };

    if (tenantId) {
      query.tenantId = new Types.ObjectId(tenantId);
    }

    const [
      totalRequests,
      successRequests,
      errorRequests,
      failedRequests,
      methodStats,
      statusCodeStats,
      topPaths,
      topUsers,
    ] = await Promise.all([
      this.auditLogModel.countDocuments(query),
      this.auditLogModel.countDocuments({ ...query, status: AuditLogStatus.SUCCESS }),
      this.auditLogModel.countDocuments({ ...query, status: AuditLogStatus.ERROR }),
      this.auditLogModel.countDocuments({ ...query, status: AuditLogStatus.FAILED }),
      this.auditLogModel.aggregate([
        { $match: query },
        { $group: { _id: '$method', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      this.auditLogModel.aggregate([
        { $match: query },
        { $group: { _id: '$statusCode', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      this.auditLogModel.aggregate([
        { $match: query },
        { $group: { _id: '$path', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      this.auditLogModel.aggregate([
        { $match: { ...query, userId: { $ne: null } } },
        { $group: { _id: '$userId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      ]),
    ]);

    return {
      totalRequests,
      successRequests,
      errorRequests,
      failedRequests,
      successRate: totalRequests > 0 ? ((successRequests / totalRequests) * 100).toFixed(2) : 0,
      methodStats: methodStats.map((stat: any) => ({
        method: stat._id,
        count: stat.count,
      })),
      statusCodeStats: statusCodeStats.map((stat: any) => ({
        statusCode: stat._id,
        count: stat.count,
      })),
      topPaths: topPaths.map((stat: any) => ({
        path: stat._id,
        count: stat.count,
      })),
      topUsers: topUsers.map((stat: any) => ({
        userId: stat._id,
        count: stat.count,
        user: stat.user ? {
          firstName: stat.user.firstName,
          lastName: stat.user.lastName,
          email: stat.user.email,
        } : null,
      })),
    };
  }

  async deleteOldLogs(daysToKeep: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await this.auditLogModel.deleteMany({
      createdAt: { $lt: cutoffDate },
    });

    this.logger.log(`Deleted ${result.deletedCount} audit logs older than ${daysToKeep} days`);
    return result.deletedCount;
  }
}

