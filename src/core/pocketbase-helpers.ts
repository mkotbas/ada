export async function fetchAllRecords<T = any>(service: any, options: Record<string, unknown> = {}, perPage = 200): Promise<T[]> {
  const items: T[] = [];
  let page = 1;

  while (true) {
    const result = await service.getList(page, perPage, options) as { items: T[]; totalPages: number };
    items.push(...result.items);
    if (page >= result.totalPages || result.items.length === 0) break;
    page += 1;
  }

  return items;
}
