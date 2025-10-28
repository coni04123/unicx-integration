import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request } from 'express';
import { AuditService } from '../services/audit.service';
import { AUDIT_KEY, AuditOptions } from '../decorators/audit.decorator';
import { AuditAction, AuditResource, AuditResult } from '../schemas/audit-log.schema';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private reflector: Reflector,
    private auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const auditOptions = this.reflector.getAllAndOverride<AuditOptions>(
      AUDIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!auditOptions) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as any).user;

    if (!user) {
      this.logger.warn('No user found in request for audit logging');
      return next.handle();
    }

    const startTime = Date.now();

    return next.handle().pipe(
      tap(async (response) => {
        if (auditOptions.skipSuccess) return;

        try {
          const resourceId = this.extractResourceId(auditOptions, request, response);
          const resourceName = this.extractResourceName(auditOptions, request, response);

          await this.auditService.logSuccess(
            auditOptions.action,
            auditOptions.resource,
            resourceId,
            resourceName,
            user.sub,
            user.email,
            `${user.firstName} ${user.lastName}`,
            user.tenantId,
            user.tenantName || 'Unknown Tenant',
            request.ip || request.connection.remoteAddress || 'unknown',
            request.get('User-Agent') || 'unknown',
            this.extractOldValues(request),
            this.extractNewValues(request, response),
            {
              executionTime: Date.now() - startTime,
              method: request.method,
              url: request.url,
            },
          );
        } catch (error) {
          this.logger.error(`Failed to log audit success: ${error.message}`, error);
        }
      }),
      catchError(async (error) => {
        if (auditOptions.skipFailure) throw error;

        try {
          const resourceId = this.extractResourceId(auditOptions, request, null);
          const resourceName = this.extractResourceName(auditOptions, request, null);

          await this.auditService.logFailure(
            auditOptions.action,
            auditOptions.resource,
            resourceId,
            resourceName,
            user.sub,
            user.email,
            `${user.firstName} ${user.lastName}`,
            user.tenantId,
            user.tenantName || 'Unknown Tenant',
            request.ip || request.connection.remoteAddress || 'unknown',
            request.get('User-Agent') || 'unknown',
            error.message,
            {
              executionTime: Date.now() - startTime,
              method: request.method,
              url: request.url,
              errorCode: error.status || error.code,
            },
          );
        } catch (auditError) {
          this.logger.error(`Failed to log audit failure: ${auditError.message}`, auditError);
        }

        throw error;
      }),
    );
  }

  private extractResourceId(options: AuditOptions, request: Request, response: any): string {
    if (options.resourceId) {
      return options.resourceId;
    }

    // Try to extract from URL parameters
    const params = request.params;
    if (params.id) return params.id;
    if (params.sessionId) return params.sessionId;
    if (params.userId) return params.userId;
    if (params.entityId) return params.entityId;

    // Try to extract from response
    if (response && response._id) return response._id.toString();
    if (response && response.id) return response.id.toString();

    return 'unknown';
  }

  private extractResourceName(options: AuditOptions, request: Request, response: any): string {
    if (options.resourceName) {
      return options.resourceName;
    }

    // Try to extract from request body
    const body = request.body;
    if (body && body.name) return body.name;
    if (body && body.email) return body.email;
    if (body && body.title) return body.title;

    // Try to extract from response
    if (response && response.name) return response.name;
    if (response && response.email) return response.email;
    if (response && response.title) return response.title;

    return `${options.resource}_${this.extractResourceId(options, request, response)}`;
  }

  private extractOldValues(request: Request): Record<string, any> | undefined {
    // This would typically come from a before/after comparison
    // For now, we'll return undefined as we don't have a standard way to track old values
    return undefined;
  }

  private extractNewValues(request: Request, response: any): Record<string, any> | undefined {
    if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
      return request.body;
    }
    return undefined;
  }
}
