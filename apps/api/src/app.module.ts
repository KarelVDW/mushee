import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from './auth/auth.module';
import { CacheModule } from './cache/cache.module';
import { CronModule } from './cron/cron.module';
import { ScoresModule } from './scores/scores.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.POSTGRES_HOST ?? 'localhost',
      port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
      username: process.env.POSTGRES_USER ?? 'mushee',
      password: process.env.POSTGRES_PASSWORD ?? 'mushee',
      database: process.env.POSTGRES_DB ?? 'mushee',
      autoLoadEntities: true,
      synchronize: process.env.NODE_ENV !== 'production',
    }),
    MongooseModule.forRoot(
      process.env.MONGO_URI ?? 'mongodb://localhost:27017/mushee',
    ),
    ScheduleModule.forRoot(),
    AuthModule,
    ScoresModule,
    CacheModule,
    StorageModule,
    CronModule,
  ],
})
export class AppModule {}
