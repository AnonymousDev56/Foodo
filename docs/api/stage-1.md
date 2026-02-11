# API Stage 1

## auth-service

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me` (Bearer token)

## orders-service

- `POST /orders`
- `GET /orders/my`
- `GET /orders/:id`
- `PATCH /orders/:id/status`

## warehouse-service

- `GET /products`
- `POST /products`
- `PATCH /products/:id`

## delivery-service

- `POST /delivery/assign`
- `GET /delivery/:orderId`
- `PATCH /delivery/:orderId/status`

## notification-service

- `GET /notifications/ping`
