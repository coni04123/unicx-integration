import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ServiceBusClient, ServiceBusMessage, ServiceBusSender } from '@azure/service-bus';
import { ConfigService } from '@nestjs/config';

export enum MessageTopic {
  WHATSAPP_EVENTS = 'whatsapp-events',
  USER_EVENTS = 'user-events',
  ENTITY_EVENTS = 'entity-events',
  MESSAGE_EVENTS = 'message-events',
  SESSION_EVENTS = 'session-events',
}

export interface MessagePayload<T = any> {
  eventType: string;
  timestamp: Date;
  data: T;
  correlationId?: string;
  userId?: string;
  tenantId?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class MessagingService implements OnModuleDestroy {
  private readonly logger = new Logger(MessagingService.name);
  private readonly serviceBusClient: ServiceBusClient;
  private readonly senders: Map<string, ServiceBusSender> = new Map();

  constructor(private configService: ConfigService) {
    const connectionString = this.configService.get<string>('azure.serviceBus.connectionString');
    
    if (!connectionString) {
      this.logger.warn('Azure Service Bus connection string not configured. Messaging will be disabled.');
      return;
    }

    try {
      this.serviceBusClient = new ServiceBusClient(connectionString);
      this.logger.log('Azure Service Bus client initialized');
    } catch (error) {
      this.logger.error(`Failed to initialize Service Bus client: ${error.message}`);
    }
  }

  /**
   * Get or create sender for a topic
   */
  private async getSender(topic: string): Promise<ServiceBusSender> {
    if (!this.serviceBusClient) {
      throw new Error('Service Bus client not initialized');
    }

    if (!this.senders.has(topic)) {
      const sender = this.serviceBusClient.createSender(topic);
      this.senders.set(topic, sender);
      this.logger.debug(`Created sender for topic: ${topic}`);
    }

    return this.senders.get(topic);
  }

  /**
   * Publish a message to a topic
   */
  async publish<T = any>(
    topic: MessageTopic | string,
    eventType: string,
    data: T,
    options?: {
      correlationId?: string;
      userId?: string;
      tenantId?: string;
      metadata?: Record<string, any>;
      scheduleEnqueueTime?: Date;
    }
  ): Promise<void> {
    if (!this.serviceBusClient) {
      this.logger.warn(`Messaging disabled. Would have published ${eventType} to ${topic}`);
      return;
    }

    try {
      const payload: MessagePayload<T> = {
        eventType,
        timestamp: new Date(),
        data,
        correlationId: options?.correlationId,
        userId: options?.userId,
        tenantId: options?.tenantId,
        metadata: options?.metadata,
      };

      const message: ServiceBusMessage = {
        body: payload,
        contentType: 'application/json',
        subject: eventType,
        applicationProperties: {
          eventType,
          timestamp: payload.timestamp.toISOString(),
          ...(options?.userId && { userId: options.userId }),
          ...(options?.tenantId && { tenantId: options.tenantId }),
          ...(options?.correlationId && { correlationId: options.correlationId }),
        },
        ...(options?.scheduleEnqueueTime && {
          scheduledEnqueueTimeUtc: options.scheduleEnqueueTime,
        }),
      };

      const sender = await this.getSender(topic);
      await sender.sendMessages(message);

      this.logger.log(`Message published to ${topic}: ${eventType}`);
    } catch (error) {
      this.logger.error(`Failed to publish message to ${topic}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Publish batch messages
   */
  async publishBatch<T = any>(
    topic: MessageTopic | string,
    messages: Array<{
      eventType: string;
      data: T;
      correlationId?: string;
      userId?: string;
      tenantId?: string;
    }>
  ): Promise<void> {
    if (!this.serviceBusClient) {
      this.logger.warn(`Messaging disabled. Would have published batch to ${topic}`);
      return;
    }

    try {
      const serviceBusMessages: ServiceBusMessage[] = messages.map(msg => {
        const payload: MessagePayload<T> = {
          eventType: msg.eventType,
          timestamp: new Date(),
          data: msg.data,
          correlationId: msg.correlationId,
          userId: msg.userId,
          tenantId: msg.tenantId,
        };

        return {
          body: payload,
          contentType: 'application/json',
          subject: msg.eventType,
          applicationProperties: {
            eventType: msg.eventType,
            timestamp: payload.timestamp.toISOString(),
            ...(msg.userId && { userId: msg.userId }),
            ...(msg.tenantId && { tenantId: msg.tenantId }),
            ...(msg.correlationId && { correlationId: msg.correlationId }),
          },
        };
      });

      const sender = await this.getSender(topic);
      await sender.sendMessages(serviceBusMessages);

      this.logger.log(`Batch of ${messages.length} messages published to ${topic}`);
    } catch (error) {
      this.logger.error(`Failed to publish batch to ${topic}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Publish WhatsApp event
   */
  async publishWhatsAppEvent(
    eventType: string,
    data: any,
    sessionId: string,
    tenantId: string
  ): Promise<void> {
    await this.publish(
      MessageTopic.WHATSAPP_EVENTS,
      eventType,
      data,
      {
        correlationId: sessionId,
        tenantId,
        metadata: { sessionId },
      }
    );
  }

  /**
   * Publish message event
   */
  async publishMessageEvent(
    eventType: string,
    messageData: any,
    tenantId: string,
    userId?: string
  ): Promise<void> {
    await this.publish(
      MessageTopic.MESSAGE_EVENTS,
      eventType,
      messageData,
      {
        tenantId,
        userId,
      }
    );
  }

  /**
   * Publish user event
   */
  async publishUserEvent(
    eventType: string,
    userData: any,
    userId: string,
    tenantId: string
  ): Promise<void> {
    await this.publish(
      MessageTopic.USER_EVENTS,
      eventType,
      userData,
      {
        userId,
        tenantId,
      }
    );
  }

  /**
   * Close all senders and client
   */
  async onModuleDestroy() {
    this.logger.log('Closing Service Bus connections');

    for (const [topic, sender] of this.senders.entries()) {
      try {
        await sender.close();
        this.logger.debug(`Closed sender for topic: ${topic}`);
      } catch (error) {
        this.logger.error(`Error closing sender for ${topic}: ${error.message}`);
      }
    }

    if (this.serviceBusClient) {
      try {
        await this.serviceBusClient.close();
        this.logger.log('Service Bus client closed');
      } catch (error) {
        this.logger.error(`Error closing Service Bus client: ${error.message}`);
      }
    }
  }
}

