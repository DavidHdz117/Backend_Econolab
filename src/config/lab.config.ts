import { registerAs } from '@nestjs/config';
import {
  findFirstExistingPath,
  resolvePortablePath,
} from '../common/utils/asset-path.util';

const DEFAULT_LOGO_PATH_CANDIDATES = [
  'src/public/econolab-brand.png',
  'public/econolab-brand.png',
  'dist/public/econolab-brand.png',
  'src/public/logoeco.png',
  'public/logoeco.png',
  'dist/public/logoeco.png',
];

function renderResultTemplate(template: string, resultId: number) {
  return template.replace(/\{id\}/g, String(resultId));
}

export function getLabRuntimeConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    name: env.LAB_NAME?.trim() || 'ECONOLAB',
    subtitle: env.LAB_SUBTITLE?.trim() || 'LABORATORIO DE ANALISIS CLINICOS',
    address: env.LAB_ADDRESS?.trim() || '',
    addressLine2: env.LAB_ADDRESS_2?.trim() || '',
    phone: env.LAB_PHONE?.trim() || '',
    email: env.LAB_EMAIL?.trim() || '',
    schedule: env.LAB_SCHEDULE?.trim() || '',
    sampleSchedule: env.LAB_SAMPLE_SCHEDULE?.trim() || '',
    responsibleName:
      env.LAB_RESPONSIBLE_NAME?.trim() || 'Responsable Sanitario',
    responsibleLicense: env.LAB_RESPONSIBLE_LICENSE?.trim() || '',
    logoPath:
      resolvePortablePath(env.LAB_LOGO_PATH) ??
      findFirstExistingPath(DEFAULT_LOGO_PATH_CANDIDATES),
    signaturePath: resolvePortablePath(env.LAB_SIGNATURE_PATH),
    qrUrlTemplate: env.LAB_QR_URL?.trim() || '',
    qrBaseUrl: env.LAB_QR_BASE_URL?.trim() || '',
    qrPathTemplate: env.LAB_QR_PATH?.trim() || '/results/{id}',
  };
}

export type LabRuntimeConfig = ReturnType<typeof getLabRuntimeConfig>;

export const labConfig = registerAs('lab', () => getLabRuntimeConfig());

export function buildLabResultUrl(lab: LabRuntimeConfig, resultId: number) {
  const urlTemplate = lab.qrUrlTemplate?.trim();

  if (urlTemplate) {
    return renderResultTemplate(urlTemplate, resultId);
  }

  const baseUrl = lab.qrBaseUrl?.trim();
  if (!baseUrl) {
    return null;
  }

  const renderedPath = renderResultTemplate(
    lab.qrPathTemplate || '/results/{id}',
    resultId,
  );
  const normalizedPath = renderedPath.startsWith('/')
    ? renderedPath
    : `/${renderedPath}`;

  return `${baseUrl.replace(/\/$/, '')}${normalizedPath}`;
}
