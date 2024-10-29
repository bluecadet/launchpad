import 'vitest'

interface CustomMatchers<R = unknown> {
  toBeOk: () => R,
  toBeErr: () => R
}

declare module 'vitest' {
  interface Assertion<T = any> extends CustomMatchers<T> { }
  interface AsymmetricMatchersContaining extends CustomMatchers { }
}