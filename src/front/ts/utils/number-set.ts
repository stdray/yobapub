export class NumberSet {
  private readonly data: Record<number, boolean> = {};

  constructor(values?: readonly number[]) {
    if (values) {
      for (let i = 0; i < values.length; i++) {
        this.data[values[i]] = true;
      }
    }
  }

  readonly has = (value: number): boolean => this.data[value] === true;

  readonly add = (value: number): void => { this.data[value] = true; };

  readonly delete = (value: number): void => { delete this.data[value]; };

  readonly clone = (): NumberSet => {
    const copy = new NumberSet();
    const keys = Object.keys(this.data);
    for (let i = 0; i < keys.length; i++) {
      copy.data[Number(keys[i])] = true;
    }
    return copy;
  };
}
