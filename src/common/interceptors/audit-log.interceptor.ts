import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditLog, AuditLogDocument, HttpMethod, AuditLogStatus } from '../schemas/audit-log.schema';
import { Types } from 'mongoose';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(
    @InjectModel(AuditLog.name)
    private auditLogModel: Model<AuditLogDocument>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startTime = Date.now();

    // Skip logging for health checks and docs
    if (
      request.url.startsWith('/api/docs') ||
      request.url.startsWith('/api/v1/health') ||
      request.url === '/favicon.ico'
    ) {
      return next.handle();
    }

    // Extract user information from request
    const user = (request as any).user;
    const userId = user?.sub || null;
    const tenantId = user?.tenantId || null;
    const userEmail = user?.email || null;
    const userRole = user?.role || null;

    // Extract request information
    const method = request.method as HttpMethod;
    const url = request.url;
    const path = request.path || request.route?.path || url.split('?')[0];
    const queryParams = request.query || {};
    const requestBody = this.sanitizeBody(request.body);
    const requestHeaders = this.sanitizeHeaders(request.headers);
    const ipAddress = this.getIpAddress(request);
    const userAgent = request.headers['user-agent'] || '';

    return next.handle().pipe(
      tap((data) => {
        const duration = Date.now() - startTime;
        const statusCode = response.statusCode;
        const status = statusCode >= 200 && statusCode < 400 
          ? AuditLogStatus.SUCCESS 
          : AuditLogStatus.ERROR;

        // Sanitize response body (limit size)
        const responseBody = this.sanitizeResponse(data);

        // Save audit log asynchronously (don't block the response)
        this.saveAuditLog({
          method,
          url,
          path,
          queryParams,
          requestBody,
          requestHeaders,
          statusCode,
          responseBody,
          responseHeaders: this.sanitizeHeaders(response.getHeaders()),
          userId,
          tenantId,
          userEmail,
          userRole,
          ipAddress,
          userAgent,
          status,
          duration,
        }).catch((error) => {
          this.logger.error(`Failed to save audit log: ${error.message}`);
        });
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        const statusCode = error.status || 500;
        const status = AuditLogStatus.FAILED;

        // Save audit log for errors
        this.saveAuditLog({
          method,
          url,
          path,
          queryParams,
          requestBody,
          requestHeaders,
          statusCode,
          responseBody: {},
          responseHeaders: {},
          userId,
          tenantId,
          userEmail,
          userRole,
          ipAddress,
          userAgent,
          status,
          duration,
          errorMessage: error.message,
          errorStack: error.stack,
        }).catch((err) => {
          this.logger.error(`Failed to save audit log for error: ${err.message}`);
        });

        throw error;
      }),
    );
  }

  private async saveAuditLog(data: Partial<AuditLog>): Promise<void> {
    try {
      if (!this.auditLogModel) {
        this.logger.warn('AuditLogModel not available, skipping audit log');
        return;
      }
      await this.auditLogModel.create({
        _id: new Types.ObjectId(),
        ...data
      });
    } catch (error) {
      // Don't throw errors - audit logging should not break the application
      this.logger.error(`Error saving audit log: ${error.message}`);
    }
  }

  private sanitizeBody(body: any): Record<string, any> {
    if (!body || typeof body !== 'object') {
      return {};
    }

    const sanitized: Record<string, any> = {};
    const sensitiveFields = ['password', 'token', 'secret', 'authorization', 'apiKey', 'accessToken', 'refreshToken'];

    for (const [key, value] of Object.entries(body)) {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
        sanitized[key] = '***REDACTED***';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeBody(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private sanitizeHeaders(headers: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];

    for (const [key, value] of Object.entries(headers)) {
      if (sensitiveHeaders.some(header => key.toLowerCase().includes(header))) {
        sanitized[key] = '***REDACTED***';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private sanitizeResponse(data: any): Record<string, any> {
    if (!data) {
      return {};
    }

    // Limit response size to prevent storing huge responses
    const maxSize = 10000; // 10KB
    const jsonString = JSON.stringify(data);
    
    if (jsonString.length > maxSize) {
      return {
        _truncated: true,
        _size: jsonString.length,
        _message: 'Response body too large, truncated',
      };
    }

    return typeof data === 'object' ? data : { value: data };
  }

  private getIpAddress(request: Request): string {
    return (
      (request.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      request.ip ||
      request.connection.remoteAddress ||
      'unknown'
    );
  }
}

