// Pragmatic flat config: TS recommended + react-hooks. No type-aware rules
// (typecheck already runs tsc across the workspace); this gate catches unused
// code, hook misuse, and obvious footguns without double-checking types.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/**'] },
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // tsc(noEmit) is the source of truth for types; these rules add the
      // hygiene tsc doesn't enforce.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // The "reset dialog state on open" effect pattern is used deliberately
      // across the app; this new react-hooks v6 rule flags every instance.
      'react-hooks/set-state-in-effect': 'off',
      // Useful signal, but several intentional "run on open only" effects
      // exist — surface as warnings rather than blocking the gate.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
