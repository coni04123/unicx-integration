import { Injectable, Logger } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface WhatsAppEvent {
  type: 'status' | 'qr' | 'health';
  sessionId: string;
  userId: string;
  data: any;
  timestamp: Date;
}

@Injectable()
export class WhatsAppEventsService {
  private readonly logger = new Logger(WhatsAppEventsService.name);
  private events = new Subject<WhatsAppEvent>();

  constructor() {}

  subscribe(userId: string) { 
    return this.events.asObservable();
  }

  emitStatusChange(sessionId: string, userId: string, status: string) {
    this.emit({
      type: 'status',
      sessionId,
      userId,
      data: { status },
      timestamp: new Date(),
    });
  }

  emitQRCode(sessionId: string, userId: string, qrCode: string, expiresAt: Date) {
    this.emit({
      type: 'qr',
      sessionId,
      userId,
      data: { qrCode, expiresAt },
      timestamp: new Date(),
    });
  }

  emitHealthUpdate(sessionId: string, userId: string, healthStatus: any) {
    this.emit({
      type: 'health',
      sessionId,
      userId,
      data: healthStatus,
      timestamp: new Date(),
    });
  }

  private emit(event: WhatsAppEvent) {
    this.logger.debug(`Emitting event: ${event.type} for session ${event.sessionId}`);
    this.events.next(event);
  }
}
