import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../../modules/email/email.service';

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  timestamp: Date;
  services: {
    database: ServiceHealth;
    email: ServiceHealth;
    memory: ServiceHealth;
  };
  uptime: number;
  version: string;
}

export interface ServiceHealth {
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime?: number;
  error?: string;
  details?: Record<string, any>;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startTime = Date.now();

  constructor(
    @InjectConnection() private connection: Connection,
    private configService: ConfigService,
    private emailService: EmailService,
  ) {}

  async checkHealth(): Promise<HealthCheckResult> {
    const timestamp = new Date();
    const services = await this.checkAllServices();

    const overallStatus = this.determineOverallStatus(services);

    return {
      status: overallStatus,
      timestamp,
      services,
      uptime: Date.now() - this.startTime,
      version: process.env.npm_package_version || '1.0.0',
    };
  }

  private async checkAllServices(): Promise<HealthCheckResult['services']> {
    const [database, email, memory] = await Promise.allSettled([
      this.checkDatabase(),
      this.checkEmail(),
      this.checkMemory(),
    ]);

    return {
      database: database.status === 'fulfilled' ? database.value : { status: 'unhealthy', error: 'Database check failed' },
      email: email.status === 'fulfilled' ? email.value : { status: 'unhealthy', error: 'Email check failed' },
      memory: memory.status === 'fulfilled' ? memory.value : { status: 'unhealthy', error: 'Memory check failed' },
    };
  }

  private async checkDatabase(): Promise<ServiceHealth> {
    const startTime = Date.now();
    try {
      await this.connection.db.admin().ping();
      const responseTime = Date.now() - startTime;

      return {
        status: 'healthy',
        responseTime,
        details: {
          connectionState: this.connection.readyState,
          host: this.connection.host,
          port: this.connection.port,
          name: this.connection.name,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  private async checkEmail(): Promise<ServiceHealth> {
    const startTime = Date.now();
    try {
      const isConnected = await this.emailService.verifyConnection();
      const responseTime = Date.now() - startTime;

      return {
        status: isConnected ? 'healthy' : 'degraded',
        responseTime,
        details: {
          host: this.configService.get<string>('email.host'),
          port: this.configService.get<number>('email.port'),
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error.message,
      };
    }
  }


  private async checkMemory(): Promise<ServiceHealth> {
    const startTime = Date.now();
    try {
      const memUsage = process.memoryUsage();
      const totalMem = memUsage.heapTotal;
      const usedMem = memUsage.heapUsed;
      const freeMem = totalMem - usedMem;
      const usagePercentage = (usedMem / totalMem) * 100;

      const status = usagePercentage > 90 ? 'unhealthy' : usagePercentage > 75 ? 'degraded' : 'healthy';

      return {
        status,
        responseTime: Date.now() - startTime,
        details: {
          total: Math.round(totalMem / 1024 / 1024) + ' MB',
          used: Math.round(usedMem / 1024 / 1024) + ' MB',
          free: Math.round(freeMem / 1024 / 1024) + ' MB',
          usagePercentage: Math.round(usagePercentage) + '%',
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  private determineOverallStatus(services: HealthCheckResult['services']): 'healthy' | 'unhealthy' {
    const serviceStatuses = Object.values(services).map(service => service.status);
    
    if (serviceStatuses.includes('unhealthy')) {
      return 'unhealthy';
    }
    
    if (serviceStatuses.includes('degraded')) {
      return 'unhealthy';
    }
    
    return 'healthy';
  }

  async getMetrics(): Promise<any> {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
        external: Math.round(memUsage.external / 1024 / 1024) + ' MB',
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
      uptime: process.uptime(),
      timestamp: new Date(),
    };
  }
}
