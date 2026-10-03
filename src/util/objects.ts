/**
 * Plain objects keyed by names from a plan (field names, version keys, selectors). A name such as
 * `__proto__` must stay an own key: `object[name] = value` would set the prototype instead, and
 * `object[name]` would read Object.prototype when the key is missing.
 */

/** Sets an own enumerable property, whatever the key */
export function setOwn<T>(object: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** The value of an own property, or undefined (never an inherited one) */
export function getOwn<T>(object: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}
