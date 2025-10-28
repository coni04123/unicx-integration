import { SetMetadata } from '@nestjs/common';
import { AuditAction, AuditResource } from '../schemas/audit-log.schema';

export const AUDIT_KEY = 'audit';

export interface AuditOptions {
  action: AuditAction;
  resource: AuditResource;
  resourceId?: string;
  resourceName?: string;
  skipSuccess?: boolean;
  skipFailure?: boolean;
}

export const Audit = (options: AuditOptions) => SetMetadata(AUDIT_KEY, options);
