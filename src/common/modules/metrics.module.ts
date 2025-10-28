import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Metrics, MetricsSchema } from '../schemas/metrics.schema';
import { Message, MessageSchema } from '../schemas/message.schema';
import { WhatsAppSession, WhatsAppSessionSchema } from '../schemas/whatsapp-session.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { MetricsService } from '../services/metrics.service';
import { MetricsController } from '../controllers/metrics.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Metrics.name, schema: MetricsSchema },
      { name: Message.name, schema: MessageSchema },
      { name: WhatsAppSession.name, schema: WhatsAppSessionSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [MetricsService],
  controllers: [MetricsController],
  exports: [MetricsService],
})
export class MetricsModule {}
