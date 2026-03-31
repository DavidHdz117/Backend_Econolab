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
    'phase13-sync-bootstrap.sqlite',
  );

  mkdirSync(dirname(process.env.DATABASE_SQLITE_PATH), { recursive: true });
  rmSync(process.env.DATABASE_SQLITE_PATH, { force: true });

  const { default: appDataSource } = await import('../src/database/typeorm.datasource');
  const { getSyncRuntimeConfig } = await import('../src/config/sync.config');
  const { SyncBootstrapService } = await import(
    '../src/sync/sync-bootstrap.service'
  );
  const { Patient, PatientGender } = await import(
    '../src/patients/entities/patient.entity'
  );
  const { Study, StudyStatus, StudyType } = await import(
    '../src/studies/entities/study.entity'
  );
  const { StudyDetail, StudyDetailType } = await import(
    '../src/studies/entities/study-detail.entity'
  );

  await appDataSource.initialize();

  try {
    await appDataSource.runMigrations();

    const configService = new ConfigService({
      sync: getSyncRuntimeConfig(process.env),
    });
    const bootstrapService = new SyncBootstrapService(appDataSource, configService);

    const patientRepo = appDataSource.getRepository(Patient);
    const studyRepo = appDataSource.getRepository(Study);
    const detailRepo = appDataSource.getRepository(StudyDetail);

    const activePatient = await patientRepo.save(
      patientRepo.create({
        firstName: 'Bootstrap',
        lastName: 'Active',
        gender: PatientGender.OTHER,
        birthDate: '1990-01-01',
        isActive: true,
        documentType: 'bootstrap',
        documentNumber: `active-${Date.now()}`,
      }),
    );

    const deletedPatient = await patientRepo.save(
      patientRepo.create({
        firstName: 'Bootstrap',
        lastName: 'Deleted',
        gender: PatientGender.OTHER,
        birthDate: '1991-01-01',
        isActive: false,
        deletedAt: new Date('2026-03-29T10:00:00.000Z'),
        documentType: 'bootstrap',
        documentNumber: `deleted-${Date.now()}`,
      }),
    );

    const study = await studyRepo.save(
      studyRepo.create({
        name: 'Bootstrap Study',
        code: `BOOT-${Date.now()}`,
        description: 'Smoke test',
        durationMinutes: 30,
        type: StudyType.STUDY,
        normalPrice: 100,
        difPrice: 90,
        specialPrice: 80,
        hospitalPrice: 70,
        otherPrice: 60,
        defaultDiscountPercent: 0,
        packageStudyIds: [],
        status: StudyStatus.ACTIVE,
        isActive: true,
      }),
    );

    const detail = await detailRepo.save(
      detailRepo.create({
        studyId: study.id,
        dataType: StudyDetailType.PARAMETER,
        name: 'Hemoglobina',
        sortOrder: 1,
        unit: 'g/dL',
        referenceValue: '12-16',
        isActive: true,
      }),
    );

    const patientPageWithoutDeleted = await bootstrapService.exportResourcePage(
      'patients',
      {
        includeDeleted: false,
        limit: 10,
      },
    );
    const patientPageWithDeleted = await bootstrapService.exportResourcePage(
      'patients',
      {
        includeDeleted: true,
        limit: 10,
      },
    );
    const studiesPage = await bootstrapService.exportResourcePage('studies', {
      limit: 10,
    });
    const detailPage = await bootstrapService.exportResourcePage('study_details', {
      limit: 10,
    });

    const exportedPatientPublicIds = new Set(
      patientPageWithoutDeleted.mutations.map((mutation) =>
        String(mutation.payload.publicId),
      ),
    );

    if (!exportedPatientPublicIds.has(activePatient.publicId!)) {
      throw new Error('El paciente activo debio aparecer en bootstrap.');
    }

    if (exportedPatientPublicIds.has(deletedPatient.publicId!)) {
      throw new Error(
        'El paciente eliminado no debio aparecer cuando includeDeleted=false.',
      );
    }

    const deletedMutation = patientPageWithDeleted.mutations.find(
      (mutation) => mutation.payload.publicId === deletedPatient.publicId,
    );
    if (!deletedMutation || deletedMutation.operation !== 'delete') {
      throw new Error(
        'El paciente eliminado debio exportarse como delete cuando includeDeleted=true.',
      );
    }

    const studyMutation = studiesPage.mutations.at(0);
    const detailMutation = detailPage.mutations.at(0);

    if (!studyMutation || studyMutation.payload.publicId !== study.publicId) {
      throw new Error('El estudio debio exportarse con su publicId.');
    }

    if (
      !detailMutation ||
      detailMutation.payload.publicId !== detail.publicId ||
      detailMutation.payload.studyPublicId !== study.publicId
    ) {
      throw new Error(
        'El detalle de estudio debio exportarse con referencias portables por publicId.',
      );
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          patientsWithoutDeleted: patientPageWithoutDeleted.count,
          patientsWithDeleted: patientPageWithDeleted.count,
          studyPublicId: study.publicId,
          detailPublicId: detail.publicId,
          detailStudyPublicId: detailMutation.payload.studyPublicId,
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
