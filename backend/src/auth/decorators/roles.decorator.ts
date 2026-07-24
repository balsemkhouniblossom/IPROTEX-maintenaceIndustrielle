import { applyDecorators, SetMetadata } from '@nestjs/common';
import { Role } from '../../schemas/user.schema';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const AdminOnly = () => applyDecorators(Roles(Role.ADMIN));

export const TechnicianOnly = () => applyDecorators(Roles(Role.TECHNICIAN));

export const OperatorOnly = () => applyDecorators(Roles(Role.OPERATOR));

export const AuthenticatedRoles = () =>
  applyDecorators(Roles(Role.ADMIN, Role.TECHNICIAN, Role.OPERATOR));
