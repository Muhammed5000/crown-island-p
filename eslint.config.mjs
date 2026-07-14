import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

/**
 * Crown Island — ESLint flat config.
 * Next 16's eslint-config-next ships flat configs as arrays, which we spread directly.
 */
const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'public/sw.js',
      'public/workbox-*.js',
      'next-env.d.ts',
      // Root CommonJS dev/util scripts — not part of the app bundle.
      'fill-places.js',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        // `ignoreRestSiblings` allows the intentional "destructure to omit" idiom
        // (`const { password, ...rest } = data`) without flagging the omitted key.
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/consistent-type-imports': 'warn',
      // Pragmatic relaxations (kept visible as warnings, not build-blocking):
      // `any` appears in a few chart/PDF-export adapters where upstream types
      // are awkward; the experimental React-Compiler rules below fire on
      // intentional mount-time syncs / tick-gated time reads in hand-written
      // client components. Surface them, don't fail the build on them.
      '@typescript-eslint/no-explicit-any': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
];

export default config;
