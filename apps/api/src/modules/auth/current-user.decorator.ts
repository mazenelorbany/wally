// Flat re-export. The sibling resource modules (org/store/campaign/rubric/
// submission) import the param decorator from the auth root —
//   import { CurrentUser } from '../auth/current-user.decorator';
// — so the canonical implementation in ./decorators is surfaced here too.
export { CurrentUser } from './decorators/current-user.decorator';
