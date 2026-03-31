import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';

async function main() {
  process.env.DATABASE_TYPE ??= 'sqlite';
  process.env.APP_RUNTIME_MODE ??= 'desktop-offline';
  process.env.DATABASE_SYNCHRONIZE ??= 'false';
  process.env.DATABASE_LOGGING ??= 'false';
  process.env.DATABASE_SQLITE_PATH ??= resolve(
    process.cwd(),
    'tmp',
    'phase16-sqlite-service-folio.sqlite',
  );

  mkdirSync(dirname(process.env.DATABASE_SQLITE_PATH), { recursive: true });
  rmSync(process.env.DATABASE_SQLITE_PATH, { force: true });

  const { default: appDataSource } = await import('../src/database/typeorm.datasource');
  const { getAppRuntimeConfig } = await import('../src/config/app.config');
  const { getDatabaseRuntimeConfig } = await import(
    '../src/config/database.config'
  );
  const { getLabRuntimeConfig } = await import('../src/config/lab.config');
  const { DatabaseDialectService } = await import(
    '../src/database/database-dialect.service'
  );
  const { RuntimePolicyService } = await import(
    '../src/runtime/runtime-policy.service'
  );
  const { ServicesService } = await import('../src/services/services.service');
  const { Patient, PatientGender } = await import(
    '../src/patients/entities/patient.entity'
  );
  const { Study, StudyStatus, StudyType } = await import(
    '../src/studies/entities/study.entity'
  );
  const { ServiceItemPriceType, ServiceStatus } = await import(
    '../src/services/entities/service-order.entity'
  );

  await appDataSource.initialize();

  try {
    await appDataSource.runMigrations();

    const configService = new ConfigService({
      app: getAppRuntimeConfig(process.env),
      database: getDatabaseRuntimeConfig(process.env),
      lab: getLabRuntimeConfig(process.env),
    });
    const databaseDialect = new DatabaseDialectService(configService);
    const runtimePolicy = new RuntimePolicyService(configService);
    const servicesService = new ServicesService(
      appDataSource.getRepository('service_orders'),
      appDataSource.getRepository('service_order_items'),
      appDataSource.getRepository('patients'),
      appDataSource.getRepository('doctors'),
      appDataSource.getRepository('studies'),
      configService,
      databaseDialect,
      runtimePolicy,
    );

    const patientRepo = appDataSource.getRepository(Patient);
    const studyRepo = appDataSource.getRepository(Study);
    const serviceRepo = appDataSource.getRepository('service_orders');

    const patient = await patientRepo.save(
      patientRepo.create({
        firstName: 'Paciente',
        lastName: 'Offline',
        middleName: '',
        gender: PatientGender.OTHER,
        birthDate: '1990-01-01',
        phone: '7710000001',
        email: 'paciente.offline@test.local',
        addressLine: 'Calle 1',
        addressBetween: '',
        addressCity: 'Huejutla',
        addressState: 'Hidalgo',
        addressZip: '43000',
        documentType: 'ine',
        documentNumber: 'PAC-001',
      }),
    );

    const study = await studyRepo.save(
      studyRepo.create({
        name: 'Biometria',
        code: 'BIO-001',
        description: 'Biometria hematica',
        durationMinutes: 60,
        type: StudyType.STUDY,
        normalPrice: 220,
        difPrice: 220,
        specialPrice: 220,
        hospitalPrice: 220,
        otherPrice: 220,
        defaultDiscountPercent: 0,
        method: '',
        indicator: '',
        packageStudyIds: [],
        status: StudyStatus.ACTIVE,
        isActive: true,
      }),
    );

    const dateToken = (servicesService as any).getLabDateToken(
      new Date('2026-03-29T22:34:00-06:00'),
    );
    await serviceRepo.save(
      serviceRepo.create({
        folio: `ECO${dateToken}0001`,
        patientId: patient.id,
        doctorId: null,
        branchName: 'Unidad Movil',
        sampleAt: new Date('2026-03-30T04:34:00.000Z'),
        deliveryAt: new Date('2026-03-30T04:34:00.000Z'),
        status: 'pending',
        subtotalAmount: 220,
        courtesyPercent: 0,
        discountAmount: 0,
        totalAmount: 220,
        notes: null,
        items: [],
      }),
    );

    const suggestion = await servicesService.getSuggestedFolio();
    const created = await servicesService.create({
      folio: '',
      autoGenerateFolio: true,
      patientId: patient.id,
      doctorId: undefined,
      branchName: 'Unidad Movil',
      sampleAt: '2026-03-30T04:34:00.000Z',
      deliveryAt: '2026-03-30T04:34:00.000Z',
      status: ServiceStatus.PENDING,
      courtesyPercent: 0,
      notes: '',
      items: [
        {
          studyId: study.id,
          priceType: ServiceItemPriceType.NORMAL,
          quantity: 1,
          discountPercent: 0,
        },
      ],
    });

    if (!suggestion.folio.endsWith('0002')) {
      throw new Error(
        `El siguiente folio esperado era 0002 y se obtuvo ${suggestion.folio}.`,
      );
    }

    if (!created.folio.endsWith('0002')) {
      throw new Error(
        `El servicio creado debio usar el folio 0002 y se obtuvo ${created.folio}.`,
      );
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          suggestedFolio: suggestion.folio,
          createdFolio: created.folio,
        },
        null,
        2,
      ),
    );
  } finally {
    await appDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
