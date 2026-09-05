export function countItem<T extends string>(items: readonly T[], item: T): number {
  let count = 0;
  for (const candidate of items) if (candidate === item) count++;
  return count;
}

export function addItems<T extends string>(items: T[], item: T, amount: number, capacity: number): number {
  const added = Math.max(0, Math.min(Math.floor(amount), capacity - items.length));
  for (let index = 0; index < added; index++) items.push(item);
  return added;
}

export function removeItems<T extends string>(items: T[], item: T, amount: number): number {
  let removed = 0;
  for (let index = items.length - 1; index >= 0 && removed < amount; index--) {
    if (items[index] === item) {
      items.splice(index, 1);
      removed++;
    }
  }
  return removed;
}

export function groupItems<T extends string>(items: readonly T[]): Partial<Record<T, number>> {
  const grouped: Partial<Record<T, number>> = {};
  for (const item of items) grouped[item] = (grouped[item] ?? 0) + 1;
  return grouped;
}
