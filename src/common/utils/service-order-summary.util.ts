import { ServiceOrder } from '../../services/entities/service-order.entity';

export function summarizeServiceStudies(service: ServiceOrder) {
  const packageGroups = new Map<string, string[]>();
  const standaloneStudies: string[] = [];

  for (const item of service.items ?? []) {
    if (item.sourcePackageNameSnapshot) {
      const current = packageGroups.get(item.sourcePackageNameSnapshot) ?? [];
      current.push(item.studyNameSnapshot);
      packageGroups.set(item.sourcePackageNameSnapshot, current);
      continue;
    }

    standaloneStudies.push(item.studyNameSnapshot);
  }

  return [
    ...[...packageGroups.entries()].map(
      ([packageName, studies]) => `${packageName}: ${studies.join(', ')}`,
    ),
    ...standaloneStudies,
  ].join(' | ');
}
