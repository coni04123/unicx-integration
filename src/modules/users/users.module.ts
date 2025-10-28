import { Module, forwardRef } from '@nestjs/common';
import { DLQModule } from '../dlq/dlq.module';
import { DatabaseModule } from '../../common/database/database.module';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [
    DatabaseModule, 
    AuthModule, 
    EmailModule,
    forwardRef(() => WhatsAppModule),
    DLQModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
