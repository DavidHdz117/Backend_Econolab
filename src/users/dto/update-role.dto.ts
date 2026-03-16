import { IsIn } from 'class-validator';
import { Role } from 'src/common/enums/roles.enum';

export class UpdateRoleDto {
  @IsIn([Role.Admin, Role.Recepcionista], { message: 'rol invalido' })
  rol: Role;
}
