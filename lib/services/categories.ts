import { prisma } from '@/lib/db/prisma';
import { ServiceValidationError } from '@/lib/services/common';
import type { CreateCategoryInput, UpdateCategoryInput } from '@/lib/validators/categories';

export type FrontendCategory = {
  id: string;
  name: string;
  isDefault: boolean;
};

export const listCategories = async (userId: string): Promise<FrontendCategory[]> => {
  const categories = await prisma.category.findMany({
    where: { userId },
    orderBy: { name: 'asc' },
  });
  return categories.map((c) => ({ id: c.id, name: c.name, isDefault: c.isDefault }));
};

export const createCategory = async (
  userId: string,
  input: CreateCategoryInput,
): Promise<FrontendCategory> => {
  const existing = await prisma.category.findFirst({ where: { userId, name: input.name } });
  if (existing) {
    throw new ServiceValidationError('A category with this name already exists');
  }
  const category = await prisma.category.create({ data: { userId, name: input.name } });
  return { id: category.id, name: category.name, isDefault: category.isDefault };
};

export const updateCategory = async (
  userId: string,
  categoryId: string,
  input: UpdateCategoryInput,
): Promise<FrontendCategory> => {
  const existing = await prisma.category.findFirst({ where: { id: categoryId, userId } });
  if (!existing) {
    throw new ServiceValidationError('Category not found');
  }
  const category = await prisma.category.update({ where: { id: categoryId }, data: input });
  return { id: category.id, name: category.name, isDefault: category.isDefault };
};

export const deleteCategory = async (userId: string, categoryId: string): Promise<void> => {
  const existing = await prisma.category.findFirst({ where: { id: categoryId, userId } });
  if (!existing) {
    throw new ServiceValidationError('Category not found');
  }
  await prisma.category.delete({ where: { id: categoryId } });
};
