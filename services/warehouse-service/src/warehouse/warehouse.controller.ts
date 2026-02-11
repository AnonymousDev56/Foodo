import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query
} from "@nestjs/common";
import { WarehouseService } from "./warehouse.service";

@Controller()
export class WarehouseController {
  private readonly warehouseService: WarehouseService;

  constructor(@Inject(WarehouseService) warehouseService: WarehouseService) {
    this.warehouseService = warehouseService;
  }

  @Get("products")
  products(
    @Query("category") category?: string,
    @Query("sort") sort?: string,
    @Query("minPrice") minPriceRaw?: string,
    @Query("maxPrice") maxPriceRaw?: string,
    @Query("inStock") inStockRaw?: string
  ) {
    const minPrice = minPriceRaw !== undefined ? Number(minPriceRaw) : undefined;
    const maxPrice = maxPriceRaw !== undefined ? Number(maxPriceRaw) : undefined;
    const inStock = inStockRaw === undefined ? undefined : inStockRaw === "true";

    return this.warehouseService.getProducts({
      category,
      sort,
      minPrice: Number.isFinite(minPrice as number) ? minPrice : undefined,
      maxPrice: Number.isFinite(maxPrice as number) ? maxPrice : undefined,
      inStock
    });
  }

  @Get("products/:id")
  productById(@Param("id") id: string) {
    return this.warehouseService.getProductById(id);
  }

  @Post("products")
  createProduct(@Body() payload: Record<string, unknown>) {
    return this.warehouseService.createProduct(payload);
  }

  @Patch("products/:id")
  updateProduct(@Param("id") id: string, @Body() payload: Record<string, unknown>) {
    return this.warehouseService.updateProduct(id, payload);
  }

  @Delete("products/:id")
  deleteProduct(@Param("id") id: string) {
    return this.warehouseService.deleteProduct(id);
  }

  @Get("categories")
  categories() {
    return this.warehouseService.getCategories();
  }

  @Post("categories")
  createCategory(@Body() payload: { name?: string }) {
    return this.warehouseService.createCategory(String(payload.name ?? ""));
  }

  @Patch("categories/:name")
  renameCategory(@Param("name") name: string, @Body() payload: { name?: string }) {
    return this.warehouseService.renameCategory(decodeURIComponent(name), String(payload.name ?? ""));
  }

  @Delete("categories/:name")
  deleteCategory(@Param("name") name: string) {
    return this.warehouseService.deleteCategory(decodeURIComponent(name));
  }

  @Post("stock/decrement")
  decrementStock(@Body() payload: { items?: Array<{ productId?: string; quantity?: number }> }) {
    return this.warehouseService.decrementStock(payload.items ?? []);
  }
}
