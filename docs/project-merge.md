# Состав переноса

Целевой каталог: `ovoshi-help`. Источник бизнес-логики:
`firm-active-company-shop`; источник дизайна: `hackalem-ai-base`.
Перенос включает рабочую копию, в том числе ещё не закоммиченные изменения.
Исходные репозитории не изменяются. Git-история и remote не переносятся.

## Что сохранено

Скопированы исходники backend/frontend, Flyway-миграции, тесты, схемы API,
встроенные публичные ресурсы, Python price-importer, embedding-service,
документация и конфигурации сборки. Новые рабочие модули `supplierproducts` и
`whatsapp`, их frontend/API и миграции V122, V125, V126 также включены.
Java-пакеты, SQL-схема, идентификаторы API и бизнес-правила остаются исходными.
Дизайн меняется через общую тему, оболочку и витрину; остальные страницы и права
доступа сохраняются в маршрутизаторе.

Backend-модули:

`alibabaSourcing`, `analytics`, `audit`, `auth`, `barcodes`, `carts`, `categories`, `common`, `dashboard`, `deployments`, `files`, `integrations`, `mks`, `notifications`, `orders`, `permissions`, `priceImports`, `priceStatistics`, `pricing`, `procurement`, `productImages`, `productViews`, `products`, `reviews`, `roles`, `search`, `seo`, `settings`, `supplierproducts`, `users`, `wallets`, `warehouse`, `whatsapp`, `worktime`.

## Маршруты исходного магазина

Перечень зафиксирован из `frontend/src/main.tsx` исходной рабочей копии:

- `/`
- `/main2`
- `/kotel3d`
- `/categories`
- `/catalog`
- `/catalog/:slug`
- `/product/:id`
- `/login`
- `/register`
- `/profile`
- `/cart`
- `/checkout`
- `/orders`
- `/orders/:id`
- `/admin/login`
- `/admin`
- `/admin/products`
- `/admin/products/suppliers`
- `/admin/products/suppliers/:id`
- `/admin/products/new`
- `/admin/products/import-prices`
- `/admin/products/price-statistics`
- `/admin/products/price-analytics`
- `/admin/product-views`
- `/admin/products/import-created`
- `/admin/products/barcodes`
- `/admin/products/:id`
- `/admin/categories`
- `/admin/categories/new`
- `/admin/categories/:id`
- `/admin/users`
- `/admin/users/:id`
- `/admin/orders`
- `/admin/work-time`
- `/admin/analytics`
- `/admin/audit`
- `/admin/mks-catalog`
- `/admin/whatsapp`
- `/admin/orders/new`
- `/admin/orders/barcode`
- `/admin/orders/:id`
- `/admin/procurement`
- `/admin/procurement/:projectId`
- `/admin/reviews`
- `/admin/roles`
- `/admin/roles/:roleId`
- `/admin/permissions`
- `/admin/ui-kit`
- `/admin/external-software`
- `/admin/settings`
- `/admin/settings/product-availability-analysis`
- `/admin/warehouse`
- `/admin/warehouse/balances/:productId/reservations`
- `/admin/warehouse/balances/:productId/movements`
- `/admin/warehouse/documents`
- `/admin/warehouse/counterparties`
- `/admin/warehouse/stock-shortages`
- `/admin/warehouse/receipts`
- `/admin/warehouse/purchase-orders`
- `/admin/warehouse/purchase-orders/new`
- `/admin/warehouse/receipts/new`
- `/admin/warehouse/price-settings`
- `/admin/warehouse/price-settings/new`
- `/admin/warehouse/opening-balances`
- `/admin/warehouse/opening-balances/new`
- `/admin/warehouse/returns`
- `/admin/warehouse/returns/new`
- `/admin/warehouse/inventory`
- `/admin/warehouse/inventory/new`
- `/admin/warehouse/documents/:documentId`
- `*`

## Что не переносится

- Секретные `.env`, токены, пароли интеграций и Keychain-данные.
- Текущие БД, Docker volumes, uploads, локальные резервные копии и выгрузки.
- `.git`, `node_modules`, `target`, `dist`, кэши и временные результаты.

Seed-данные, уже присутствующие в SQL-миграциях, сохранены. Это не перенос
живой БД: актуальные заказы, остатки, пользовательские настройки и фотографии
потребуют отдельного согласованного импорта, если он понадобится.

## Изоляция окружений

Локально: Compose-проект `ovoshi-help`, порты 5175/8084/5434/8002/8085/8445,
сессионная cookie `ovoshi_help_session`. Продакшен: `ovoshi-help-prod`, отдельные
сети и системные пути, loopback-порты 18090–18095. Имена SQL-базы и Java-пакетов
сохраняются внутри изолированного окружения.

Интеграции GPT/WhatsApp/MKS/Web Push оставлены как модули с пустыми внешними
секретами. Никакого развёртывания и включения production polling не выполнено.
Опциональный Vite `DEV_API_TARGET` на исходный backend подходит только для
просмотра: в этом режиме данные общие, любые записи затронут исходный магазин.

## Проверки

Копирование и сохранение маршрутов проверяются сравнением рабочих деревьев.
Сборка интерфейса: `cd frontend && npm ci && npm run build`.
Конфигурация Docker: `docker compose config --quiet`.
Backend: Maven/Java 21; интеграционные тесты — только с отдельной тестовой БД.
Проверка production-шаблонов не равнозначна развёртыванию на сервере.

Статическая проверка переноса 4 октября 2026:

- `backend/src`: 646 файлов совпадают с исходной рабочей копией байт в байт.
- `backend/price-importer`: 4 файла совпадают; `embedding-service`: 5 файлов совпадают.
- Все маршруты исходного `main.tsx` присутствуют в новом проекте.
- Dev и production Compose проходят `config --quiet` (production — с временными
  проверочными значениями обязательных переменных, без запуска сервисов).
- Bash-сценарии развёртывания проходят синтаксическую проверку `bash -n`.
- Новый Caddyfile проходит `caddy adapt`; конфигурация работающего gateway не менялась.

Эти проверки не подтверждают запуск новой БД, работу внешних интеграций или
готовность нового production-сервера.

## Проверка интерфейса после переноса

- TypeScript и production-сборка Vite/PWA прошли. Сохранены 71 маршрут и
  исходный маршрутизатор. Vite предупреждает о крупных чанках приложения.
- Изолированный локальный Chromium: главная, каталог, вход и корзина на
  1440/390/320px; карточка товара на 1440/390px.
- После обычного входа в исходный локальный магазин проверены новая админка,
  товары, заказы, склад, поставщики, WhatsApp и UI-kit.
- Ошибок JavaScript не обнаружено. Переполнение страницы заказов исправлено:
  ширины 1440/1280/1024/768/390px проверены, широкая таблица прокручивается внутри.
- Проверена гостевая корзина: фильтр наличия, добавление (включая подтверждение
  товара под заказ), увеличение количества, сохранение после перезагрузки и
  удаление. Заказы не отправлялись, изменения делались только в гостевом браузере.
- При недоступном фото товара показывается существующая заглушка.
- 15 изолированных тестов deployment-скриптов прошли; один набор тестов
  deploy.sh пропущен, поскольку системный Bash на Mac имеет версию ниже требуемой Bash 4.
- Серверные тесты и запуск отдельной БД не выполнялись: серверные исходники
  сверены с источником, браузерная проверка использовала работающий исходный API.

Скриншоты локальной проверки находятся в игнорируемом `output/verification/`.

## Отдельный Docker-стек запущен 4 октября 2026

По следующему запросу пользователя поднят независимый Compose-проект `ovoshi-help`.
Все семь сервисов запущены. База PostgreSQL и MinIO созданы заново в собственных
volumes; рабочие данные исходного магазина не импортировались. Все 125 миграций
применились до V126; начальный каталог содержит 369 товаров.

Это состояние первой проверки стека. Для последующих новых установок добавлена
`B015__empty_project.sql`: база создаётся без каталога и ценовых групп, с одним
администратором. Уже созданные базы и их данные не очищаются.

Интерфейс: http://localhost:5175, API: http://localhost:8084, HTTP gateway:
http://localhost:8085. Vite теперь обращается к `http://backend:8080` внутри новой
сети, а не к исходному backend на 8083. HTTPS gateway на 8445 использует
локальный сертификат Caddy; проверен технический ответ, доверие сертификату
на пользовательской машине отдельно не устанавливалось.

Проверка через Docker inspect подтвердила отсутствие пересечений сетей, volumes,
bind mounts и опубликованных портов. ID и StartedAt исходных контейнеров
сохранились. Cookies нового backend: `ovoshi_help_session` и `ovoshi_help_servlet_session`.
Обычный вход в новую админку, страницы товаров/заказов/склада и витрина
проверены в изолированном Chromium; ошибок JavaScript не обнаружено.

Backend и embeddings используют отдельные теги совместимых локальных образов;
образ embeddings сверён по app.py и requirements.txt. Разделение read-only слоёв
образа не означает общих данных контейнеров. Frontend пересобран на Node 24
из-за требования библиотеки сканера, зависимости устанавливаются через npm ci.
