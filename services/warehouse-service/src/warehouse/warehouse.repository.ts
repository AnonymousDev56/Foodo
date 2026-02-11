import type { DatabaseClient } from "@foodo/shared-db";
import { randomUUID } from "node:crypto";
import type { Product } from "./models/product.model";

export interface ProductQuery {
  category?: string;
  sort?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
}

export interface ProductInput {
  name: string;
  category: string;
  price: number;
  stock: number;
  imageUrl?: string;
}

export interface StockDecrementItem {
  productId: string;
  quantity: number;
}

interface ProductRow {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  imageUrl: string | null;
}

interface CategoryRow {
  id: string;
  name: string;
}

export class WarehouseRepository {
  constructor(private readonly db: DatabaseClient) {}

  async getProducts(query?: ProductQuery) {
    const where: string[] = [];
    const params: Array<string | number | boolean> = [];

    if (query?.category?.trim()) {
      params.push(query.category.trim());
      where.push(`c.name = $${params.length}`);
    }

    if (typeof query?.minPrice === "number") {
      params.push(query.minPrice);
      where.push(`p.price >= $${params.length}`);
    }

    if (typeof query?.maxPrice === "number") {
      params.push(query.maxPrice);
      where.push(`p.price <= $${params.length}`);
    }

    if (query?.inStock) {
      where.push("p.stock > 0");
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const orderBySql =
      query?.sort === "price_asc"
        ? "ORDER BY p.price ASC"
        : query?.sort === "price_desc"
          ? "ORDER BY p.price DESC"
          : "ORDER BY p.name ASC";

    const result = await this.db.query<ProductRow>(
      `SELECT
         p.id,
         p.name,
         c.name AS category,
         p.price::float8 AS price,
         p.stock,
         p.image_url AS "imageUrl"
       FROM products p
       JOIN categories c ON c.id = p.category_id
       ${whereSql}
       ${orderBySql}`,
      params
    );

    return result.rows.map(this.toProduct);
  }

  async getProductById(id: string) {
    const result = await this.db.query<ProductRow>(
      `SELECT
         p.id,
         p.name,
         c.name AS category,
         p.price::float8 AS price,
         p.stock,
         p.image_url AS "imageUrl"
       FROM products p
       JOIN categories c ON c.id = p.category_id
       WHERE p.id = $1
       LIMIT 1`,
      [id]
    );

    return result.rows[0] ? this.toProduct(result.rows[0]) : null;
  }

  async getCategories() {
    const result = await this.db.query<CategoryRow>(
      `SELECT id, name FROM categories ORDER BY name ASC`
    );
    return result.rows;
  }

  async createCategory(name: string) {
    const result = await this.db.query<CategoryRow>(
      `INSERT INTO categories (id, name)
       VALUES ($1, $2)
       RETURNING id, name`,
      [randomUUID(), name]
    );

    return result.rows[0];
  }

  async renameCategory(currentName: string, nextName: string) {
    const result = await this.db.query<CategoryRow>(
      `UPDATE categories
       SET name = $2,
           updated_at = NOW()
       WHERE name = $1
       RETURNING id, name`,
      [currentName, nextName]
    );

    return result.rows[0] ?? null;
  }

  async deleteCategory(name: string) {
    const result = await this.db.query<CategoryRow>(
      `DELETE FROM categories
       WHERE name = $1
       RETURNING id, name`,
      [name]
    );

    return result.rows[0] ?? null;
  }

  async countProductsByCategory(name: string) {
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM products p
       JOIN categories c ON c.id = p.category_id
       WHERE c.name = $1`,
      [name]
    );

    return Number(result.rows[0]?.count ?? "0");
  }

  async findCategoryByName(name: string) {
    const result = await this.db.query<CategoryRow>(
      `SELECT id, name
       FROM categories
       WHERE name = $1
       LIMIT 1`,
      [name]
    );

    return result.rows[0] ?? null;
  }

  async createProduct(payload: ProductInput) {
    const category = await this.findCategoryByName(payload.category);
    if (!category) {
      return null;
    }

    const result = await this.db.query<ProductRow>(
      `INSERT INTO products (id, category_id, name, price, stock, image_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING
         id,
         name,
         $7::text AS category,
         price::float8 AS price,
         stock,
         image_url AS "imageUrl"`,
      [
        randomUUID(),
        category.id,
        payload.name,
        payload.price,
        payload.stock,
        payload.imageUrl ?? null,
        category.name
      ]
    );

    return this.toProduct(result.rows[0]);
  }

  async updateProduct(id: string, payload: Partial<ProductInput>) {
    const existing = await this.getProductById(id);
    if (!existing) {
      return null;
    }

    const nextCategoryName = payload.category ?? existing.category;
    const category = await this.findCategoryByName(nextCategoryName);
    if (!category) {
      return { notFoundCategory: true as const };
    }

    const nextName = payload.name ?? existing.name;
    const nextPrice = payload.price ?? existing.price;
    const nextStock = payload.stock ?? existing.stock;
    const nextImage = payload.imageUrl !== undefined ? payload.imageUrl : existing.imageUrl;

    const result = await this.db.query<ProductRow>(
      `UPDATE products
       SET category_id = $2,
           name = $3,
           price = $4,
           stock = $5,
           image_url = $6,
           updated_at = NOW()
       WHERE id = $1
       RETURNING
         id,
         name,
         $7::text AS category,
         price::float8 AS price,
         stock,
         image_url AS "imageUrl"`,
      [id, category.id, nextName, nextPrice, nextStock, nextImage ?? null, category.name]
    );

    return this.toProduct(result.rows[0]);
  }

  async deleteProduct(id: string) {
    const result = await this.db.query<{ id: string }>(
      `DELETE FROM products
       WHERE id = $1
       RETURNING id`,
      [id]
    );

    return result.rows[0] ?? null;
  }

  async decrementStock(items: StockDecrementItem[]) {
    return this.db.transaction(async (tx) => {
      for (const item of items) {
        const check = await tx.query<{ id: string; stock: number; name: string }>(
          `SELECT id, stock, name
           FROM products
           WHERE id = $1
           FOR UPDATE`,
          [item.productId]
        );

        const product = check.rows[0];
        if (!product) {
          throw new Error(`Product not found: ${item.productId}`);
        }

        if (product.stock < item.quantity) {
          throw new Error(`Not enough stock for ${product.name}`);
        }
      }

      for (const item of items) {
        await tx.query(
          `UPDATE products
           SET stock = stock - $2,
               updated_at = NOW()
           WHERE id = $1`,
          [item.productId, item.quantity]
        );
      }

      const ids = items.map((item) => item.productId);
      const result = await tx.query<ProductRow>(
        `SELECT
           p.id,
           p.name,
           c.name AS category,
           p.price::float8 AS price,
           p.stock,
           p.image_url AS "imageUrl"
         FROM products p
         JOIN categories c ON c.id = p.category_id
         WHERE p.id = ANY($1::text[])
         ORDER BY p.name ASC`,
        [ids]
      );

      return result.rows.map(this.toProduct);
    });
  }

  private toProduct(row: ProductRow): Product {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      price: Number(row.price),
      stock: Number(row.stock),
      imageUrl: row.imageUrl ?? undefined
    };
  }
}
