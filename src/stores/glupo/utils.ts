export function randomRange(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

export function randomRangeInt(min: number, max: number) {
  return Math.floor(randomRange(min, max + 1));
}

export function choose<T>(items: T[]): T {
  return items[randomRangeInt(0, items.length - 1)];
}

export function weightedChoose<T>(items: T[], weight: (item: T) => number): T {
  const weightedItems = items.map((item) => {
    const w = weight(item);
    return [item, w] as [T, number];
  });

  const totalWeight = weightedItems.reduce(
    (acc, [, weight]) => acc + weight,
    0
  );
  let randomWeight = Math.random() * totalWeight;

  for (const [item, weight] of weightedItems) {
    if (randomWeight <= weight) {
      return item;
    }

    randomWeight -= weight;
  }

  return items[items.length - 1];
}
