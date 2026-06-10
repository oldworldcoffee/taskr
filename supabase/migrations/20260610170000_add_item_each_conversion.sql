-- Optional count<->measure bridge for items counted in EA but purchased by
-- weight or volume. Example: { "each_count": 12, "quantity": 5, "uom": "lb" }
-- means 12 EA = 5 lb. Only needed when the item UOM and purchase UOM are in
-- different families and cannot convert directly.
alter table public.inventory_items
  add column if not exists each_conversion jsonb;

notify pgrst, 'reload schema';
