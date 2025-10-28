import { Injectable, Logger } from '@nestjs/common';
import { ServiceBusClient, ServiceBusMessage, ServiceBusReceiver, ServiceBusSender } from '@azure/service-bus';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DLQMessage } from './schemas/dlq-message.schema';

export interface DLQMessageOptions {
  maxRetries?: number;
  retryDelay?: number;  // in milliseconds
  topic?: string;
  subscription?: string;
}

@Injectable()
export class DLQService {
  private readonly logger = new Logger(DLQService.name);
  private readonly serviceBusClient: ServiceBusClient;
  private readonly defaultMaxRetries = 3;
  private readonly defaultRetryDelay = 60000; // 1 minute

  constructor(
    private configService: ConfigService,
    @InjectModel(DLQMessage.name)
    private dlqMessageModel: Model<DLQMessage>,
  ) {
    const connectionString = this.configService.get<string>('azure.serviceBus.connectionString');
    if (!connectionString) {
      throw new Error('Azure Service Bus connection string not configured');
    }
    this.serviceBusClient = new ServiceBusClient(connectionString);
  }

  /**
   * Send a message to the DLQ
   */
  async sendToDLQ(
    message: any,
    error: Error,
    options: DLQMessageOptions = {}
  ): Promise<void> {
    const {
      maxRetries = this.defaultMaxRetries,
      retryDelay = this.defaultRetryDelay,
      topic,
      subscription
    } = options;

    // Create DLQ message record
    const dlqMessage = await this.dlqMessageModel.create({
      originalMessage: message,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      topic,
      subscription,
      maxRetries,
      retryCount: 0,
      nextRetryAt: new Date(Date.now() + retryDelay),
      status: 'pending',
    });

    // Send to Azure Service Bus DLQ
    const sender = this.serviceBusClient.createSender(topic);
    try {
      const serviceBusMessage: ServiceBusMessage = {
        body: message,
        applicationProperties: {
          dlqMessageId: dlqMessage._id.toString(),
          error: error.message,
          retryCount: 0,
          maxRetries,
        },
      };
      await sender.sendMessages(serviceBusMessage);
      this.logger.log(`Message sent to DLQ: ${dlqMessage._id}`);
    } catch (err) {
      this.logger.error(`Failed to send message to DLQ: ${err.message}`, err.stack);
      throw err;
    } finally {
      await sender.close();
    }
  }

  /**
   * Process messages from DLQ
   */
  async processDLQ(
    topic: string,
    subscription: string,
    processor: (message: any) => Promise<void>
  ): Promise<void> {
    const receiver = this.serviceBusClient.createReceiver(topic, subscription);

    try {
      const messages = await receiver.receiveMessages(100);
      
      for (const message of messages) {
        const dlqMessageId = message.applicationProperties?.dlqMessageId;
        if (!dlqMessageId) {
          this.logger.warn('Message in DLQ without dlqMessageId');
          await receiver.completeMessage(message);
          continue;
        }

        const dlqMessage = await this.dlqMessageModel.findById(dlqMessageId);
        if (!dlqMessage) {
          this.logger.warn(`DLQ message not found: ${dlqMessageId}`);
          await receiver.completeMessage(message);
          continue;
        }

        try {
          // Process the message
          await processor(dlqMessage.originalMessage);
          
          // Mark as completed
          dlqMessage.status = 'completed';
          await dlqMessage.save();
          await receiver.completeMessage(message);
          
          this.logger.log(`Successfully processed DLQ message: ${dlqMessageId}`);
        } catch (error) {
          // Handle retry logic
          dlqMessage.retryCount++;
          dlqMessage.lastError = {
            name: error.name,
            message: error.message,
            stack: error.stack,
          };

          if (dlqMessage.retryCount >= dlqMessage.maxRetries) {
            dlqMessage.status = 'failed';
            await receiver.deadLetterMessage(message, {
              deadLetterReason: 'Max retries exceeded',
              deadLetterErrorDescription: error.message,
            });
          } else {
            dlqMessage.nextRetryAt = new Date(Date.now() + dlqMessage.retryDelay);
            dlqMessage.status = 'pending';
            await receiver.abandonMessage(message);
          }

          await dlqMessage.save();
          this.logger.error(
            `Failed to process DLQ message: ${dlqMessageId}, retry ${dlqMessage.retryCount}/${dlqMessage.maxRetries}`,
            error.stack
          );
        }
      }
    } finally {
      await receiver.close();
    }
  }

  /**
   * Get DLQ statistics
   */
  async getDLQStats() {
    const stats = await this.dlqMessageModel.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          avgRetryCount: { $avg: '$retryCount' },
        },
      },
    ]);

    return {
      byStatus: stats,
      total: await this.dlqMessageModel.countDocuments(),
    };
  }

  async onModuleDestroy() {
    await this.serviceBusClient.close();
  }
}
