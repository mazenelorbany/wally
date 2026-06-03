// Flat re-export. Resource controllers import @Roles() from the auth root —
//   import { Roles } from '../auth/roles.decorator';
// — so the canonical implementation in ./decorators is surfaced here too.
export { Roles, ROLES_KEY } from './decorators/roles.decorator';
