-- Optional local test catalogue from the supplied vegetable order form.
-- Run explicitly; intentionally not a Flyway migration or production seed.
-- Existing products and their prices/units are never changed.
BEGIN;
WITH catalogue(sku, name, price) AS (
    VALUES
    ('PHOTO-001', 'Помидоры', 350),
    ('PHOTO-002', 'Помидоры черри', 1400),
    ('PHOTO-003', 'Огурцы', 450),
    ('PHOTO-004', 'Перец зеленый', 900),
    ('PHOTO-005', 'Перец желтый', 1100),
    ('PHOTO-006', 'Перец красный', 1100),
    ('PHOTO-007', 'Шампиньоны свежие', 1800),
    ('PHOTO-008', 'Баклажаны', 700),
    ('PHOTO-009', 'Цукини', 750),
    ('PHOTO-010', 'Капуста пекинская', 600),
    ('PHOTO-011', 'Капуста синяя', 500),
    ('PHOTO-012', 'Укроп', 1800),
    ('PHOTO-013', 'Петрушка', 1700),
    ('PHOTO-014', 'Петрушка кудрявая', 2200),
    ('PHOTO-015', 'Лук зеленый', 1300),
    ('PHOTO-016', 'Мята', 3000),
    ('PHOTO-017', 'Руккола', 3500),
    ('PHOTO-018', 'Апельсин', 850),
    ('PHOTO-019', 'Банан', 800),
    ('PHOTO-020', 'Грейпфрут', 1000),
    ('PHOTO-021', 'Груша', 1100),
    ('PHOTO-022', 'Изюм', 2200),
    ('PHOTO-023', 'Курага', 3000),
    ('PHOTO-024', 'Лимон', 1200),
    ('PHOTO-025', 'Чернослив', 2600),
    ('PHOTO-026', 'Яблоко', 650),
    ('PHOTO-027', 'Орех Кешью', 5500),
    ('PHOTO-028', 'Орех Миндаль', 4500),
    ('PHOTO-029', 'Орех Арахис', 1600),
    ('PHOTO-030', 'Орех грецкий', 4000),
    ('PHOTO-031', 'Капуста', 200),
    ('PHOTO-032', 'Картофель', 220),
    ('PHOTO-033', 'Лук красный', 450),
    ('PHOTO-034', 'Лук репчатый', 180),
    ('PHOTO-035', 'Морковь', 230),
    ('PHOTO-036', 'Редис', 700),
    ('PHOTO-037', 'Редька', 400),
    ('PHOTO-038', 'Свекла', 280),
    ('PHOTO-039', 'Сухофрукты', 1800),
    ('PHOTO-040', 'Чеснок', 1600),
    ('PHOTO-041', 'Зерно (семечки)', 900),
    ('PHOTO-042', 'Бадьян', 6500),
    ('PHOTO-043', 'Имбирь', 2200),
    ('PHOTO-044', 'Щавель', 1500),
    ('PHOTO-045', 'Салат (лист)', 1800)
)
INSERT INTO products (sku, name_ru, name_kk, price, wholesale_price,
                      bulk_wholesale_price, sko_price, measurement_unit, active)
SELECT c.sku, c.name, c.name, c.price, c.price, c.price, c.price, 'KG', true
FROM catalogue c
WHERE NOT EXISTS (
    SELECT 1 FROM products p
    WHERE lower(replace(trim(p.name_ru), 'ё', 'е')) = lower(replace(c.name, 'ё', 'е'))
      AND p.deleted_at IS NULL
)
ON CONFLICT (sku) DO NOTHING;
COMMIT;
