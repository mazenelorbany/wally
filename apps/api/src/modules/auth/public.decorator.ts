// Flat re-export. Some controllers import @Public() from the auth root
// (e.g. submission's public upload routes) —
//   import { Public } from '../auth/public.decorator';
// — while others use the nested path. Both resolve to the same metadata key.
export { Public, IS_PUBLIC_KEY } from './decorators/public.decorator';
