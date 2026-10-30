/**
 * Browser stand-in for Node's `assert` module, aliased in vite.config.js.
 *
 * kepler.gl's @kepler.gl/utils does `import assert from 'assert'` and calls
 * `assert('some message')` as a warning. Vite replaces Node built-ins with an
 * empty stub, so the call crashed with "assert is not a function". This keeps
 * Node's semantics exactly: throw only when the value is falsy (a non-empty
 * message string is truthy, so those calls are no-ops, as in Node).
 */
export default function assert(value, message) {
  if (!value) {
    throw new Error(typeof message === 'string' ? message : 'Assertion failed');
  }
}

export const ok = assert;
