// Lazy<T> — one-shot initializer, value cached after first get().
// Use reset() when the underlying resource (e.g. a DOM subtree) is destroyed
// and must be re-resolved on next access.
export class Lazy<T> {
  private has = false;
  private value: T | null = null;

  constructor(private readonly factory: () => T) {}

  get(): T {
    if (!this.has) {
      this.value = this.factory();
      this.has = true;
    }
    return this.value as T;
  }

  reset(): void {
    this.has = false;
    this.value = null;
  }
}
