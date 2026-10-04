const entityLabels: Record<string, string> = {
  products: "Товары",
  "supplier-products": "Товары поставщиков",
  categories: "Категории",
  users: "Пользователи",
  roles: "Роли и права",
  orders: "Заказы",
  balances: "Баланс",
  reviews: "Отзывы",
  audit: "Журнал действий",
  whatsapp: "WhatsApp",
  deployments: "Сборка обновлений",
  "pages.dashboard": "Админ-панель → Главная",
  "pages.products": "Админ-панель → Товары",
  "pages.supplier-products": "Админ-панель → Товары поставщиков",
  "pages.categories": "Админ-панель → Категории",
  "pages.users": "Админ-панель → Пользователи",
  "pages.roles": "Админ-панель → Роли",
  "pages.settings": "Админ-панель → Настройки",
  "pages.administration": "Админ-панель → Администрирование",
  "pages.externalSoftware": "Админ-панель → Стороннее ПО",
  "pages.uiKit": "Админ-панель → Набор элементов интерфейса",
  warehouse: "Склад",
  "pages.orders": "Админ-панель → Заказы",
  "pages.reviews": "Админ-панель → Отзывы",
  "pages.analytics": "Админ-панель → Аналитика продаж",
  "pages.audit": "Админ-панель → Журнал действий",
  "pages.mks": "Админ-панель → Каталог МКС",
  "pages.whatsapp": "Админ-панель → WhatsApp",
  "pages.procurement": "Админ-панель → Закупки из Китая",
  alibabaSourcing: "Поиск поставщиков",
  procurement: "Закупки из Китая",
};

const actionLabels: Record<string, string> = {
  create: "Создание",
  import: "Импорт и синхронизация",
  read: "Просмотр",
  update: "Редактирование",
  delete: "Удаление",
  view: "Открытие страницы",
  manage: "Управление",
  reply: "Ответ на отзыв",
  payments: "Работа с оплатами",
  history: "Просмотр истории",
  "costs.read": "Просмотр себестоимости",
  negative_stock: "Отпуск с расхождением по остаткам",
  "status.update": "Изменение статуса",
  "files.manage": "Управление файлами",
  "payments.manage": "Управление оплатами",
  "history.read": "Просмотр истории",
};

export function permissionEntityLabel(entityName: string) {
  return entityLabels[entityName] ?? entityName.replace(/\./g, " → ");
}

export function permissionActionLabel(actionName: string) {
  return actionLabels[actionName] ?? actionName;
}
