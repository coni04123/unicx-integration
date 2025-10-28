import { Module, forwardRef } from '@nestjs/common';
import { DLQModule } from '../dlq/dlq.module';
import { MongooseModule } from '@nestjs/mongoose';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppHealthCheckService } from './whatsapp-health-check.service';
import { WhatsAppEventsService } from './whatsapp-events.service';
import { WhatsAppSession, WhatsAppSessionSchema } from '../../common/schemas/whatsapp-session.schema';
import { Message, MessageSchema } from '../../common/schemas/message.schema';
import { User, UserSchema } from '../../common/schemas/user.schema';
import { WhatsAppHealthCheck, WhatsAppHealthCheckSchema } from '../../common/schemas/whatsapp-health-check.schema';
import { Alert, AlertSchema } from '../../common/schemas/alert.schema';
import { UsersModule } from '../users/users.module';
import { EntitiesModule } from '../entities/entities.module';
import { StorageModule } from '../storage/storage.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WhatsAppSession.name, schema: WhatsAppSessionSchema },
      { name: Message.name, schema: MessageSchema },
      { name: User.name, schema: UserSchema },
      { name: WhatsAppHealthCheck.name, schema: WhatsAppHealthCheckSchema },
      { name: Alert.name, schema: AlertSchema },
    ]),
    forwardRef(() => UsersModule),
    forwardRef(() => EntitiesModule),
    StorageModule,
    DLQModule,
    EmailModule,
  ],
  controllers: [WhatsAppController],
  providers: [WhatsAppService, WhatsAppHealthCheckService, WhatsAppEventsService],
  exports: [WhatsAppService, WhatsAppHealthCheckService, WhatsAppEventsService],
})
export class WhatsAppModule {}

