import type { Role } from 'src/common/enums/roles.enum';

export type SupportedDbRole = Role | 'admin' | 'recepcionista';

export interface RoleCarrier {
  role?: string | null;
  rol?: string | null;
}
