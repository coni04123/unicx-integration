import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Metrics, MetricsDocument, MetricType, MetricUnit } from '../schemas/metrics.schema';
import { Message, MessageDirection, MessageStatus } from '../schemas/message.schema';
import { WhatsAppSession, SessionStatus } from '../schemas/whatsapp-session.schema';
import { User } from '../schemas/user.schema';

export interface MetricsData {
  tenantId: string;
  tenantName: string;
  entityId?: string;
  entityName?: string;
  type: MetricType;
  unit: MetricUnit;
  value: number;
  metadata?: Record<string, any>;
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    @InjectModel(Metrics.name)
    private metricsModel: Model<MetricsDocument>,
    @InjectModel(Message.name)
    private messageModel: Model<Message>,
    @InjectModel(WhatsAppSession.name)
    private sessionModel: Model<WhatsAppSession>,
    @InjectModel(User.name)
    private userModel: Model<User>,
  ) {}

  /**
   * Record a metric
   */
  async recordMetric(data: MetricsData): Promise<MetricsDocument> {
    try {
      const metric = new this.metricsModel({
        type: data.type,
        unit: data.unit,
        value: data.value,
        tenantId: new Types.ObjectId(data.tenantId),
        tenantName: data.tenantName,
        entityId: data.entityId ? new Types.ObjectId(data.entityId) : undefined,
        entityName: data.entityName,
        metadata: data.metadata,
        timestamp: new Date(),
      });

      const savedMetric = await metric.save();
      this.logger.debug(`Metric recorded: ${data.type} = ${data.value} ${data.unit}`);
      
      return savedMetric;
    } catch (error) {
      this.logger.error(`Failed to record metric: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Collect message throughput metrics
   */
  async collectMessageThroughputMetrics(tenantId: string, tenantName: string): Promise<void> {
    try {
      const now = new Date();
      const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);

      // Count messages sent in the last minute
      const sentCount = await this.messageModel.countDocuments({
        tenantId: new Types.ObjectId(tenantId),
        direction: MessageDirection.OUTBOUND,
        createdAt: { $gte: oneMinuteAgo },
      });

      // Count messages received in the last minute
      const receivedCount = await this.messageModel.countDocuments({
        tenantId: new Types.ObjectId(tenantId),
        direction: MessageDirection.INBOUND,
        createdAt: { $gte: oneMinuteAgo },
      });

      await this.recordMetric({
        tenantId,
        tenantName,
        type: MetricType.MESSAGE_THROUGHPUT,
        unit: MetricUnit.PER_MINUTE,
        value: sentCount + receivedCount,
        metadata: {
          sent: sentCount,
          received: receivedCount,
          period: '1min',
        },
      });
    } catch (error) {
      this.logger.error(`Failed to collect message throughput metrics: ${error.message}`, error);
    }
  }

  /**
   * Collect error rate metrics
   */
  async collectErrorRateMetrics(tenantId: string, tenantName: string): Promise<void> {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // Count total messages in the last hour
      const totalMessages = await this.messageModel.countDocuments({
        tenantId: new Types.ObjectId(tenantId),
        createdAt: { $gte: oneHourAgo },
      });

      // Count failed messages in the last hour
      const failedMessages = await this.messageModel.countDocuments({
        tenantId: new Types.ObjectId(tenantId),
        status: MessageStatus.FAILED,
        createdAt: { $gte: oneHourAgo },
      });

      const errorRate = totalMessages > 0 ? (failedMessages / totalMessages) * 100 : 0;

      await this.recordMetric({
        tenantId,
        tenantName,
        type: MetricType.ERROR_RATE,
        unit: MetricUnit.PERCENTAGE,
        value: Math.round(errorRate * 100) / 100, // Round to 2 decimal places
        metadata: {
          totalMessages,
          failedMessages,
          period: '1hour',
        },
      });
    } catch (error) {
      this.logger.error(`Failed to collect error rate metrics: ${error.message}`, error);
    }
  }

  /**
   * Collect latency metrics (simplified - in production you'd use more sophisticated timing)
   */
  async collectLatencyMetrics(tenantId: string, tenantName: string): Promise<void> {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // Get message processing times (simplified calculation)
      const messages = await this.messageModel.find({
        tenantId: new Types.ObjectId(tenantId),
        createdAt: { $gte: oneHourAgo },
        sentAt: { $exists: true },
      }).select('createdAt sentAt deliveredAt');

      if (messages.length === 0) {
        await this.recordMetric({
          tenantId,
          tenantName,
          type: MetricType.LATENCY,
          unit: MetricUnit.MILLISECONDS,
          value: 0,
          metadata: { period: '1hour', messageCount: 0 },
        });
        return;
      }

      const latencies = messages
        .map(msg => {
          const sentTime = msg.sentAt || msg.createdAt;
          const deliveredTime = msg.deliveredAt || msg.createdAt;
          return deliveredTime.getTime() - sentTime.getTime();
        })
        .filter(latency => latency >= 0);

      if (latencies.length === 0) {
        await this.recordMetric({
          tenantId,
          tenantName,
          type: MetricType.LATENCY,
          unit: MetricUnit.MILLISECONDS,
          value: 0,
          metadata: { period: '1hour', messageCount: 0 },
        });
        return;
      }

      // Calculate P95 latency
      latencies.sort((a, b) => a - b);
      const p95Index = Math.ceil(latencies.length * 0.95) - 1;
      const p95Latency = latencies[p95Index];

      await this.recordMetric({
        tenantId,
        tenantName,
        type: MetricType.LATENCY,
        unit: MetricUnit.MILLISECONDS,
        value: p95Latency,
        metadata: {
          period: '1hour',
          messageCount: latencies.length,
          p95Latency,
          avgLatency: latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to collect latency metrics: ${error.message}`, error);
    }
  }

  /**
   * Collect queue backlog metrics (simplified - assumes pending messages are in queue)
   */
  async collectQueueBacklogMetrics(tenantId: string, tenantName: string): Promise<void> {
    try {
      // Count pending messages (simplified queue backlog)
      const pendingCount = await this.messageModel.countDocuments({
        tenantId: new Types.ObjectId(tenantId),
        status: MessageStatus.PENDING,
      });

      await this.recordMetric({
        tenantId,
        tenantName,
        type: MetricType.QUEUE_BACKLOG,
        unit: MetricUnit.COUNT,
        value: pendingCount,
        metadata: {
          timestamp: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(`Failed to collect queue backlog metrics: ${error.message}`, error);
    }
  }

  /**
   * Collect session health metrics
   */
  async collectSessionHealthMetrics(tenantId: string, tenantName: string): Promise<void> {
    try {
      const totalSessions = await this.sessionModel.countDocuments({
        tenantId: new Types.ObjectId(tenantId),
      });

      const activeSessions = await this.sessionModel.countDocuments({
        tenantId: new Types.ObjectId(tenantId),
        status: SessionStatus.READY,
      });

      const healthScore = totalSessions > 0 ? (activeSessions / totalSessions) * 100 : 0;

      await this.recordMetric({
        tenantId,
        tenantName,
        type: MetricType.SESSION_HEALTH,
        unit: MetricUnit.HEALTH_SCORE,
        value: Math.round(healthScore * 100) / 100,
        metadata: {
          totalSessions,
          activeSessions,
          inactiveSessions: totalSessions - activeSessions,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to collect session health metrics: ${error.message}`, error);
    }
  }

  /**
   * Collect all metrics for a tenant
   */
  async collectAllMetrics(tenantId: string, tenantName: string): Promise<void> {
    try {
      await Promise.all([
        this.collectMessageThroughputMetrics(tenantId, tenantName),
        this.collectErrorRateMetrics(tenantId, tenantName),
        this.collectLatencyMetrics(tenantId, tenantName),
        this.collectQueueBacklogMetrics(tenantId, tenantName),
        this.collectSessionHealthMetrics(tenantId, tenantName),
      ]);
      
      this.logger.log(`Collected all metrics for tenant: ${tenantName}`);
    } catch (error) {
      this.logger.error(`Failed to collect all metrics: ${error.message}`, error);
    }
  }

  /**
   * Get metrics dashboard data
   */
  async getDashboardMetrics(tenantId: string, hours: number = 24): Promise<any> {
    try {
      const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
      
      const metrics = await this.metricsModel.find({
        tenantId: new Types.ObjectId(tenantId),
        timestamp: { $gte: startTime },
        isActive: true,
      }).sort({ timestamp: -1 });

      // Group metrics by type
      const groupedMetrics = metrics.reduce((acc, metric) => {
        if (!acc[metric.type]) {
          acc[metric.type] = [];
        }
        acc[metric.type].push(metric);
        return acc;
      }, {});

      // Calculate current values and trends
      const dashboardData = {
        messageThroughput: this.calculateCurrentValue(groupedMetrics[MetricType.MESSAGE_THROUGHPUT]),
        errorRate: this.calculateCurrentValue(groupedMetrics[MetricType.ERROR_RATE]),
        latency: this.calculateCurrentValue(groupedMetrics[MetricType.LATENCY]),
        queueBacklog: this.calculateCurrentValue(groupedMetrics[MetricType.QUEUE_BACKLOG]),
        sessionHealth: this.calculateCurrentValue(groupedMetrics[MetricType.SESSION_HEALTH]),
        trends: {
          messageThroughput: this.calculateTrend(groupedMetrics[MetricType.MESSAGE_THROUGHPUT]),
          errorRate: this.calculateTrend(groupedMetrics[MetricType.ERROR_RATE]),
          latency: this.calculateTrend(groupedMetrics[MetricType.LATENCY]),
          queueBacklog: this.calculateTrend(groupedMetrics[MetricType.QUEUE_BACKLOG]),
          sessionHealth: this.calculateTrend(groupedMetrics[MetricType.SESSION_HEALTH]),
        },
        lastUpdated: new Date(),
      };

      return dashboardData;
    } catch (error) {
      this.logger.error(`Failed to get dashboard metrics: ${error.message}`, error);
      throw error;
    }
  }

  private calculateCurrentValue(metrics: MetricsDocument[]): number {
    if (!metrics || metrics.length === 0) return 0;
    
    // Return the most recent value
    return metrics[0].value;
  }

  private calculateTrend(metrics: MetricsDocument[]): { direction: 'up' | 'down' | 'stable'; percentage: number } {
    if (!metrics || metrics.length < 2) {
      return { direction: 'stable', percentage: 0 };
    }

    const recent = metrics[0].value;
    const previous = metrics[1].value;

    if (previous === 0) {
      return { direction: 'stable', percentage: 0 };
    }

    const percentage = ((recent - previous) / previous) * 100;
    const direction = Math.abs(percentage) < 5 ? 'stable' : (percentage > 0 ? 'up' : 'down');

    return {
      direction,
      percentage: Math.round(Math.abs(percentage) * 100) / 100,
    };
  }

  /**
   * Clean up old metrics (for maintenance)
   */
  async cleanupOldMetrics(daysToKeep: number = 30): Promise<number> {
    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
    
    const result = await this.metricsModel.deleteMany({
      timestamp: { $lt: cutoffDate },
    });

    this.logger.log(`Cleaned up ${result.deletedCount} old metrics`);
    return result.deletedCount;
  }
}
