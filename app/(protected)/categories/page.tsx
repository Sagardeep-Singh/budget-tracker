import { getServerAuthSession } from '@/lib/auth/session';
import { listCategories } from '@/lib/services/categories';
import { CategoriesView } from '@/components/categories/categories-view';

const CategoriesPage = async (): Promise<React.ReactElement> => {
  const session = await getServerAuthSession();
  const categories = await listCategories(session!.user.id);

  return (
    <div className="animate-[fade-up_0.3s_ease-out]">
      <h1 className="font-display text-ink text-2xl font-semibold">Categories</h1>
      <p className="text-ink-muted mt-1 text-sm">
        Group your spending. Defaults are seeded, but this is your list to shape.
      </p>
      <CategoriesView initialCategories={categories} />
    </div>
  );
};

export default CategoriesPage;
