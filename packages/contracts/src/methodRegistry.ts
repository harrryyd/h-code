export class MethodRegistry<const Key, Value> {
  readonly #map = new Map<Key, Value>();

  register(key: Key, value: Value): void {
    if (this.#map.has(key)) {
      throw new Error(`Method already registered: ${String(key)}`);
    }
    this.#map.set(key, value);
  }

  get(key: Key): Value | undefined {
    return this.#map.get(key);
  }

  has(key: Key): boolean {
    return this.#map.has(key);
  }

  entries(): IterableIterator<[Key, Value]> {
    return this.#map.entries();
  }
}
