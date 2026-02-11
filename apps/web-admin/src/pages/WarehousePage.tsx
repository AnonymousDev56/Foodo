import { useEffect, useRef, useState } from "react";
import type { Product, ProductSort } from "@foodo/shared-types";
import { useFoodoClient } from "../api/foodo.client";

const SORT_OPTIONS: Array<{ label: string; value: "none" | ProductSort }> = [
  { label: "None", value: "none" },
  { label: "Price: low to high", value: "price_asc" },
  { label: "Price: high to low", value: "price_desc" }
];

interface ProductFormState {
  name: string;
  category: string;
  price: string;
  stock: string;
  imageUrl: string;
}

const EMPTY_FORM: ProductFormState = {
  name: "",
  category: "",
  price: "",
  stock: "",
  imageUrl: ""
};

const LOCAL_PRODUCT_IMAGE_BY_NAME: Record<string, string> = {
  "classic burger": "/images/products/classic-burger.jpg",
  "double burger": "/images/products/double-burger.jpg",
  "chicken burger": "/images/products/chicken-burger.jpg",
  "pepperoni pizza": "/images/products/pepperoni-pizza.jpg",
  "margherita pizza": "/images/products/margherita-pizza.jpg",
  "bbq pizza": "/images/products/bbq-pizza.jpg",
  "caesar salad": "/images/products/caesar-salad.jpg",
  "greek salad": "/images/products/greek-salad.jpg",
  "tuna salad": "/images/products/tuna-salad.jpg",
  "avocado bowl": "/images/products/avocado-bowl.jpg"
};

function resolveProductImage(product: Product) {
  return LOCAL_PRODUCT_IMAGE_BY_NAME[product.name.toLowerCase()] ?? product.imageUrl ?? "/images/product-fallback.svg";
}

export function WarehousePage() {
  const client = useFoodoClient();
  const didInitFilters = useRef(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);

  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sort, setSort] = useState<"none" | ProductSort>("none");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);

  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM);

  const [newCategory, setNewCategory] = useState("");
  const [categoryToRename, setCategoryToRename] = useState("");
  const [renamedCategoryValue, setRenamedCategoryValue] = useState("");

  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadCategories() {
    const data = await client.getCategories();
    setCategories(data);

    if (!categoryToRename && data.length) {
      setCategoryToRename(data[0]);
      setRenamedCategoryValue(data[0]);
    }

    if (!form.category && data.length) {
      setForm((prev) => ({ ...prev, category: data[0] }));
    }
  }

  async function loadProducts() {
    const data = await client.getProducts({
      category: categoryFilter === "all" ? undefined : categoryFilter,
      sort: sort === "none" ? undefined : sort,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
      inStock: inStockOnly ? true : undefined
    });

    setProducts(data);
  }

  async function bootstrap() {
    setIsLoading(true);
    setError(null);
    try {
      await Promise.all([loadCategories(), loadProducts()]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load warehouse data");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!didInitFilters.current) {
      didInitFilters.current = true;
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void applyFilters();
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter, sort, minPrice, maxPrice, inStockOnly]);

  function fillFormFromProduct(product: Product) {
    setSelectedProductId(product.id);
    setForm({
      name: product.name,
      category: product.category,
      price: String(product.price),
      stock: String(product.stock),
      imageUrl: product.imageUrl ?? ""
    });
  }

  function resetForm() {
    setSelectedProductId(null);
    setForm({
      ...EMPTY_FORM,
      category: categories[0] ?? ""
    });
  }

  async function applyFilters() {
    setIsLoading(true);
    setError(null);
    try {
      await loadProducts();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load products");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveProduct() {
    setIsSavingProduct(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        category: form.category,
        price: Number(form.price),
        stock: Number(form.stock),
        imageUrl: form.imageUrl || undefined
      };

      if (selectedProductId) {
        await client.updateProduct(selectedProductId, payload);
      } else {
        await client.createProduct(payload);
      }

      await loadProducts();
      resetForm();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save product");
    } finally {
      setIsSavingProduct(false);
    }
  }

  async function handleDeleteProduct(productId: string) {
    setError(null);
    try {
      await client.deleteProduct(productId);
      await loadProducts();
      if (selectedProductId === productId) {
        resetForm();
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete product");
    }
  }

  async function handleCreateCategory() {
    if (!newCategory.trim()) {
      return;
    }

    setIsSavingCategory(true);
    setError(null);
    try {
      await client.createCategory({ name: newCategory.trim() });
      setNewCategory("");
      await Promise.all([loadCategories(), loadProducts()]);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to create category");
    } finally {
      setIsSavingCategory(false);
    }
  }

  async function handleRenameCategory() {
    if (!categoryToRename || !renamedCategoryValue.trim()) {
      return;
    }

    setIsSavingCategory(true);
    setError(null);
    try {
      const previousName = categoryToRename;
      const nextName = renamedCategoryValue.trim();
      await client.renameCategory(categoryToRename, { name: renamedCategoryValue.trim() });
      if (categoryFilter === previousName) {
        setCategoryFilter(nextName);
      }
      if (form.category === previousName) {
        setForm((prev) => ({ ...prev, category: nextName }));
      }
      setCategoryToRename(nextName);
      setRenamedCategoryValue(nextName);
      await Promise.all([loadCategories(), loadProducts()]);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to rename category");
    } finally {
      setIsSavingCategory(false);
    }
  }

  async function handleDeleteCategory() {
    if (!categoryToRename) {
      return;
    }

    setIsSavingCategory(true);
    setError(null);
    try {
      const deletedName = categoryToRename;
      await client.deleteCategory(categoryToRename);
      if (categoryFilter === deletedName) {
        setCategoryFilter("all");
      }
      if (form.category === deletedName) {
        setForm((prev) => ({ ...prev, category: "" }));
      }
      setCategoryToRename("");
      setRenamedCategoryValue("");
      await Promise.all([loadCategories(), loadProducts()]);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to delete category");
    } finally {
      setIsSavingCategory(false);
    }
  }

  return (
    <section className="animate-fade-in space-y-4 rounded-3xl border border-white/70 bg-white/85 p-5 shadow-float backdrop-blur-sm sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">Warehouse Management</h2>
        <button
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:shadow-card"
          type="button"
          onClick={bootstrap}
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="glass-panel grid gap-3 rounded-2xl p-3 md:grid-cols-5">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Category</span>
          <select
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-brand-200 focus:ring"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="all">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Sort</span>
          <select
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-brand-200 focus:ring"
            value={sort}
            onChange={(event) => setSort(event.target.value as "none" | ProductSort)}
          >
            {SORT_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Min price</span>
          <input
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-brand-200 focus:ring"
            type="number"
            min="0"
            step="0.01"
            value={minPrice}
            onChange={(event) => setMinPrice(event.target.value)}
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Max price</span>
          <input
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-brand-200 focus:ring"
            type="number"
            min="0"
            step="0.01"
            value={maxPrice}
            onChange={(event) => setMaxPrice(event.target.value)}
          />
        </label>

        <div className="flex items-end gap-2">
          <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              className="rounded border-slate-300"
              type="checkbox"
              checked={inStockOnly}
              onChange={(event) => setInStockOnly(event.target.checked)}
            />
            In stock only
          </label>
          <button
            className="rounded-xl bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-brand-700"
            type="button"
            onClick={applyFilters}
          >
            Apply
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/80 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold">Price</th>
                <th className="px-4 py-3 font-semibold">Stock</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-t border-slate-100 transition duration-200 hover:bg-slate-50/80">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <img
                        src={resolveProductImage(product)}
                        alt={product.name}
                        className="h-9 w-9 rounded-lg object-cover"
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.src = "/images/product-fallback.svg";
                        }}
                      />
                      <span className="font-medium text-slate-800">{product.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">{product.category}</td>
                  <td className="px-4 py-3">${product.price.toFixed(2)}</td>
                  <td className="px-4 py-3">{product.stock}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        className="rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:shadow-card"
                        type="button"
                        onClick={() => fillFormFromProduct(product)}
                      >
                        Edit
                      </button>
                      <button
                        className="rounded-xl border border-rose-200 bg-white px-2.5 py-1 text-xs font-semibold text-rose-700 transition duration-200 hover:-translate-y-0.5 hover:shadow-card"
                        type="button"
                        onClick={() => handleDeleteProduct(product.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!products.length && !isLoading ? (
            <div className="px-4 py-8 text-center">
              <img src="/images/empty-table.svg" alt="No products" className="mx-auto mb-3 h-24 w-auto" loading="lazy" />
              <p className="text-sm font-medium text-slate-700">No products found.</p>
            </div>
          ) : null}
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-100 bg-white p-4">
          <h3 className="text-lg font-extrabold tracking-tight text-slate-900">{selectedProductId ? "Edit Product" : "Create Product"}</h3>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Name</span>
            <input
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-brand-200 focus:ring"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Category</span>
            <select
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-brand-200 focus:ring"
              value={form.category}
              onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-2 md:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-600">Price</span>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-brand-200 focus:ring"
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))}
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-600">Stock</span>
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-brand-200 focus:ring"
                type="number"
                min="0"
                step="1"
                value={form.stock}
                onChange={(event) => setForm((prev) => ({ ...prev, stock: event.target.value }))}
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Image URL</span>
            <input
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-brand-200 focus:ring"
              value={form.imageUrl}
              onChange={(event) => setForm((prev) => ({ ...prev, imageUrl: event.target.value }))}
            />
          </label>

          <div className="flex gap-2">
            <button
              className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-brand-700 hover:shadow-card disabled:opacity-60"
              type="button"
              onClick={handleSaveProduct}
              disabled={isSavingProduct}
            >
              {isSavingProduct ? "Saving..." : "Save"}
            </button>
            <button
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:shadow-card"
              type="button"
              onClick={resetForm}
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 rounded-2xl border border-slate-100 bg-white p-4 md:grid-cols-3">
        <h3 className="md:col-span-3 text-lg font-bold tracking-tight text-slate-900">Categories</h3>

        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-700">Create</p>
          <input
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-brand-200 focus:ring"
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value)}
            placeholder="New category"
          />
          <button
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:shadow-card disabled:opacity-60"
            type="button"
            onClick={handleCreateCategory}
            disabled={isSavingCategory}
          >
            Add category
          </button>
        </div>

        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-700">Rename</p>
          <select
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-brand-200 focus:ring"
            value={categoryToRename}
            onChange={(event) => {
              setCategoryToRename(event.target.value);
              setRenamedCategoryValue(event.target.value);
            }}
          >
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <input
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-brand-200 focus:ring"
            value={renamedCategoryValue}
            onChange={(event) => setRenamedCategoryValue(event.target.value)}
          />
          <button
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:shadow-card disabled:opacity-60"
            type="button"
            onClick={handleRenameCategory}
            disabled={isSavingCategory}
          >
            Rename category
          </button>
        </div>

        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-700">Delete</p>
          <p className="text-sm text-slate-500">Delete is allowed only when no products use category.</p>
          <button
            className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 transition duration-200 hover:-translate-y-0.5 hover:shadow-card disabled:opacity-60"
            type="button"
            onClick={handleDeleteCategory}
            disabled={isSavingCategory || !categoryToRename}
          >
            Delete "{categoryToRename || "-"}"
          </button>
        </div>
      </div>
    </section>
  );
}
