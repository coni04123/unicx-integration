import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DLQService } from './dlq.service';
import { DLQMessage, DLQMessageSchema } from './schemas/dlq-message.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DLQMessage.name, schema: DLQMessageSchema },
    ]),
  ],
  providers: [DLQService],
  exports: [DLQService],
})
export class DLQModule {}
