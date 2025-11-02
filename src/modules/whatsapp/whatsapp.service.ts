import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DLQService } from '../dlq/dlq.service';
import { WhatsAppEventsService } from './whatsapp-events.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import * as QRCode from 'qrcode';
import { ConfigService } from '@nestjs/config';
import { WhatsAppSession, SessionStatus } from '../../common/schemas/whatsapp-session.schema';
import { Message, MessageDirection, MessageStatus, MessageType } from '../../common/schemas/message.schema';
import { User } from '../../common/schemas/user.schema';
import { Types } from 'mongoose';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { EntitiesService } from '../entities/entities.service';
import { StorageService } from '../storage/storage.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class WhatsAppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppService.name);
  private clients: Map<string, Client> = new Map();
  private healthChecks: Map<string, {
    lastCheck: Date;
    lastStatus: 'success' | 'failed' | 'warning';
    consecutiveFailures: number;
    successRate: number;
    recentChecks: number;
    alertTriggered: boolean;
  }> = new Map();

  constructor(
    @InjectModel(WhatsAppSession.name)
    private sessionModel: Model<WhatsAppSession>,
    @InjectModel(Message.name)
    private messageModel: Model<Message>,
    @InjectModel(User.name)
    private userModel: Model<User>,
    private configService: ConfigService,
    private entityService: EntitiesService,
    private storageService: StorageService,
    private dlqService: DLQService,
    private eventsService: WhatsAppEventsService,
    private emailService: EmailService,
  ) {}

  async onModuleInit() {
    this.logger.log('WhatsApp Service initialized');
    // Reconnect active sessions on startup
    await this.reconnectActiveSessions();
  }

  async onModuleDestroy() {
    this.logger.log('Destroying all WhatsApp clients');
    for (const [sessionId, client] of this.clients.entries()) {
      await this.disconnectSession(sessionId);
    }
  }

  async createSession(sessionId: string, userId: Types.ObjectId, invitedBy: string, entityId: string, tenantId: string): Promise<WhatsAppSession> {
    this.logger.log(`Creating new WhatsApp session: ${sessionId}`);
    // Get entity path before creating session
    const entityObjectId = new Types.ObjectId(entityId);
    this.logger.log(`Creating WhatsApp session for entity: ${entityId}`);

    let entityIdPath: Types.ObjectId[] = [];
    
    // Check if this is a System Admin (special entity ID)
    const isSystemAdmin = entityId === "000000000000000000000001";
    
    if (isSystemAdmin) {
      this.logger.log("Creating session for System Administrator");
      entityIdPath = [entityObjectId]; // System Admin's own entity ID only
    } else {
      // For regular users, get the full entity path
      const entity = await this.entityService.findOne(entityId, null);
      this.logger.log(`Entity found: ${JSON.stringify(entity)}`);
      
      if (!entity) {
        throw new Error(`Entity not found: ${entityId}`);
      }
      
      if (!entity.entityIdPath || !entity.entityIdPath.length) {
        this.logger.warn(`No entity path found for entity: ${entityId}, using entity ID only`);
        entityIdPath = [entityObjectId];
      } else {
        entityIdPath = entity.entityIdPath;
      }
    }

    // Check if session already exists
    let session = await this.sessionModel.findOne({ sessionId });
    
    if (!session) {
      session = await this.sessionModel.create({
        _id: new Types.ObjectId(),
        sessionId,
        userId,
        entityId: entityObjectId,
        entityIdPath: entityIdPath,
        tenantId: isSystemAdmin ? entityObjectId : new Types.ObjectId(tenantId),
        status: SessionStatus.CONNECTING,
        createdBy: invitedBy,
      });
    } else {
      // Update existing session with entity path
      session = await this.sessionModel.findOneAndUpdate(
        { sessionId },
        { 
          entityIdPath: entityIdPath,
          tenantId: isSystemAdmin ? entityObjectId : new Types.ObjectId(tenantId),
          lastActivityAt: new Date()
        },
        { new: true }
      );
    }

    // Initialize WhatsApp client
    await this.initializeClient(sessionId);

    return session;
  }

  private async initializeClient(sessionId: string): Promise<void> {
    try {
      if (this.clients.has(sessionId)) {
        this.logger.warn(`Client already exists for session: ${sessionId}`);
        return;
      }

      // Step 1: Detect Chrome path
      const platform = os.platform();
      this.logger.log(`Detecting Chrome path for platform: ${platform}`);

      const windowsPaths = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        process.env.CHROME_PATH, // Allow override via env var
      ];

      const linuxPaths = [
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        process.env.CHROME_PATH,
      ];

      const macPaths = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        process.env.CHROME_PATH,
      ];

      const paths = platform === "win32" ? windowsPaths
                  : platform === "linux" ? linuxPaths
                  : platform === "darwin" ? macPaths
                  : [];

      // Find first existing Chrome path
      let chromePath;
      for (const path of paths) {
        try {
          if (path && fsSync.existsSync(path)) {
            chromePath = path;
            this.logger.log(`Found Chrome at: ${path}`);
            break;
          }
        } catch (error) {
          this.logger.warn(`Error checking Chrome path ${path}: ${error.message}`);
        }
      }

      if (!chromePath) {
        throw new Error("Chrome not found. Please install Chrome or set CHROME_PATH environment variable.");
      }

      // Step 2: Clean up any existing session files
      // try {
      //   const sessionPath = `${process.cwd()}/.wwebjs_auth/session-${sessionId}`;
      //   if (fsSync.existsSync(sessionPath)) {
      //     this.logger.log(`Cleaning up existing session files at: ${sessionPath}`);
      //     await fs.rm(sessionPath, { recursive: true, force: true });
      //     // Wait a bit to ensure files are released
      //     await new Promise(resolve => setTimeout(resolve, 2000));
      //   }
      // } catch (error) {
      //   this.logger.warn(`Failed to clean up existing session files: ${error.message}`);
      //   // Continue anyway - the files might be locked but WhatsApp-web.js can handle it
      // }

      // Step 3: Initialize WhatsApp client
      this.logger.log(`Initializing WhatsApp client for session: ${sessionId}`);
      const client = new Client({
        authStrategy: new LocalAuth({ 
          clientId: sessionId,
          dataPath: process.env.WEBJS_AUTH_PATH || `${process.cwd()}/.wwebjs_auth` 
        }),
        puppeteer: {
          executablePath: chromePath,
          headless: true,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-gpu"
          ],
        },
      });

      // Step 4: Set up event handlers with error handling
      client.on('qr', async (qr) => {
        try {
          this.logger.log(`QR Code received for session: ${sessionId} (length: ${qr.length})`);
          this.logger.debug(`QR Data: ${qr.substring(0, 20)}...`);
          await this.handleQRCode(sessionId, qr);
        } catch (error) {
          this.logger.error(`Error handling QR code for session ${sessionId}:`, error);
          await this.updateSessionStatus(sessionId, SessionStatus.FAILED);
        }
      });

      client.on('ready', async () => {
        try {
          this.logger.log(`WhatsApp client ready for session: ${sessionId}`);
          await this.handleReady(sessionId, client);
        } catch (error) {
          this.logger.error(`Error handling ready event for session ${sessionId}:`, error);
          await this.updateSessionStatus(sessionId, SessionStatus.FAILED);
        }
      });

      client.on('authenticated', async () => {
        try {
          this.logger.log(`WhatsApp client authenticated for session: ${sessionId}`);
          await this.updateSessionStatus(sessionId, SessionStatus.AUTHENTICATED);
        } catch (error) {
          this.logger.error(`Error handling authentication for session ${sessionId}:`, error);
          await this.updateSessionStatus(sessionId, SessionStatus.FAILED);
        }
      });

      client.on('disconnected', async (reason) => {
        try {
          this.logger.warn(`WhatsApp client disconnected for session: ${sessionId}. Reason: ${reason}`);
          await this.handleDisconnected(sessionId, reason);
        } catch (error) {
          this.logger.error(`Error handling disconnect for session ${sessionId}:`, error);
          await this.updateSessionStatus(sessionId, SessionStatus.FAILED);
        }
      });

      client.on('auth_failure', async (msg) => {
        try {
          this.logger.error(`Authentication failed for session ${sessionId}: ${msg}`);
          await this.updateSessionStatus(sessionId, SessionStatus.FAILED);
          await this.handleDisconnected(sessionId, `Authentication failed: ${msg}`);
        } catch (error) {
          this.logger.error(`Error handling auth failure for session ${sessionId}:`, error);
        }
      });

      client.on('message', async (message) => {
        try {
          this.logger.log('This Message', JSON.stringify(message));
          await this.handleIncomingMessage(sessionId, message);
        } catch (error) {
          this.logger.error(`Error handling incoming message for session ${sessionId}:`, error);
        }
      });

      client.on('message_create', async (message) => {
        try {
          if (message.fromMe) {
            await this.handleOutgoingMessage(sessionId, message);
          }
        } catch (error) {
          this.logger.error(`Error handling outgoing message for session ${sessionId}:`, error);
        }
      });

      client.on('message_ack', async (message, ack) => {
        try {
          await this.handleMessageAck(sessionId, message, ack);
        } catch (error) {
          this.logger.error(`Error handling message ack for session ${sessionId}:`, error);
        }
      });

      // Step 5: Initialize the client
      this.logger.log(`Starting WhatsApp client initialization for session: ${sessionId}`);
      this.clients.set(sessionId, client);
      
      try {
        await client.initialize();
        this.logger.log(`WhatsApp client initialization completed for session: ${sessionId}`);
      } catch (error) {
        this.logger.error(`Failed to initialize WhatsApp client for session ${sessionId}:`, error);
        this.clients.delete(sessionId);
        await this.updateSessionStatus(sessionId, SessionStatus.FAILED);
        throw error;
      }
    } catch (error) {
      this.logger.error(`Critical error during client initialization for session ${sessionId}:`, error);
      await this.updateSessionStatus(sessionId, SessionStatus.FAILED);
      throw error;
    }
  }

  private async handleQRCode(sessionId: string, qrData: string, shouldSendEmail: boolean = false): Promise<void> {
    try {
      // Generate QR code as base64 image
      const qrCodeDataUrl = await QRCode.toDataURL(qrData);
      const qrCodeBase64 = qrCodeDataUrl.split(',')[1]; // Remove data:image/png;base64, prefix

      const expiresAt = new Date(Date.now() + 300000); // 5 minutes expiry
      const session = await this.sessionModel.findOneAndUpdate(
        { sessionId },
        {
          status: SessionStatus.QR_REQUIRED,
          qrCode: qrCodeBase64,
          qrCodeGeneratedAt: new Date(),
          qrCodeExpiresAt: expiresAt,
        },
        { new: true }
      );

      if (session) {
        // Emit QR code event
        this.eventsService.emitQRCode(sessionId, session.userId.toString(), qrCodeBase64, expiresAt);

        // If this is a QR code regeneration, send email
        if (shouldSendEmail) {
          const user = await this.userModel.findById(session.userId);
          if (user) {
            await this.emailService.sendInvitationEmailWithQR(user.email, {
              firstName: user.firstName,
              lastName: user.lastName,
              qrCode: qrCodeBase64,
              sessionId,
              expiresAt,
            });
          }
        }
      }

      this.logger.log(`QR Code generated and saved for session: ${sessionId}`);
    } catch (error) {
      this.logger.error(`Failed to handle QR code for session: ${sessionId}`, error);
    }
  }

  private async handleReady(sessionId: string, client: Client): Promise<void> {
    try {
      const info = client.info;
      
      const session = await this.sessionModel.findOneAndUpdate(
        { sessionId },
        {
          status: SessionStatus.READY,
          phoneNumber: info.wid.user,
          whatsappName: info.pushname,
          whatsappId: info.wid._serialized,
          connectedAt: new Date(),
          lastActivityAt: new Date(),
          qrCode: null, // Clear QR code
        },
        { new: true }
      );

      if (session) {
        // Emit status change event
        this.eventsService.emitStatusChange(sessionId, session.userId.toString(), SessionStatus.READY);
      }

      this.logger.log(`Session ready: ${sessionId} - ${info.pushname} (${info.wid.user})`);
    } catch (error) {
      this.logger.error(`Failed to handle ready event for session: ${sessionId}`, error);
    }
  }

  private async handleDisconnected(sessionId: string, reason: string): Promise<void> {
    const session = await this.sessionModel.findOneAndUpdate(
      { sessionId },
      {
        status: SessionStatus.DISCONNECTED,
        disconnectedAt: new Date(),
        lastError: reason,
        lastErrorAt: new Date(),
      },
      { new: true }
    );

    if (session) {
      // Emit status change event
      this.eventsService.emitStatusChange(sessionId, session.userId.toString(), SessionStatus.DISCONNECTED);
    }

    this.clients.delete(sessionId);
  }

  private async handleIncomingMessage(sessionId: string, message: any): Promise<void> {
    try {
      const session = await this.sessionModel.findOne({ sessionId });
      if (!session) return;

      // Check if message already exists
      const existingMessage = await this.messageModel.findOne({ 
        whatsappMessageId: message.id._serialized 
      });
      
      if (existingMessage) {
        this.logger.debug(`Skipping duplicate message: ${message.id._serialized}`);
        return;
      }

      // Get entity with path
      const entity = await this.entityService.findOne(session.entityId.toString(), null);
      if (!entity.entityIdPath || entity.entityIdPath.length === 0) {
        this.logger.warn(`Failed to get entity path for entity: ${session.entityId}`);
      }

      // Check if message is a reply
      let quotedMessage = null;
      if (message.hasQuotedMsg) {
        try {
          // Get the quoted message
          quotedMessage = await message.getQuotedMessage();
          this.logger.log(`Reply detected - Original message: ${quotedMessage.id._serialized} from ${quotedMessage.from}`);
        } catch (error) {
          this.logger.warn(`Failed to fetch quoted message: ${error.message}`);
        }
      }

      let mediaUrl = null;
      if (message.hasMedia) {
        mediaUrl = await this.handleMediaUpload(message);
      }

      // Check if sender is a registered user (external number detection)
      const cleanedPhoneNumber = this.cleanPhoneNumber(message.from);
      const registeredUser = await this.checkIfRegisteredUser(cleanedPhoneNumber, session.tenantId);
      const contactInfo = await this.getContactInfo(message);
      
      const isExternalNumber = !registeredUser;
      const externalSenderName = isExternalNumber ? contactInfo.name : null;
      const externalSenderPhone = isExternalNumber ? cleanedPhoneNumber : null;

      this.logger.log(`Message from ${cleanedPhoneNumber}: ${isExternalNumber ? 'EXTERNAL' : 'REGISTERED'} - ${contactInfo.name}`);

      const contact = await message.getContact();

      const fromPhoneNumber = this.cleanPhoneNumber(contact.number);
      const toPhoneNumber = this.getE164FromSession(sessionId);

      // Determine conversation ID - use group name if group, otherwise use phone number
      const conversationId = contactInfo.isGroup && contactInfo.groupName 
        ? `group-${contactInfo.groupName}` 
        : message.from;

      const messageData = {
        _id: new Types.ObjectId(),
        whatsappMessageId: message.id._serialized,
        from: message.from,
        to: message.to,
        fromPhoneNumber,
        toPhoneNumber,
        type: this.getMessageType(message.type),
        direction: MessageDirection.INBOUND,
        content: message.body || '',
        mediaUrl,
        status: MessageStatus.DELIVERED,
        sentAt: new Date(message.timestamp * 1000),
        deliveredAt: new Date(),
        conversationId: conversationId,
        entityId: session.entityId,
        entityIdPath: entity.entityIdPath,
        tenantId: session.tenantId,
        // External number detection fields
        isExternalNumber,
        externalSenderName,
        externalSenderPhone,
        // WhatsApp contact information
        whatsappAvatarUrl: contactInfo.avatarUrl,
        whatsappUsername: contactInfo.username || contactInfo.name,
        whatsappGroupName: contactInfo.groupName,
        isGroupMessage: contactInfo.isGroup || false,
        userId: registeredUser ? registeredUser._id : null,
        metadata: {
          hasMedia: message.hasMedia,
          isForwarded: message.isForwarded,
          isStarred: message.isStarred,
          mediaType: message.type,
          caption: message.caption,
          // Add reply metadata
          isReply: message.hasQuotedMsg,
          quotedMessageId: quotedMessage?.id?._serialized,
          quotedMessageFrom: quotedMessage?.from,
          quotedMessageBody: quotedMessage?.body,
          // External number metadata
          senderContactName: contactInfo.name,
          senderContactPhone: contactInfo.phone,
          isExternalSender: isExternalNumber,
          registeredUserInfo: registeredUser ? {
            firstName: registeredUser.firstName,
            lastName: registeredUser.lastName,
            email: registeredUser.email,
            role: registeredUser.role
          } : null,
        },
      };

      await this.messageModel.create(messageData);
      
      // Update session statistics
      await this.sessionModel.findOneAndUpdate(
        { sessionId },
        {
          $inc: { messagesReceived: 1 },
          lastActivityAt: new Date(),
        },
      );

      this.logger.log(`Incoming message saved: ${message.id._serialized}`);
    } catch (error) {
      this.logger.error(`Failed to handle incoming message: ${error.message}`, error);
    }
  }

  private async handleOutgoingMessage(sessionId: string, message: any): Promise<void> {
    try {
      const session = await this.sessionModel.findOne({ sessionId });
      if (!session) return;

      // Check if message already exists
      const existingMessage = await this.messageModel.findOne({ 
        whatsappMessageId: message.id._serialized 
      });
      
      if (existingMessage) {
        this.logger.debug(`Skipping duplicate message: ${message.id._serialized}`);
        return;
      }

      // Get entity with path
      const entity = await this.entityService.findOne(session.entityId.toString(), null);
      if (!entity.entityIdPath || entity.entityIdPath.length === 0) {
        this.logger.warn(`Failed to get entity path for entity: ${session.entityId}`);
      }

      let mediaUrl = null;
      if (message.hasMedia) {
        mediaUrl = await this.handleMediaUpload(message);
      }

      // Get contact info for recipient
      const contactInfo = await this.getContactInfo(message);
      
      const fromPhoneNumber = this.getE164FromSession(sessionId);
      const toPhoneNumber = message.to;

      // Determine conversation ID
      const conversationId = contactInfo.isGroup && contactInfo.groupName 
        ? `group-${contactInfo.groupName}` 
        : message.to;

      const messageData = {
        _id: new Types.ObjectId(),
        whatsappMessageId: message.id._serialized,
        from: message.from,
        to: message.to,
        fromPhoneNumber,
        toPhoneNumber,
        type: this.getMessageType(message.type),
        direction: MessageDirection.OUTBOUND,
        content: message.body || '',
        mediaUrl,
        status: MessageStatus.SENT,
        sentAt: new Date(message.timestamp * 1000),
        conversationId: conversationId,
        entityId: session.entityId,
        entityIdPath: entity.entityIdPath,
        tenantId: session.tenantId,
        // WhatsApp contact information
        whatsappAvatarUrl: contactInfo.avatarUrl,
        whatsappUsername: contactInfo.username || contactInfo.name,
        whatsappGroupName: contactInfo.groupName,
        isGroupMessage: contactInfo.isGroup || false,
        metadata: {
          hasMedia: message.hasMedia,
          isForwarded: message.isForwarded,
          isStarred: message.isStarred,
          mediaType: message.type,
          caption: message.caption,
        },
      };

      await this.messageModel.create(messageData);
      
      // Update session statistics
      await this.sessionModel.findOneAndUpdate(
        { sessionId },
        {
          $inc: { messagesSent: 1 },
          lastActivityAt: new Date(),
        },
      );

      this.logger.log(`Outgoing message saved: ${message.id._serialized}`);
    } catch (error) {
      this.logger.error(`Failed to handle outgoing message: ${error.message}`, error);
    }
  }

  private async handleMediaUpload(message: any): Promise<string | null> {
    try {
      const media = await message.downloadMedia();
      if (!media) return null;

      const { data, mimetype, filename } = media;
      const extension = mimetype.split('/')[1];
      const fileName = `${message.id._serialized}.${extension}`;

      // Convert base64 to buffer
      const buffer = Buffer.from(data, 'base64');

      // Upload to cloud storage using StorageService
      const uploadResult = await this.storageService.uploadFile(
        buffer,
        fileName,
        mimetype,
        'whatsapp-media',
      );

      this.logger.log(`Media uploaded to cloud storage: ${uploadResult.url}`);
      // Return proxy URL instead of direct cloud storage URL
      return uploadResult.proxyUrl;
    } catch (error) {
      this.logger.error(`Failed to upload media: ${error.message}`, error);
      return null;
    }
  }

  private async handleMessageAck(sessionId: string, message: any, ack: number): Promise<void> {
    try {
      const statusMap = new Map<number, MessageStatus>([
        [0, MessageStatus.PENDING],
        [1, MessageStatus.SENT],
        [2, MessageStatus.DELIVERED],
        [3, MessageStatus.READ],
        [-1, MessageStatus.FAILED],
      ]);

      const status = statusMap.get(ack) || MessageStatus.PENDING;
      const updateData: any = { status };

      if (status === MessageStatus.SENT) updateData.sentAt = new Date();
      if (status === MessageStatus.DELIVERED) updateData.deliveredAt = new Date();
      if (status === MessageStatus.READ) updateData.readAt = new Date();
      if (status === MessageStatus.FAILED) updateData.failedAt = new Date();

      await this.messageModel.findOneAndUpdate(
        { whatsappMessageId: message.id._serialized },
        updateData,
      );

      // Update session statistics
      if (status === MessageStatus.DELIVERED) {
        await this.sessionModel.findOneAndUpdate(
          { sessionId },
          { $inc: { messagesDelivered: 1 } },
        );
      } else if (status === MessageStatus.FAILED) {
        await this.sessionModel.findOneAndUpdate(
          { sessionId },
          { $inc: { messagesFailed: 1 } },
        );
      }
    } catch (error) {
      this.logger.error(`Failed to handle message ack: ${error.message}`, error);
    }
  }

  private getMessageType(type: string): MessageType {
    const typeMap: Record<string, MessageType> = {
      'chat': MessageType.TEXT,
      'image': MessageType.IMAGE,
      'video': MessageType.VIDEO,
      'audio': MessageType.AUDIO,
      'ptt': MessageType.AUDIO,
      'document': MessageType.DOCUMENT,
      'location': MessageType.LOCATION,
      'vcard': MessageType.CONTACT,
      'sticker': MessageType.STICKER,
    };
    return typeMap[type] || MessageType.TEXT;
  }

  // async sendMediaMessage(
  //   sessionId: string,
  //   to: string,
  //   message: string,
  //   mediaBuffer: Buffer,
  //   contentType: string,
  //   mediaType: 'image' | 'video' | 'audio' | 'document',
  //   userId: string,
  // ): Promise<Message> {
  //   const client = this.clients.get(sessionId);
  //   if (!client) {
  //     throw new Error(`No active client for session: ${sessionId}`);
  //   }

  //   const session = await this.sessionModel.findOne({ sessionId });
  //   if (!session) {
  //     throw new Error(`Session not found: ${sessionId}`);
  //   }

  //   try {
  //     // Create MessageMedia from buffer
  //     const media = new MessageMedia(contentType, mediaBuffer.toString('base64'));
      
  //     // Send message with media
  //     const sentMessage = await client.sendMessage(to, media, { caption: message });
      
  //     // Get entity with path
  //     const entity = await this.entityService.findOne(session.entityId.toString(), null);
  //     if (!entity.entityIdPath || entity.entityIdPath.length === 0) {
  //       this.logger.warn(`Failed to get entity path for entity: ${session.entityId}`);
  //     }

  //     // Create message record
  //     const fromPhoneNumber = await this.getE164FromSession(sessionId);
  //     const toPhoneNumber = this.cleanPhoneNumber(to);

  //     const messageData = await this.messageModel.create({
  //       whatsappMessageId: sentMessage.id._serialized,
  //       sessionId: session._id,
  //       entityId: session.entityId,
  //       entityIdPath: entity.entityIdPath || [],
  //       direction: MessageDirection.OUTBOUND,
  //       from: session.phoneNumber,
  //       to: to,
  //       fromPhoneNumber,
  //       toPhoneNumber,
  //       content: message,
  //       messageType: this.getMessageType(mediaType),
  //       status: MessageStatus.SENT,
  //       mediaUrl: null, // Will be set by storage service
  //       metadata: {
  //         mediaType,
  //         contentType,
  //         size: mediaBuffer.length,
  //       },
  //       timestamp: new Date(),
  //       userId: new Types.ObjectId(userId),
  //       tenantId: session.tenantId,
  //     });

  //     this.logger.log(`Media message sent successfully: ${sentMessage.id._serialized}`);
  //     return messageData;
  //   } catch (error) {
  //     this.logger.error(`Failed to send media message: ${error.message}`);
  //     throw error;
  //   }
  // }

  // async sendMessage(
  //   sessionId: string, 
  //   to: string, 
  //   content: string | MessageMedia, 
  //   userId: string,
  //   options: { caption?: string } = {},
  //   retryCount: number = 0
  // ): Promise<Message> {
  //   const client = this.clients.get(sessionId);
  //   if (!client) {
  //     throw new Error(`No active client for session: ${sessionId}`);
  //   }

  //   const session = await this.sessionModel.findOne({ sessionId });
  //   if (!session) {
  //     throw new Error(`Session not found: ${sessionId}`);
  //   }

  //   try {
  //     let sentMessage;
  //     let messageType = MessageType.TEXT;
  //     let mediaUrl = null;

  //     if (typeof content === 'string') {
  //       // Text message
  //       sentMessage = await client.sendMessage(to, content);
  //     } else {
  //       // Media message
  //       sentMessage = await client.sendMessage(to, content, { caption: options.caption });
  //       messageType = this.getMessageType(content.mimetype.split('/')[0]);
        
  //       // Upload media to cloud storage using StorageService
  //       const extension = content.mimetype.split('/')[1];
  //       const fileName = `${sentMessage.id._serialized}.${extension}`;
        
  //       const buffer = Buffer.from(content.data, 'base64');
  //       const uploadResult = await this.storageService.uploadFile(
  //         buffer,
  //         fileName,
  //         content.mimetype,
  //         'whatsapp-media',
  //       );
        
  //       mediaUrl = uploadResult.proxyUrl;
  //     }

  //     // Get entity with path
  //     const entity = await this.entityService.findOne(session.entityId.toString(), null);
  //     if (!entity.entityIdPath || entity.entityIdPath.length === 0) {
  //       this.logger.warn(`Failed to get entity path for entity: ${session.entityId}`);
  //     }

  //     const fromPhoneNumber = await this.getE164FromSession(sessionId);
  //     const toPhoneNumber = this.cleanPhoneNumber(to);

  //     const messageData = await this.messageModel.create({
  //       whatsappMessageId: sentMessage.id._serialized,
  //       from: session.phoneNumber,
  //       to,
  //       fromPhoneNumber,
  //       toPhoneNumber,
  //       type: messageType,
  //       direction: MessageDirection.OUTBOUND,
  //       content: typeof content === 'string' ? content : options.caption || '',
  //       mediaUrl,
  //       status: MessageStatus.SENT,
  //       sentAt: new Date(),
  //       conversationId: to,
  //       entityId: session.entityId,
  //       entityIdPath: entity.entityIdPath,
  //       tenantId: session.tenantId,
  //       createdBy: userId,
  //       metadata: {
  //         hasMedia: mediaUrl !== null,
  //         mediaType: typeof content === 'string' ? null : content.mimetype,
  //         caption: options.caption,
  //       },
  //     });

  //     // Update session statistics
  //     await this.sessionModel.findOneAndUpdate(
  //       { sessionId },
  //       {
  //         $inc: { messagesSent: 1 },
  //         lastActivityAt: new Date(),
  //       },
  //     );

  //     this.logger.log(`Message sent successfully: ${sentMessage.id._serialized}`);
  //     return messageData;
  //   } catch (error) {
  //     this.logger.error(`Failed to send message: ${error.message}`, error);
      
  //     // Send to DLQ for retry if not already from DLQ
  //     if (retryCount === 0) {
  //       await this.dlqService.sendToDLQ(
  //         {
  //           sessionId,
  //           to,
  //           content,
  //           userId,
  //           options,
  //         },
  //         error,
  //         {
  //           topic: 'whatsapp-messages',
  //           subscription: 'message-retry',
  //           maxRetries: 5,
  //           retryDelay: 300000, // 5 minutes
  //         }
  //       );
  //     }
      
  //     throw error;
  //   }
  // }

  async getQRCode(sessionId: string): Promise<{ qrCode: string; expiresAt: Date } | null> {
    const session = await this.sessionModel.findOne({ sessionId });
    if (!session || !session.qrCode) {
      return null;
    }

      // Return the raw base64 string - frontend will add data:image/png;base64, prefix
      return {
        qrCode: session.qrCode,
        expiresAt: session.qrCodeExpiresAt,
      };
  }

  async getSessionStatus(sessionId: string): Promise<any> {
    const session = await this.sessionModel.findOne({ sessionId });
    if (!session) {
      throw new Error('Session not found');
    }

    // Get health check status
    let healthStatus = this.healthChecks.get(sessionId);
    if (!healthStatus) {
      healthStatus = {
        lastCheck: new Date(),
        lastStatus: 'success',
        consecutiveFailures: 0,
        successRate: 100,
        recentChecks: 0,
        alertTriggered: false,
      };
      this.healthChecks.set(sessionId, healthStatus);
    }

    // Check current status
    const client = this.clients.get(sessionId);
    if (client) {
      try {
        const state = await client.getState();
        if (state === 'CONNECTED') {
          healthStatus.lastStatus = 'success';
          healthStatus.consecutiveFailures = 0;
        } else {
          healthStatus.lastStatus = 'failed';
          healthStatus.consecutiveFailures++;
        }
        healthStatus.lastCheck = new Date();
        healthStatus.recentChecks++;
        healthStatus.successRate = ((healthStatus.recentChecks - healthStatus.consecutiveFailures) / healthStatus.recentChecks) * 100;
        healthStatus.alertTriggered = healthStatus.consecutiveFailures >= 3;
        this.healthChecks.set(sessionId, healthStatus);
      } catch (error) {
        this.logger.error(`Failed to get client state: ${error.message}`);
        healthStatus.lastStatus = 'failed';
        healthStatus.consecutiveFailures++;
        healthStatus.lastCheck = new Date();
        healthStatus.recentChecks++;
        healthStatus.successRate = ((healthStatus.recentChecks - healthStatus.consecutiveFailures) / healthStatus.recentChecks) * 100;
        healthStatus.alertTriggered = healthStatus.consecutiveFailures >= 3;
        this.healthChecks.set(sessionId, healthStatus);
      }
    }

    return {
      ...session.toObject(),
      healthStatus,
    };
  }

  private async cleanupSessionFiles(sessionId: string, maxRetries = 5, retryDelay = 2000): Promise<void> {
    const authPath = process.env.WEBJS_AUTH_PATH || `${process.cwd()}/.wwebjs_auth`;
    const sessionPath = `${authPath}/session-${sessionId}`;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (!fsSync.existsSync(sessionPath)) {
          return;
        }

        // List all files in the session directory
        const files = await fs.readdir(sessionPath);
        
        // Close any open file handles (Windows-specific)
        if (process.platform === 'win32') {
          try {
            // Force garbage collection to release file handles
            if (global.gc) {
              global.gc();
            }
          } catch (error) {
            this.logger.debug('Manual GC not available');
          }
        }

        // Delete files one by one
        for (const file of files) {
          const filePath = `${sessionPath}/${file}`;
          try {
            await fs.unlink(filePath);
          } catch (error) {
            this.logger.warn(`Failed to delete file ${file}: ${error.message}`);
          }
        }

        // Remove the empty directory
        await fs.rmdir(sessionPath);
        this.logger.log(`Successfully cleaned up session files for ${sessionId} on attempt ${attempt}`);
        return;
      } catch (error) {
        if (attempt === maxRetries) {
          this.logger.error(`Failed to clean up session files after ${maxRetries} attempts: ${error.message}`);
          throw error;
        }
        this.logger.warn(`Cleanup attempt ${attempt} failed, retrying in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  async disconnectSession(sessionId: string): Promise<void> {
    try {
      const client = this.clients.get(sessionId);
      if (client) {
        // First try to close the session gracefully
        try {
          // Disconnect from WhatsApp
          await client.logout();
          this.logger.log(`Successfully logged out WhatsApp client for session ${sessionId}`);
        } catch (error) {
          this.logger.warn(`Failed to logout client for session ${sessionId}: ${error.message}`);
        }

        // Wait for resources to be released
        await new Promise(resolve => setTimeout(resolve, 3000));

        try {
          // Close browser and cleanup Puppeteer
          await client.destroy();
          this.logger.log(`Successfully destroyed WhatsApp client for session ${sessionId}`);
        } catch (error) {
          this.logger.warn(`Failed to destroy client for session ${sessionId}: ${error.message}`);
        }

        // Remove from active clients map
        this.clients.delete(sessionId);

        // Wait for browser processes to fully terminate
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Clean up session files with retries
        // await this.cleanupSessionFiles(sessionId);
      }

      try {
        await this.sessionModel.findOneAndUpdate(
          { sessionId },
          { 
            status: SessionStatus.DISCONNECTED,
            disconnectedAt: new Date(),
            qrCode: null,
            qrCodeGeneratedAt: null,
            qrCodeExpiresAt: null
          }
        );

        this.logger.log(`Session disconnected successfully: ${sessionId}`);
      } catch (dbError) {
        this.logger.error(`Failed to update session status: ${dbError.message}`);
      }
    } catch (error) {
      // Even if cleanup fails, ensure session is marked as disconnected
      try {
        await this.sessionModel.findOneAndUpdate(
          { sessionId },
          { 
            status: SessionStatus.DISCONNECTED,
            disconnectedAt: new Date(),
            lastError: error.message,
            lastErrorAt: new Date()
          }
        );
      } catch (dbError) {
        this.logger.error(`Failed to update session status: ${dbError.message}`);
      }

      // Remove from clients map even if cleanup failed
      this.clients.delete(sessionId);

      this.logger.error(`Error during session disconnect for ${sessionId}:`, error);
      throw error;
    }
  }

  private async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
    await this.sessionModel.findOneAndUpdate(
      { sessionId },
      { status, lastActivityAt: new Date() },
    );
  }

  private async reconnectActiveSessions(): Promise<void> {
    const activeSessions = await this.sessionModel.find({
      status: { $in: [SessionStatus.READY, SessionStatus.AUTHENTICATED] },
      isActive: true,
    });

    for (const session of activeSessions) {
      try {
        this.logger.log(`Reconnecting session: ${session.sessionId}`);
        await this.initializeClient(session.sessionId);
      } catch (error) {
        this.logger.error(`Failed to reconnect session: ${session.sessionId}`, error);
      }
    }
  }

  async getMessages(filters: any): Promise<{ messages: Message[], total: number, page: number, limit: number, totalPages: number }> {
    const query: any = { isActive: true };

    if (filters?.tenantId) query.tenantId = new Types.ObjectId(filters.tenantId);
    if (filters?.entityId) {
      const entityId = new Types.ObjectId(filters.entityId);
      // Check if the entity ID is in the entityIdPath array
      query.entityIdPath = entityId;
    }
    if (filters?.userId) query.userId = new Types.ObjectId(filters.userId);
    if (filters?.direction) query.direction = filters.direction;
    if (filters?.status) query.status = filters.status;
    if (filters?.type) query.type = filters.type;
    // Phone number search (E164 format)
    if (filters?.phoneNumber) {
      const cleanedNumber = this.cleanPhoneNumber(filters.phoneNumber);
      query.$or = [
        { fromPhoneNumber: cleanedNumber },
        { toPhoneNumber: cleanedNumber },
        { externalSenderPhone: cleanedNumber }
      ];
    }

    // Specific from/to filters
    if (filters?.from) query.fromPhoneNumber = this.cleanPhoneNumber(filters.from);
    if (filters?.to) query.toPhoneNumber = this.cleanPhoneNumber(filters.to);
    if (filters?.conversationId) query.conversationId = filters.conversationId;
    if (filters?.isExternal !== undefined) query.isExternalNumber = filters.isExternal === 'true';

    // Message content search
    if (filters?.messageContent) {
      query.content = { $regex: this.escapeRegExp(filters.messageContent), $options: 'i' };
    }

    if (filters?.startDate || filters?.endDate) {
      query.createdAt = {};
      if (filters.startDate) query.createdAt.$gte = new Date(filters.startDate);
      if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
    }

    // Pagination
    const page = parseInt(filters?.page) || 1;
    const limit = parseInt(filters?.limit) || 20;
    const skip = (page - 1) * limit;

    const total = await this.messageModel.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

    const messages = await this.messageModel
      .find(query)
      .populate('userId', 'firstName lastName email phoneNumber')
      .populate('entityId', 'name path type')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Fetch reply messages for messages that have replyToMessageId
    const messagesWithReplies = await Promise.all(messages.map(async (msg) => {
      const msgObj = msg.toObject();
      if (msgObj.metadata?.quotedMessageId) {
        const replyToMessage = await this.messageModel.findOne({ 
          whatsappMessageId: msgObj.metadata.quotedMessageId 
        });
        if (replyToMessage) {
          msgObj.replyToMessage = {
            id: replyToMessage._id,
            content: replyToMessage.content,
            type: replyToMessage.type,
            mediaUrl: replyToMessage.mediaUrl,
            from: replyToMessage.from,
            senderName: replyToMessage.metadata?.senderContactName || replyToMessage.from
          };
          msgObj.replyToMessageId = replyToMessage._id;
        }
      }
      return msgObj;
    }));

    // Enhance messages with external tag information
    const enhancedMessages = messagesWithReplies.map(msg => ({
      ...msg,
      // Add external tag for frontend
      tags: msg.isExternalNumber ? ['External'] : [],
      // Add display information
      displayName: msg.externalSenderName || msg.metadata?.senderContactName || 'Unknown',
      displayPhone: msg.externalSenderPhone || msg.from,
    }));

    return {
      messages: enhancedMessages as any,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async getConversations(tenantId: string): Promise<any[]> {
    // Build match query - only include tenantId if provided (SystemAdmin has no tenantId)
    const matchQuery: any = { isActive: true };
    if (tenantId && tenantId !== '') {
      matchQuery.tenantId = new Types.ObjectId(tenantId);
    }

    const conversations = await this.messageModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$conversationId',
          lastMessage: { $last: '$content' },
          lastMessageAt: { $last: '$sentAt' },
          lastMessageType: { $last: '$type' },
          totalMessages: { $sum: 1 },
          unreadCount: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$direction', MessageDirection.INBOUND] }, { $ne: ['$status', MessageStatus.READ] }] },
                1,
                0,
              ],
            },
          },
          // Add external number detection
          isExternalNumber: { $last: '$isExternalNumber' },
          externalSenderName: { $last: '$externalSenderName' },
          externalSenderPhone: { $last: '$externalSenderPhone' },
          // Get WhatsApp contact info from the most recent message
          whatsappAvatarUrl: { $last: '$whatsappAvatarUrl' },
          whatsappUsername: { $last: '$whatsappUsername' },
          whatsappGroupName: { $last: '$whatsappGroupName' },
          isGroupMessage: { $last: '$isGroupMessage' },
          contactName: { $last: '$metadata.senderContactName' },
          contactPhone: { $last: '$metadata.senderContactPhone' },
          fromPhoneNumber: { $last: '$fromPhoneNumber' },
          toPhoneNumber: { $last: '$toPhoneNumber' },
          direction: { $last: '$direction' },
        },
      },
      { $sort: { lastMessageAt: -1 } },
    ]);

    // Enhance conversation data with display information
    const enhancedConversations = conversations.map(conv => {
      // Determine display name - prefer group name, then WhatsApp username, then external sender name, then contact name
      let displayName = conv.whatsappGroupName || 
                       conv.whatsappUsername || 
                       conv.externalSenderName || 
                       conv.contactName || 
                       'Unknown';
      
      // For groups, show group name
      if (conv.isGroupMessage && conv.whatsappGroupName) {
        displayName = conv.whatsappGroupName;
      }
      
      // Determine display phone
      const displayPhone = conv.isGroupMessage ? null : 
                          (conv.externalSenderPhone || conv.contactPhone || conv.fromPhoneNumber || conv._id);

      return {
        ...conv,
        conversationId: conv._id,
        // Determine if this conversation is with an external number
        isExternal: conv.isExternalNumber || false,
        // Display information
        displayName,
        displayPhone,
        avatarUrl: conv.whatsappAvatarUrl || null,
        // Add external tag for frontend
        tags: conv.isExternalNumber ? ['External'] : [],
      };
    });

    return enhancedConversations;
  }

  /**
   * Check if a phone number belongs to a registered user
   * @param phoneNumber E164 formatted phone number
   * @param tenantId Tenant ID to check within
   * @returns User document if registered, null if external
   */
  private async checkIfRegisteredUser(phoneNumber: string, tenantId: Types.ObjectId): Promise<any> {
    try {
      // Find user by phone number within the tenant
      const user = await this.userModel.findOne({
        phoneNumber: phoneNumber,
        tenantId: tenantId,
        isActive: true,
        registrationStatus: { $in: ['registered', 'invited'] }
      }).select('firstName lastName email phoneNumber role');

      return user;
    } catch (error) {
      this.logger.error(`Error checking registered user for ${phoneNumber}:`, error);
      return null;
    }
  }

  /**
   * Extract contact information from WhatsApp message
   * @param message WhatsApp message object
   * @returns Contact info object with avatar, username, and group info
   */
  private async getContactInfo(message: any): Promise<{ 
    name: string; 
    phone: string; 
    avatarUrl?: string; 
    username?: string;
    groupName?: string;
    isGroup?: boolean;
  }> {
    try {
      // Try to get contact info from WhatsApp
      const contact = await message.getContact();
      const name = contact.pushname || contact.name || contact.shortName || '';
      const phone = contact.number || message.from;
      
      // Get profile picture URL
      let avatarUrl = null;
      try {
        const profilePicUrl = await contact.getProfilePicUrl();
        avatarUrl = profilePicUrl || null;
      } catch (error) {
        // Profile picture not available
        this.logger.debug(`No profile picture for ${phone}`);
      }

      // Check if message is from a group
      let groupName = null;
      let isGroup = false;
      try {
        if (message.from.includes('@g.us')) {
          isGroup = true;
          const chat = await message.getChat();
          groupName = chat.name || null;
        }
      } catch (error) {
        this.logger.debug(`Not a group message or failed to get group info: ${error.message}`);
      }
      
      return {
        name: name.trim() || 'Unknown',
        phone: phone,
        avatarUrl: avatarUrl || undefined,
        username: name.trim() || undefined,
        groupName: groupName || undefined,
        isGroup: isGroup
      };
    } catch (error) {
      this.logger.warn(`Failed to get contact info for ${message.from}:`, error);
      return {
        name: 'Unknown',
        phone: message.from
      };
    }
  }

  /**
   * Clean and format phone number to E164 format
   * @param phoneNumber Raw phone number
   * @returns Cleaned E164 phone number
   */
  /**
   * Escape special characters in a string for use in a regular expression
   */
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Convert sessionId to E164 phone number
   * @param sessionId WhatsApp session ID
   * @returns E164 formatted phone number or null if session not found
   */
  private getE164FromSession(sessionId: string): string {
    try {
      const e164 = sessionId.replace("whatsapp-", "+");
      return this.cleanPhoneNumber(e164);
    } catch (error) {
      this.logger.error(`Failed to get E164 from session ${sessionId}:`, error);
      return null;
    }
  }

  private cleanPhoneNumber(phoneNumber: string): string {
    // Remove any non-digit characters except +
    let cleaned = phoneNumber.replace(/[^\d+]/g, '');
    
    // If it doesn't start with +, assume it needs country code
    if (!cleaned.startsWith('+')) {
      // This is a simplified approach - in production you might want to use a library like libphonenumber
      // For now, we'll just return the original number
      cleaned = '+' + cleaned;
    }
    
    return cleaned;
  }

  /**
   * Process failed messages from DLQ
   */
  async processMessageDLQ(): Promise<void> {
    await this.dlqService.processDLQ(
      'whatsapp-messages',
      'message-retry',
      async (message) => {
        const { sessionId, to, content, userId, options } = message;
        // Retry sending the message with incremented retry count
        // await this.sendMessage(sessionId, to, content, userId, options, (message.retryCount || 0) + 1);
      }
    );
  }
}