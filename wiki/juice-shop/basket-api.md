---
title: Basket API
tags: [juice-shop, api, basket, sequelize, endpoints]
created: 2026-05-13
---

# Basket API

The basket feature exposes two separate API surfaces: a hand-written REST endpoint for reading a basket, and an auto-generated Sequelize/finale endpoint for mutating basket items.

## Endpoints

| Method | Path | Handler / Source | Auth required |
|---|---|---|---|
| `GET` | `/rest/basket/:id` | `routes/rest/basket.ts` | Yes |
| `GET` | `/api/Baskets/:id` | finale auto-generated | Yes |
| `PUT` | `/api/BasketItems/:id` | finale auto-generated | Yes |
| `POST` | `/api/BasketItems/` | finale auto-generated | Yes |
| `DELETE` | `/api/BasketItems/:id` | finale auto-generated | Yes |

## Data Models

### `Basket`

```ts
// models/basket.ts (simplified)
Basket.init({
  id:     DataTypes.INTEGER,
  UserId: DataTypes.INTEGER,   // FK → User.id — ownership field
}, …)
```

### `BasketItem`

```ts
// models/basketitem.ts (simplified)
BasketItem.init({
  id:        DataTypes.INTEGER,
  quantity:  DataTypes.INTEGER,
  BasketId:  DataTypes.INTEGER, // FK → Basket.id — ownership chain
  ProductId: DataTypes.INTEGER, // FK → Product.id
}, …)
```

### Ownership Chain

```
User.id  ←  Basket.UserId
              Basket.id  ←  BasketItem.BasketId
```

To verify that a `BasketItem` belongs to the authenticated user, you must walk the chain:

```
BasketItem.BasketId → Basket.id → Basket.UserId === req.userId
```

## Hand-Written Route: `GET /rest/basket/:id`

Located in `routes/rest/basket.ts`.

Fetches a `Basket` by the `:id` URL parameter and returns it with its associated `Products` via Sequelize `include`. The middleware chain in `server.ts` attaches `isAuthorized()` and `appendUserId()` before this handler runs.

## Auto-Generated Routes: `/api/BasketItems/*`

Managed by `finale-rest`. These are registered in bulk in `server.ts` when `finale` initialises the model. There is no dedicated route file.

Customisation of these routes (e.g. access control) is done via `finale` milestone hooks, for example:

```ts
basketItemResource.update.auth(function (req, res, context) {
  // ownership check would go here
  return context.continue
})
```

## Watch Out For

- `GET /rest/basket/:id` and `GET /api/Baskets/:id` are **two different endpoints** backed by different code paths. Behaviour and middleware differ.
- The `finale` auto-generated endpoints operate on any row by primary key. Without milestone hooks enforcing ownership, any authenticated user can read or mutate any other user's basket items.
- `BasketItem` has no direct `UserId` column. Ownership must always be verified through the parent `Basket`.

## Related Notes

- [[Auth and JWT]]
- [[Routing and Middleware]]
- [[Security Vulnerabilities — BOLA]]
