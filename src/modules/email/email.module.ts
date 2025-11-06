import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { EmailEventConsumer } from './email-event.consumer';

@Module({
  imports: [ConfigModule],
  controllers: [EmailController],
  providers: [EmailService, EmailEventConsumer],
  exports: [EmailService],
})
export class EmailModule {}
