import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ServiceBusClient, ServiceBusReceiver, ServiceBusReceivedMessage } from '@azure/service-bus';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { MessagePayload } from '../../common/messaging/messaging.service';
import { MessageTopic } from '../../common/messaging/messaging.service';

interface EmailEventData {
  to: string;
  templateId?: string;
  subject?: string;
  templateData?: Record<string, any>;
}

@Injectable()
export class EmailEventConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailEventConsumer.name);
  private serviceBusClient: ServiceBusClient;
  private receiver: ServiceBusReceiver;
  private isProcessing = false;
  private shouldStop = false;

  constructor(
    private configService: ConfigService,
    private emailService: EmailService,
  ) {}

  async onModuleInit() {
    const connectionString = this.configService.get<string>('azure.serviceBus.connectionString');
    
    if (!connectionString) {
      this.logger.warn('Azure Service Bus connection string not configured. Email event consumer will not start.');
      return;
    }

    try {
      this.serviceBusClient = new ServiceBusClient(connectionString);
      const topicName = MessageTopic.EMAIL_EVENTS;
      const subscriptionName = this.configService.get<string>('azure.serviceBus.emailSubscription') || 'email-processor';
      
      this.receiver = this.serviceBusClient.createReceiver(topicName, subscriptionName, {
        receiveMode: 'peekLock',
        maxAutoLockRenewalDurationInMs: 300000, // 5 minutes
      });

      this.logger.log(`Email event consumer initialized for topic: ${topicName}, subscription: ${subscriptionName}`);
      
      // Start processing messages
      this.startProcessing();
    } catch (error) {
      this.logger.error(`Failed to initialize email event consumer: ${error.message}`, error.stack);
      this.logger.warn('Make sure the Azure Service Bus topic and subscription exist. Topic: email-events, Subscription: email-processor');
    }
  }

  private async startProcessing() {
    if (this.isProcessing || !this.receiver) {
      return;
    }

    this.isProcessing = true;
    this.shouldStop = false;

    this.logger.log('Starting email event consumer...');

    while (!this.shouldStop && this.receiver) {
      try {
        const messages = await this.receiver.receiveMessages(10, {
          maxWaitTimeInMs: 5000, // Wait up to 5 seconds for messages
        });

        if (messages.length === 0) {
          // No messages, continue loop
          continue;
        }

        this.logger.debug(`Received ${messages.length} email event message(s)`);

        // Process messages in parallel
        await Promise.all(
          messages.map(message => this.processMessage(message))
        );
      } catch (error) {
        if (!this.shouldStop) {
          this.logger.error(`Error receiving messages: ${error.message}`, error.stack);
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }

    this.isProcessing = false;
    this.logger.log('Email event consumer stopped');
  }

  private async processMessage(message: ServiceBusReceivedMessage) {
    try {
      const payload = message.body as MessagePayload<EmailEventData>;
      
      if (!payload || !payload.data) {
        this.logger.warn('Invalid message payload, skipping');
        await this.receiver.completeMessage(message);
        return;
      }

      const { eventType, data } = payload;
      const { to, templateId, subject, templateData } = data;

      if (!to) {
        this.logger.warn('Email address missing in message, skipping');
        await this.receiver.completeMessage(message);
        return;
      }

      this.logger.log(`Processing email event: ${eventType} for ${to}`);

      // Determine template ID based on event type if not provided
      let finalTemplateId = templateId;
      if (!finalTemplateId) {
        if (eventType.includes('manager')) {
          finalTemplateId = 'tenant-admin-invitation';
        } else if (eventType.includes('user')) {
          finalTemplateId = 'user-invitation';
        } else {
          finalTemplateId = 'invitation';
        }
      }

      // Send email using EmailService
      await this.emailService.sendInvitationEmail(
        to,
        finalTemplateId,
        {
          subject: subject || 'Welcome to UNICX',
          ...templateData,
        }
      );

      this.logger.log(`Email sent successfully for event ${eventType} to ${to}`);

      // Complete the message to remove it from the queue
      await this.receiver.completeMessage(message);
    } catch (error) {
      this.logger.error(`Failed to process email event message: ${error.message}`, error.stack);
      
      // Dead letter the message after max retries
      try {
        await this.receiver.deadLetterMessage(message, {
          deadLetterReason: 'ProcessingFailed',
          deadLetterErrorDescription: error.message,
        });
        this.logger.error(`Message dead-lettered for ${message.body?.data?.to || 'unknown'}`);
      } catch (dlError) {
        this.logger.error(`Failed to dead-letter message: ${dlError.message}`);
        // Try to abandon the message so it can be retried
        try {
          await this.receiver.abandonMessage(message);
        } catch (abandonError) {
          this.logger.error(`Failed to abandon message: ${abandonError.message}`);
        }
      }
    }
  }

  async onModuleDestroy() {
    this.shouldStop = true;
    
    if (this.receiver) {
      try {
        await this.receiver.close();
        this.logger.log('Email event receiver closed');
      } catch (error) {
        this.logger.error(`Error closing receiver: ${error.message}`);
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

