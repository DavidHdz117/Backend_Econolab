import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { typeOrmConfig } from './config/typeorm.config';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { PatientsModule } from './patients/patients.module';
import { DoctorsModule } from './doctors/doctors.module';
import { StudiesModule } from './studies/studies.module';
import { ServicesModule } from './services/services.module';
import { ResultsModule } from './results/results.module';
import { HistoryModule } from './history/history.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { appConfig } from './config/app.config';
import { databaseConfig } from './config/database.config';
import { integrationsConfig } from './config/integrations.config';
import { labConfig } from './config/lab.config';
import { storageConfig } from './config/storage.config';
import { syncConfig } from './config/sync.config';
import { DatabaseModule } from './database/database.module';
import { RuntimeModule } from './runtime/runtime.module';
import { StorageModule } from './storage/storage.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        integrationsConfig,
        labConfig,
        storageConfig,
        syncConfig,
      ],
    }),
    RuntimeModule,
    StorageModule,
    DatabaseModule,
    SyncModule,
    TypeOrmModule.forRootAsync({
      useFactory: typeOrmConfig,
      inject: [ConfigService],
    }),
    UsersModule,
    MailModule,
    AuthModule,
    PatientsModule,
    DoctorsModule,
    StudiesModule,
    ServicesModule,
    ResultsModule,
    HistoryModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
