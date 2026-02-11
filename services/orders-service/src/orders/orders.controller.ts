import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query
} from "@nestjs/common";
import { CreateOrderDto } from "./dto/create-order.dto";
import { UpdateDeliverySnapshotDto } from "./dto/update-delivery-snapshot.dto";
import { UpdateOrderStatusDto } from "./dto/update-order-status.dto";
import { OrdersService } from "./orders.service";

@Controller("orders")
export class OrdersController {
  private readonly ordersService: OrdersService;

  constructor(@Inject(OrdersService) ordersService: OrdersService) {
    this.ordersService = ordersService;
  }

  @Post()
  create(@Body() dto: CreateOrderDto, @Headers("authorization") authorization?: string) {
    return this.ordersService.create(dto, authorization);
  }

  @Get("my")
  myOrders(@Headers("authorization") authorization?: string) {
    return this.ordersService.myOrders(authorization);
  }

  @Get("recommendations")
  recommendations(
    @Headers("authorization") authorization?: string,
    @Query("productId") productId?: string,
    @Query("viewed") viewedRaw?: string,
    @Query("limit") limitRaw?: string,
    @Query("weightHistory") weightHistoryRaw?: string,
    @Query("weightTogether") weightTogetherRaw?: string,
    @Query("weightPopular") weightPopularRaw?: string
  ) {
    const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
    const weightHistory = weightHistoryRaw !== undefined ? Number(weightHistoryRaw) : undefined;
    const weightTogether = weightTogetherRaw !== undefined ? Number(weightTogetherRaw) : undefined;
    const weightPopular = weightPopularRaw !== undefined ? Number(weightPopularRaw) : undefined;

    const viewedProductIds = viewedRaw
      ?.split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    return this.ordersService.getRecommendations(
      {
        productId,
        viewedProductIds,
        limit: Number.isFinite(limit as number) ? limit : undefined,
        weights: {
          history: Number.isFinite(weightHistory as number) ? weightHistory : undefined,
          together: Number.isFinite(weightTogether as number) ? weightTogether : undefined,
          popular: Number.isFinite(weightPopular as number) ? weightPopular : undefined
        }
      },
      authorization
    );
  }

  @Get("admin")
  adminOrders(
    @Headers("authorization") authorization?: string,
    @Query("status") status?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("minTotal") minTotalRaw?: string,
    @Query("maxTotal") maxTotalRaw?: string
  ) {
    const minTotal = minTotalRaw !== undefined ? Number(minTotalRaw) : undefined;
    const maxTotal = maxTotalRaw !== undefined ? Number(maxTotalRaw) : undefined;

    return this.ordersService.adminOrders(
      {
        status: status as UpdateOrderStatusDto["status"] | undefined,
        dateFrom,
        dateTo,
        minTotal: Number.isFinite(minTotal as number) ? minTotal : undefined,
        maxTotal: Number.isFinite(maxTotal as number) ? maxTotal : undefined
      },
      authorization
    );
  }

  @Get("admin/dashboard-metrics")
  adminDashboardMetrics(@Headers("authorization") authorization?: string) {
    return this.ordersService.adminDashboardMetrics(authorization);
  }

  @Get(":id")
  getById(@Param("id") id: string, @Headers("authorization") authorization?: string) {
    return this.ordersService.getById(id, authorization);
  }

  @Patch(":id/status")
  updateStatus(@Param("id") id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.ordersService.updateStatus(id, dto.status);
  }

  @Patch(":id/admin-status")
  updateStatusByAdmin(
    @Param("id") id: string,
    @Body() dto: UpdateOrderStatusDto,
    @Headers("authorization") authorization?: string
  ) {
    return this.ordersService.updateStatusByAdmin(id, dto.status, authorization);
  }

  @Patch(":id/delivery-snapshot")
  syncDeliverySnapshot(@Param("id") id: string, @Body() dto: UpdateDeliverySnapshotDto) {
    return this.ordersService.syncDeliverySnapshot(id, dto);
  }
}
