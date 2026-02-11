import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import { createDatabaseClient } from "@foodo/shared-db";
import {
  WarehouseRepository,
  type ProductInput,
  type ProductQuery,
  type StockDecrementItem
} from "./warehouse.repository";

@Injectable()
export class WarehouseService implements OnModuleInit, OnModuleDestroy {
  private readonly db = createDatabaseClient("warehouse-service");
  private readonly repository = new WarehouseRepository(this.db);

  async onModuleInit() {
    await this.db.init();
  }

  async onModuleDestroy() {
    await this.db.close();
  }

  async getProducts(query?: ProductQuery) {
    return this.repository.getProducts(query);
  }

  async getProductById(id: string) {
    const product = await this.repository.getProductById(id);
    if (!product) {
      throw new NotFoundException("Product not found");
    }

    return product;
  }

  async getCategories() {
    const categories = await this.repository.getCategories();
    return categories.map((category) => category.name);
  }

  async createCategory(nameRaw: string) {
    const name = nameRaw.trim();
    if (!name) {
      throw new BadRequestException("Category name is required");
    }

    const categories = await this.repository.getCategories();
    if (categories.some((category) => category.name === name)) {
      throw new BadRequestException("Category already exists");
    }

    await this.repository.createCategory(name);
    return this.getCategories();
  }

  async renameCategory(currentNameRaw: string, nextNameRaw: string) {
    const currentName = currentNameRaw.trim();
    const nextName = nextNameRaw.trim();

    if (!nextName) {
      throw new BadRequestException("New category name is required");
    }

    const categories = await this.repository.getCategories();
    if (!categories.some((category) => category.name === currentName)) {
      throw new NotFoundException("Category not found");
    }

    if (currentName !== nextName && categories.some((category) => category.name === nextName)) {
      throw new BadRequestException("Category already exists");
    }

    await this.repository.renameCategory(currentName, nextName);
    return this.getCategories();
  }

  async deleteCategory(nameRaw: string) {
    const name = nameRaw.trim();
    const categories = await this.repository.getCategories();
    if (!categories.some((category) => category.name === name)) {
      throw new NotFoundException("Category not found");
    }

    const linkedProducts = await this.repository.countProductsByCategory(name);
    if (linkedProducts > 0) {
      throw new BadRequestException("Category is used by existing products");
    }

    await this.repository.deleteCategory(name);
    return this.getCategories();
  }

  async createProduct(payload: Partial<ProductInput>) {
    const data = await this.normalizeProductInput(payload, true);
    const product = await this.repository.createProduct(data);

    if (!product) {
      throw new BadRequestException(`Unknown category: ${data.category}`);
    }

    return product;
  }

  async updateProduct(id: string, payload: Partial<ProductInput>) {
    const data = await this.normalizeProductInput(payload, false);
    const updated = await this.repository.updateProduct(id, data);

    if (!updated) {
      throw new NotFoundException("Product not found");
    }

    if ("notFoundCategory" in updated) {
      throw new BadRequestException(`Unknown category: ${data.category}`);
    }

    return updated;
  }

  async deleteProduct(id: string) {
    const deleted = await this.repository.deleteProduct(id);
    if (!deleted) {
      throw new NotFoundException("Product not found");
    }

    return {
      deleted: true as const,
      id
    };
  }

  async decrementStock(items: Array<Partial<StockDecrementItem>>) {
    if (!Array.isArray(items) || !items.length) {
      throw new BadRequestException("Stock decrement items are required");
    }

    const parsedItems = items.map((item) => ({
      productId: String(item.productId ?? ""),
      quantity: Number(item.quantity ?? 0)
    }));

    for (const item of parsedItems) {
      if (!item.productId || item.quantity <= 0) {
        throw new BadRequestException("Invalid stock decrement payload");
      }
    }

    try {
      return await this.repository.decrementStock(parsedItems);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  private async normalizeProductInput(
    payload: Partial<ProductInput>,
    requireAllFields: true
  ): Promise<ProductInput>;
  private async normalizeProductInput(
    payload: Partial<ProductInput>,
    requireAllFields: false
  ): Promise<Partial<ProductInput>>;
  private async normalizeProductInput(payload: Partial<ProductInput>, requireAllFields: boolean) {
    const next: Partial<ProductInput> = {};

    if (payload.name !== undefined) {
      const name = String(payload.name).trim();
      if (!name) {
        throw new BadRequestException("Product name cannot be empty");
      }
      next.name = name;
    }

    if (payload.category !== undefined) {
      const category = String(payload.category).trim();
      if (!category) {
        throw new BadRequestException("Product category cannot be empty");
      }
      const existingCategory = await this.repository.findCategoryByName(category);
      if (!existingCategory) {
        throw new BadRequestException(`Unknown category: ${category}`);
      }
      next.category = category;
    }

    if (payload.price !== undefined) {
      const price = Number(payload.price);
      if (!Number.isFinite(price) || price < 0) {
        throw new BadRequestException("Product price must be a valid positive number");
      }
      next.price = Number(price.toFixed(2));
    }

    if (payload.stock !== undefined) {
      const stock = Number(payload.stock);
      if (!Number.isFinite(stock) || stock < 0) {
        throw new BadRequestException("Product stock must be a valid non-negative number");
      }
      next.stock = Math.floor(stock);
    }

    if (payload.imageUrl !== undefined) {
      const imageUrl = String(payload.imageUrl).trim();
      next.imageUrl = imageUrl || undefined;
    }

    if (requireAllFields) {
      const requiredKeys: Array<keyof ProductInput> = ["name", "category", "price", "stock"];
      for (const key of requiredKeys) {
        if (next[key] === undefined) {
          throw new BadRequestException(`Missing required field: ${key}`);
        }
      }
    }

    return next;
  }
}
