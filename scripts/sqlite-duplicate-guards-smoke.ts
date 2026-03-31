import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

async function main() {
  process.env.DATABASE_TYPE ??= 'sqlite';
  process.env.APP_RUNTIME_MODE ??= 'desktop-offline';
  process.env.DATABASE_SYNCHRONIZE ??= 'false';
  process.env.DATABASE_LOGGING ??= 'false';
  process.env.DATABASE_SQLITE_PATH ??= resolve(
    process.cwd(),
    'tmp',
    'phase15-sqlite-duplicate-guards.sqlite',
  );

  mkdirSync(dirname(process.env.DATABASE_SQLITE_PATH), { recursive: true });
  rmSync(process.env.DATABASE_SQLITE_PATH, { force: true });

  const { default: appDataSource } = await import('../src/database/typeorm.datasource');
  const { getAppRuntimeConfig } = await import('../src/config/app.config');
  const { getDatabaseRuntimeConfig } = await import(
    '../src/config/database.config'
  );
  const { DatabaseDialectService } = await import(
    '../src/database/database-dialect.service'
  );
  const { RuntimePolicyService } = await import(
    '../src/runtime/runtime-policy.service'
  );
  const { PatientsService } = await import('../src/patients/patients.service');
  const { DoctorsService } = await import('../src/doctors/doctors.service');
  const { PatientGender } = await import('../src/patients/entities/patient.entity');

  await appDataSource.initialize();

  try {
    await appDataSource.runMigrations();

    const configService = new ConfigService({
      app: getAppRuntimeConfig(process.env),
      database: getDatabaseRuntimeConfig(process.env),
    });
    const databaseDialect = new DatabaseDialectService(configService);
    const runtimePolicy = new RuntimePolicyService(configService);
    const patientsService = new PatientsService(
      appDataSource.getRepository('patients'),
      databaseDialect,
    );
    const doctorsService = new DoctorsService(
      appDataSource.getRepository('doctors'),
      databaseDialect,
      runtimePolicy,
    );

    const createdPatient = await patientsService.create({
      firstName: 'Anderson',
      lastName: 'Silva',
      middleName: '',
      gender: PatientGender.OTHER,
      birthDate: '2026-03-03',
      phone: '7710001111',
      email: 'anderson.silva@test.local',
      addressLine: 'Calle 1',
      addressBetween: '',
      addressCity: 'Huejutla',
      addressState: 'Hidalgo',
      addressZip: '43000',
      documentType: 'ine',
      documentNumber: 'DOC-001',
    });

    const createdDoctor = await doctorsService.create({
      firstName: 'Anderson',
      lastName: 'Silva',
      middleName: '',
      email: 'doctor.anderson@test.local',
      phone: '7710002222',
      specialty: 'Cardiologia',
      licenseNumber: 'LIC-001',
      notes: '',
    });

    let duplicatePatientBlocked = false;
    let duplicateDoctorBlocked = false;

    try {
      await patientsService.create({
        firstName: 'Anderson',
        lastName: 'Silva',
        middleName: '',
        gender: PatientGender.OTHER,
        birthDate: '2026-03-03',
        phone: '7719999999',
        email: 'otro.paciente@test.local',
        addressLine: 'Calle 2',
        addressBetween: '',
        addressCity: 'Huejutla',
        addressState: 'Hidalgo',
        addressZip: '43000',
        documentType: 'ine',
        documentNumber: 'DOC-002',
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        duplicatePatientBlocked = true;
      } else {
        throw error;
      }
    }

    try {
      await doctorsService.create({
        firstName: 'Anderson',
        lastName: 'Silva',
        middleName: '',
        email: 'doctor.anderson@test.local',
        phone: '7711234567',
        specialty: 'Cardiologia',
        licenseNumber: 'LIC-002',
        notes: '',
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        duplicateDoctorBlocked = true;
      } else {
        throw error;
      }
    }

    if (!duplicatePatientBlocked) {
      throw new Error('El duplicado de paciente debio bloquearse.');
    }

    if (!duplicateDoctorBlocked) {
      throw new Error('El duplicado de medico debio bloquearse.');
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          createdPatientId: createdPatient.id,
          createdDoctorId: createdDoctor.id,
          duplicatePatientBlocked,
          duplicateDoctorBlocked,
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
