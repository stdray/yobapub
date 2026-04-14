// ES5-safe replacements for Array.prototype.find / findIndex, which don't
// exist on Chromium 28 (Tizen 2.3).

export const arrayFind = <T>(arr: ReadonlyArray<T>, pred: (item: T) => boolean): T | undefined => {
  for (let i = 0; i < arr.length; i++) {
    if (pred(arr[i])) return arr[i];
  }
  return undefined;
};

export const arrayFindIndex = <T>(arr: ReadonlyArray<T>, pred: (item: T) => boolean): number => {
  for (let i = 0; i < arr.length; i++) {
    if (pred(arr[i])) return i;
  }
  return -1;
};
