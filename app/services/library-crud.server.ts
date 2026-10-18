import prisma from "../db.server";

type SortableModel = "embroideryIcon" | "embroideryFont" | "embroideryColor";

function delegate(model: SortableModel): any {
  return (prisma as any)[model];
}

/** Moves an item one step up/down within the shop's list. */
export async function moveItem(model: SortableModel, shop: string, id: string, direction: "up" | "down") {
  const items: Array<{ id: string; sortOrder: number }> = await delegate(model).findMany({
    where: { shop },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, sortOrder: true },
  });
  const index = items.findIndex((i) => i.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= items.length) return;
  const reordered = [...items];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  await prisma.$transaction(
    reordered.map((item, i) => delegate(model).update({ where: { id: item.id }, data: { sortOrder: i } })),
  );
}

export async function nextSortOrder(model: SortableModel, shop: string) {
  const last = await delegate(model).findFirst({ where: { shop }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  return (last?.sortOrder ?? -1) + 1;
}

/** Ensures a record belongs to the shop before changing it. */
export async function ownedBy(model: SortableModel, shop: string, id: string) {
  const found = await delegate(model).findFirst({ where: { id, shop }, select: { id: true } });
  return Boolean(found);
}
