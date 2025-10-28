import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Request, UseInterceptors, UploadedFile, Sse, MessageEvent } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiConsumes } from '@nestjs/swagger';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppEventsService } from './whatsapp-events.service';
import { StorageService } from '../storage/storage.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequireTenant } from '../auth/decorators';
import { UserRole } from '../../common/schemas/user.schema';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SYSTEM_ENTITY_ID } from '@/common/constants/system-entity';
import { Audit } from '../../common/decorators/audit.decorator';
import { AuditAction, AuditResource } from '../../common/schemas/audit-log.schema';

@ApiTags('WhatsApp')
@Controller('whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class WhatsAppController {
  constructor(
    private readonly whatsappService: WhatsAppService,
    private readonly whatsappEventsService: WhatsAppEventsService,
    private readonly storageService: StorageService,
  ) {}

  @Post('sessions')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN)
  @RequireTenant()
  @Audit({ action: AuditAction.SESSION_CREATE, resource: AuditResource.WHATSAPP_SESSION })
  @ApiOperation({ summary: 'Create new WhatsApp session and generate QR code' })
  @ApiResponse({ status: 201, description: 'Session created successfully' })
  async createSession(@Request() req) {
    const sessionId = `${req.user.tenantId}_${req.user.sub}_${Date.now()}`;
    return this.whatsappService.createSession(
      sessionId,
      req.user.sub,
      req.user.email,
      req.user.entityId,
      req.user.tenantId,
    );
  }

  @Get('sessions/:sessionId/qr')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Get QR code for WhatsApp session' })
  @ApiResponse({ status: 200, description: 'QR code retrieved successfully' })
  @ApiResponse({ status: 404, description: 'QR code not available' })
  async getQRCode(@Param('sessionId') sessionId: string) {
    const qrData = await this.whatsappService.getQRCode(sessionId);
    if (!qrData) {
      return {
        success: false,
        message: 'QR code not available. Session may be connected or QR code has expired.',
      };
    }
    return {
      success: true,
      ...qrData,
    };
  }

  @Get('sessions/:sessionId/status')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Get WhatsApp session status' })
  @ApiResponse({ status: 200, description: 'Session status retrieved successfully' })
  async getSessionStatus(@Param('sessionId') sessionId: string) {
    return this.whatsappService.getSessionStatus(sessionId);
  }

  @Sse('events')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Subscribe to WhatsApp events' })
  @ApiResponse({ status: 200, description: 'Event stream established' })
  events(@Request() req): Observable<MessageEvent> {
    const userId = req.user.id;
    return this.whatsappEventsService.subscribe(userId).pipe(
      map(event => ({
        data: event,
        id: new Date().getTime().toString(),
        type: 'whatsapp-event',
        retry: 15000
      }))
    );
  }

  @Delete('sessions/:sessionId')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN)
  @Audit({ action: AuditAction.SESSION_DELETE, resource: AuditResource.WHATSAPP_SESSION })
  @ApiOperation({ summary: 'Disconnect WhatsApp session' })
  @ApiResponse({ status: 200, description: 'Session disconnected successfully' })
  async disconnectSession(@Param('sessionId') sessionId: string) {
    await this.whatsappService.disconnectSession(sessionId);
    return {
      success: true,
      message: 'Session disconnected successfully',
    };
  }

  // @Post('messages/send')
  // @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN)
  // @RequireTenant()
  // @Audit({ action: AuditAction.MESSAGE_SEND, resource: AuditResource.MESSAGE })
  // @ApiOperation({ summary: 'Send WhatsApp message' })
  // @ApiResponse({ status: 200, description: 'Message sent successfully' })
  // async sendMessage(
  //   @Body() body: { sessionId: string; to: string; message: string },
  //   @Request() req,
  // ) {
  //   return this.whatsappService.sendMessage(
  //     body.sessionId,
  //     body.to,
  //     body.message,
  //     req.user.sub,
  //   );
  // }

  @Get('messages')
  @RequireTenant()
  @ApiOperation({ summary: 'Get WhatsApp messages with pagination and filters. Messages from unregistered numbers include "External" tag.' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page' })
  @ApiQuery({ name: 'direction', required: false, description: 'Message direction (inbound/outbound)' })
  @ApiQuery({ name: 'status', required: false, description: 'Message status' })
  @ApiQuery({ name: 'type', required: false, description: 'Message type' })
  @ApiQuery({ name: 'phoneNumber', required: false, description: 'Search by E164 phone number (searches in from, to, and externalSenderPhone)' })
  @ApiQuery({ name: 'from', required: false, description: 'Filter by exact from phone number' })
  @ApiQuery({ name: 'to', required: false, description: 'Filter by exact to phone number' })
  @ApiQuery({ name: 'messageContent', required: false, description: 'Search in message content' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date filter' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date filter' })
  @ApiQuery({ name: 'isExternal', required: false, description: 'Filter by external numbers (true/false)' })
  @ApiResponse({ status: 200, description: 'Messages retrieved successfully with pagination. External messages include tags: ["External"]' })
  async getMessages(@Query() query: any, @Request() req) {
    const filters = {
      ...query,
    };

    console.log(filters);

    if (query.entityId || req.user.entityId !== SYSTEM_ENTITY_ID.toString()) {
      filters.entityId = query.entityId || req.user.entityId;
    }

    return this.whatsappService.getMessages(filters);
  }

  @Get('messages/external')
  @RequireTenant()
  @ApiOperation({ summary: 'Get messages from external (unregistered) numbers only' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page' })
  @ApiQuery({ name: 'search', required: false, description: 'Search in message content' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date filter' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date filter' })
  @ApiResponse({ status: 200, description: 'External messages retrieved successfully' })
  async getExternalMessages(@Query() query: any, @Request() req) {
    const filters = {
      ...query,
      isExternal: 'true', // Force external filter
    };

    if (query.entityId || req.user.entityId !== SYSTEM_ENTITY_ID.toString()) {
      filters.entityId = query.entityId || req.user.entityId;
    }

    return this.whatsappService.getMessages(filters);
  }

  @Get('conversations')
  @RequireTenant()
  @ApiOperation({ summary: 'Get list of conversations. Conversations with unregistered numbers include "External" tag.' })
  @ApiResponse({ status: 200, description: 'Conversations retrieved successfully. External conversations include tags: ["External"]' })
  async getConversations(@Request() req) {
    return this.whatsappService.getConversations(req.user.tenantId);
  }

  @Post('upload-media')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN, UserRole.USER)
  @RequireTenant()
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload media file for WhatsApp' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Media file uploaded successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async uploadMedia(
    @UploadedFile() file: any,
    @Request() req,
  ) {
    if (!file) {
      throw new Error('No file provided');
    }

    // Upload to cloud storage
    const uploadResult = await this.storageService.uploadFile(
      file.buffer,
      file.originalname,
      file.mimetype,
      `whatsapp-media/${req.user.tenantId}`,
    );

    return {
      success: true,
      message: 'Media file uploaded successfully',
      data: {
        url: uploadResult.proxyUrl, // Use proxy URL instead of direct cloud storage URL
        originalUrl: uploadResult.url, // Keep original URL for reference
        key: uploadResult.key,
        size: uploadResult.size,
        contentType: uploadResult.contentType,
        fileName: file.originalname,
      },
    };
  }

  // @Post('send-media')
  // @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN)
  // @RequireTenant()
  // @ApiOperation({ summary: 'Send WhatsApp message with media attachment' })
  // @ApiResponse({ status: 200, description: 'Media message sent successfully' })
  // async sendMediaMessage(
  //   @Body() body: { 
  //     sessionId: string; 
  //     to: string; 
  //     message?: string; 
  //     mediaKey: string; 
  //     mediaType: 'image' | 'video' | 'audio' | 'document';
  //   },
  //   @Request() req,
  // ) {
  //   // Get media file from storage
  //   const mediaResult = await this.storageService.downloadFile(body.mediaKey);
    
  //   // Send message with media
  //   return this.whatsappService.sendMediaMessage(
  //     body.sessionId,
  //     body.to,
  //     body.message || '',
  //     mediaResult.buffer,
  //     mediaResult.contentType,
  //     body.mediaType,
  //     req.user.sub,
  //   );
  // }

  @Get('media/:key(*)')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN, UserRole.USER)
  @ApiOperation({ summary: 'Get media file from storage' })
  @ApiResponse({ status: 200, description: 'Media file retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Media file not found' })
  async getMedia(@Param('key') key: string) {
    const result = await this.storageService.downloadFile(key);
    
    return {
      buffer: result.buffer,
      contentType: result.contentType,
      size: result.size,
    };
  }

  @Get('media/:key(*)/url')
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.TENANT_ADMIN, UserRole.USER)
  @ApiOperation({ summary: 'Get signed URL for media file' })
  @ApiResponse({ status: 200, description: 'Signed URL generated successfully' })
  async getMediaUrl(
    @Param('key') key: string,
    @Query('expiresIn') expiresIn?: number,
  ) {
    const url = await this.storageService.getSignedUrl(key, expiresIn || 3600);
    
    return {
      url,
      expiresIn: expiresIn || 3600,
    };
  }
}

