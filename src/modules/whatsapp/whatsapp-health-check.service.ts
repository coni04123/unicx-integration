import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WhatsAppHealthCheck, HealthCheckStatus, HealthCheckType } from '../../common/schemas/whatsapp-health-check.schema';
import { Alert, AlertType, AlertSeverity, AlertStatus } from '../../common/schemas/alert.schema';
import { WhatsAppSession, SessionStatus } from '../../common/schemas/whatsapp-session.schema';
import { User } from '../../common/schemas/user.schema';

@Injectable()
export class WhatsAppHealthCheckService {
  private readonly logger = new Logger(WhatsAppHealthCheckService.name);
  private readonly CONSECUTIVE_FAILURE_THRESHOLD = 3;
  private readonly CHECK_INTERVAL_MINUTES = 5;

  constructor(
    @InjectModel(WhatsAppHealthCheck.name)
    private healthCheckModel: Model<WhatsAppHealthCheck>,
    @InjectModel(Alert.name)
    private alertModel: Model<Alert>,
    @InjectModel(WhatsAppSession.name)
    private sessionModel: Model<WhatsAppSession>,
    @InjectModel(User.name)
    private userModel: Model<User>,
  ) {}

  /**
   * Scheduled health check - runs every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async performScheduledHealthCheck() {
    this.logger.log('Starting scheduled WhatsApp health check...');
    
    try {
      // Get all active WhatsApp sessions
      const activeSessions = await this.sessionModel.find({
        isActive: true,
        status: { $in: [SessionStatus.READY, SessionStatus.CONNECTING] },
      }).populate('userId');

      this.logger.log(`Found ${activeSessions.length} active sessions to check`);

      for (const session of activeSessions) {
        await this.checkSessionHealth(session);
      }

      this.logger.log('Scheduled health check completed');
    } catch (error) {
      this.logger.error('Error during scheduled health check:', error);
    }
  }

  /**
   * Check health of a specific session
   */
  async checkSessionHealth(session: any): Promise<WhatsAppHealthCheck> {
    const startTime = Date.now();
    
    try {
      this.logger.log(`Checking health for session: ${session.phoneNumber}`);

      // Perform the actual health check
      const checkResult = await this.performHealthCheck(session);
      const responseTime = Date.now() - startTime;

      // Get previous consecutive failures
      const lastCheck = await this.healthCheckModel
        .findOne({ sessionId: session._id })
        .sort({ checkedAt: -1 });

      const previousConsecutiveFailures = lastCheck?.consecutiveFailures || 0;
      
      // Calculate new consecutive failures
      let consecutiveFailures = 0;
      if (checkResult.status === HealthCheckStatus.FAILED) {
        consecutiveFailures = previousConsecutiveFailures + 1;
      }

      // Create health check record
      const healthCheck = new this.healthCheckModel({
        _id: new Types.ObjectId(),
        sessionId: session._id,
        phoneNumber: session.phoneNumber,
        userId: session.userId._id || session.userId,
        entityId: session.entityId,
        entityIdPath: session.entityIdPath,
        tenantId: session.tenantId,
        checkType: HealthCheckType.SESSION_VALIDITY,
        status: checkResult.status,
        checkedAt: new Date(),
        responseTime,
        consecutiveFailures,
        errorMessage: checkResult.errorMessage,
        errorCode: checkResult.errorCode,
        errorDetails: checkResult.errorDetails,
        metadata: {
          sessionStatus: session.status,
          lastConnectedAt: session.connectedAt,
        },
        createdBy: 'system',
      });

      await healthCheck.save();

      // Check if we need to trigger an alert
      if (consecutiveFailures >= this.CONSECUTIVE_FAILURE_THRESHOLD && !healthCheck.alertTriggered) {
        await this.createHealthAlert(session, healthCheck, consecutiveFailures);
        healthCheck.alertTriggered = true;
        await healthCheck.save();
      }

      // If check succeeded after failures, resolve any open alerts
      if (checkResult.status === HealthCheckStatus.SUCCESS && previousConsecutiveFailures > 0) {
        await this.resolveHealthAlerts(session._id);
      }

      return healthCheck;
    } catch (error) {
      this.logger.error(`Error checking health for session ${session.phoneNumber}:`, error);
      
      // Create a failed health check record
      const healthCheck = new this.healthCheckModel({
        _id: new Types.ObjectId(),
        sessionId: session._id,
        phoneNumber: session.phoneNumber,
        userId: session.userId._id || session.userId,
        entityId: session.entityId,
        entityIdPath: session.entityIdPath,
        tenantId: session.tenantId,
        checkType: HealthCheckType.SESSION_VALIDITY,
        status: HealthCheckStatus.FAILED,
        checkedAt: new Date(),
        responseTime: Date.now() - startTime,
        consecutiveFailures: 1,
        errorMessage: error.message,
        errorCode: 'HEALTH_CHECK_ERROR',
        errorDetails: { error: error.toString() },
        createdBy: 'system',
      });

      await healthCheck.save();
      return healthCheck;
    }
  }

  /**
   * Perform the actual health check logic
   */
  private async performHealthCheck(session: any): Promise<{
    status: HealthCheckStatus;
    errorMessage?: string;
    errorCode?: string;
    errorDetails?: any;
  }> {
    try {
      // Check 1: Session status
      if (session.status === SessionStatus.DISCONNECTED || session.status === SessionStatus.FAILED) {
        return {
          status: HealthCheckStatus.FAILED,
          errorMessage: 'Session is disconnected or failed',
          errorCode: 'SESSION_DISCONNECTED',
          errorDetails: { sessionStatus: session.status },
        };
      }

      // Check 2: Session hasn't been connected in a long time
      if (session.connectedAt) {
        const hoursSinceConnection = (Date.now() - new Date(session.connectedAt).getTime()) / (1000 * 60 * 60);
        if (hoursSinceConnection > 24) {
          return {
            status: HealthCheckStatus.WARNING,
            errorMessage: 'Session has not been active for more than 24 hours',
            errorCode: 'SESSION_INACTIVE',
            errorDetails: { hoursSinceConnection },
          };
        }
      }

      // Check 3: QR code timeout (if waiting for QR scan for too long)
      if (session.status === SessionStatus.QR_REQUIRED) {
        const qrAge = Date.now() - new Date(session.qrCode?.timestamp || session.updatedAt).getTime();
        const qrAgeMinutes = qrAge / (1000 * 60);
        
        if (qrAgeMinutes > 10) {
          return {
            status: HealthCheckStatus.WARNING,
            errorMessage: 'QR code has expired, awaiting scan',
            errorCode: 'QR_EXPIRED',
            errorDetails: { qrAgeMinutes },
          };
        }
      }

      // Check 4: Check for recent failed messages (if applicable)
      // This could be expanded to check message delivery rates

      // All checks passed
      return {
        status: HealthCheckStatus.SUCCESS,
      };
    } catch (error) {
      return {
        status: HealthCheckStatus.FAILED,
        errorMessage: error.message,
        errorCode: 'UNKNOWN_ERROR',
        errorDetails: { error: error.toString() },
      };
    }
  }

  /**
   * Create an alert when consecutive failures threshold is reached
   */
  private async createHealthAlert(session: any, healthCheck: WhatsAppHealthCheck, consecutiveFailures: number) {
    try {
      this.logger.warn(
        `Creating alert for ${session.phoneNumber} after ${consecutiveFailures} consecutive failures`
      );

      // Check if there's already an open alert for this session
      const existingAlert = await this.alertModel.findOne({
        sessionId: session._id,
        type: { $in: [AlertType.ACCOUNT_BLOCKED, AlertType.ACCOUNT_SUSPENDED, AlertType.CONNECTION_LOST] },
        status: AlertStatus.OPEN,
      });

      if (existingAlert) {
        // Update existing alert
        existingAlert.occurrenceCount += 1;
        existingAlert.lastOccurredAt = new Date();
        existingAlert.description = `WhatsApp account has failed ${consecutiveFailures} consecutive health checks. Last error: ${healthCheck.errorMessage}`;
        existingAlert.metadata = {
          ...existingAlert.metadata,
          lastHealthCheckId: healthCheck._id,
          consecutiveFailures,
          lastErrorCode: healthCheck.errorCode,
        };
        await existingAlert.save();
        
        healthCheck.alertId = existingAlert._id;
        this.logger.log(`Updated existing alert ${existingAlert._id} for session ${session.phoneNumber}`);
      } else {
        // Create new alert
        const alert = new this.alertModel({
          type: AlertType.ACCOUNT_BLOCKED,
          severity: AlertSeverity.CRITICAL,
          status: AlertStatus.OPEN,
          title: 'WhatsApp Account Blocked/Suspended',
          description: `WhatsApp account ${session.phoneNumber} has failed ${consecutiveFailures} consecutive health checks. Possible account blocking or suspension detected.`,
          userId: session.userId._id || session.userId,
          sessionId: session._id,
          phoneNumber: session.phoneNumber,
          entityId: session.entityId,
          entityIdPath: session.entityIdPath,
          tenantId: session.tenantId,
          occurrenceCount: 1,
          firstOccurredAt: new Date(),
          lastOccurredAt: new Date(),
          metadata: {
            healthCheckId: healthCheck._id,
            consecutiveFailures,
            errorMessage: healthCheck.errorMessage,
            errorCode: healthCheck.errorCode,
            sessionStatus: session.status,
          },
          tags: ['health-check', 'automated'],
          createdBy: 'system',
        });

        await alert.save();
        healthCheck.alertId = alert._id;
        this.logger.log(`Created new alert ${alert._id} for session ${session.phoneNumber}`);
      }
    } catch (error) {
      this.logger.error('Error creating health alert:', error);
    }
  }

  /**
   * Resolve alerts when health check succeeds
   */
  private async resolveHealthAlerts(sessionId: Types.ObjectId) {
    try {
      const openAlerts = await this.alertModel.find({
        sessionId,
        type: { $in: [AlertType.ACCOUNT_BLOCKED, AlertType.ACCOUNT_SUSPENDED, AlertType.CONNECTION_LOST] },
        status: AlertStatus.OPEN,
      });

      for (const alert of openAlerts) {
        alert.status = AlertStatus.RESOLVED;
        alert.resolvedAt = new Date();
        alert.resolvedBy = 'system';
        alert.resolutionNotes = 'Health check succeeded - session recovered';
        await alert.save();
        
        this.logger.log(`Auto-resolved alert ${alert._id} - session recovered`);
      }
    } catch (error) {
      this.logger.error('Error resolving health alerts:', error);
    }
  }

  /**
   * Get health check history for a session
   */
  async getHealthCheckHistory(sessionId: string, limit: number = 10) {
    return this.healthCheckModel
      .find({ sessionId: new Types.ObjectId(sessionId) })
      .sort({ checkedAt: -1 })
      .limit(limit)
      .lean();
  }

  /**
   * Get health check statistics for a user
   */
  async getUserHealthStats(userId: string) {
    const userObjectId = new Types.ObjectId(userId);
    
    const recentChecks = await this.healthCheckModel
      .find({ userId: userObjectId })
      .sort({ checkedAt: -1 })
      .limit(10)
      .lean();

    const lastCheck = recentChecks[0];
    const successCount = recentChecks.filter(c => c.status === HealthCheckStatus.SUCCESS).length;
    const failureCount = recentChecks.filter(c => c.status === HealthCheckStatus.FAILED).length;
    const successRate = recentChecks.length > 0 ? (successCount / recentChecks.length) * 100 : 0;

    return {
      lastCheck: lastCheck?.checkedAt,
      lastStatus: lastCheck?.status,
      consecutiveFailures: lastCheck?.consecutiveFailures || 0,
      successRate: Math.round(successRate),
      recentChecks: recentChecks.length,
      alertTriggered: lastCheck?.alertTriggered || false,
    };
  }

  /**
   * Manual health check trigger
   */
  async triggerManualHealthCheck(sessionId: string) {
    const session = await this.sessionModel.findById(sessionId).populate('userId');
    
    if (!session) {
      throw new Error('Session not found');
    }

    return this.checkSessionHealth(session);
  }

  /**
   * Manual health check trigger by user ID
   */
  async triggerManualHealthCheckByUserId(userId: string) {
    const session = await this.sessionModel
      .findOne({ userId: new Types.ObjectId(userId), isActive: true })
      .populate('userId');
    
    if (!session) {
      throw new Error('No active WhatsApp session found for this user');
    }

    return this.checkSessionHealth(session);
  }
}

