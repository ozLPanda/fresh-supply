---
name: company-shop-ui
description: Build, reuse, customize, or refactor React UI in the company_shop frontend with the project-owned components from frontend/src/shared/ui. Use for mobile adaptation that preserves the existing desktop appearance, admin pages, forms, tables, filters, buttons, cards, feedback, dates, tabs, uploads, badges, metrics, and UI-kit maintenance; also use when moving component-specific CSS or logic out of global styles.
---

# Company Shop UI

Use the existing `App*` design system before creating new controls. Keep each reusable block self-contained: component logic in its `.tsx`, styles in the adjacent `.css`, and page composition in the page.

## Workflow

1. Start with `frontend/COMPONENTS.md` and follow the `component-reuse` skill for reuse decisions, moving components shared across modules, and catalogue updates. Inspect the relevant candidates in `frontend/src/shared/ui` and their live examples in `frontend/src/pages/admin/UiKitPage.tsx`.
2. Read [references/components.md](references/components.md) for component selection and public APIs.
3. Reuse or extend the closest component. Do not duplicate its markup and CSS inside a page.
4. Add customization through typed props, `className`, `style`, variants, renderable slots, or documented CSS variables.
5. Import the component-owned CSS from its `.tsx`. Keep only application tokens, resets, shells, and page layout in `frontend/src/styles.css`.
6. Preserve accessibility: labels, button types, disabled states, focus styles, ARIA names, and keyboard behavior.
7. Add or update an interactive example on `UiKitPage` when introducing a reusable state or variant.
8. Run from `frontend/`:

   ```powershell
   npx.cmd tsc -b
   npx.cmd prettier src/shared/ui src/pages/admin/UiKitPage.tsx src/pages/admin/UiKitPage.css src/styles.css --check
   npm.cmd run build
   ```

## Form Spacing

- When creating or changing any form, explicitly provide inner spacing between its content and the edges of its card, panel, modal, or other enclosing surface. Fields, labels, validation messages, and action buttons must not touch the container edges.
- Inspect the existing container's padding first. Reuse the UI kit's spacing tokens and established form layouts; add padding to the appropriate content wrapper only where it is missing, avoiding doubled padding from nested containers.
- Use consistent `gap` between fields, field groups, sections, and the action row. Keep clear space above and below the form content, including the last field and the buttons. Outer margins do not replace inner padding.
- Verify the rendered form at desktop and mobile widths before considering the layout complete. Check all four edges, spacing between controls, and the action area; responsive layouts must retain comfortable padding without causing horizontal overflow.

## Row Height Alignment

- When adding or changing a control inside a horizontal row, keep its rendered height equal to the neighboring inputs, selects, buttons, and other controls in that row. A toolbar, filter row, form row, or action row must look visually level rather than containing one unexpectedly taller or shorter element.
- Reuse the row's established control size or the matching UI-kit size variant. Account for the complete rendered box, including borders, padding, wrappers, icons, and loading states; matching only the CSS `height` value is not sufficient if the visible controls still differ.
- Preserve equal heights across responsive states for as long as the controls remain on the same row. If the layout wraps or stacks on a narrow viewport, keep controls internally consistent within each resulting row.
- Treat this as a required visual invariant and verify the actual rendered row after the change. An exception is allowed only when a genuinely complex or content-heavy component cannot fit or remain usable at the standard row height. Keep such exceptions rare, intentional, and limited to that component; align the surrounding controls sensibly and mention the reason in the completion report.

## Мобильная адаптация существующего интерфейса

- Сохраняй прежний внешний вид ПК при адаптации под телефон: компоновку, размеры, отступы, типографику, кнопки и оформление окон. Изменения дизайна ПК выполняй только при отдельном указании пользователя.
- До правок зафиксируй исходный вид затронутого интерфейса на ПК, чтобы сравнить его с результатом. Используй текущую версию как основу; не откатывай независимые изменения других задач ради мобильной адаптации.
- Изменения дизайна для телефона ограничивай существующим мобильным breakpoint через media queries или отдельную мобильную разметку. Увеличение элементов для касания, карточки вместо таблиц, мобильные меню и новые размеры модалок должны включаться только в мобильном варианте. Сохраняй исходные базовые стили ПК.
- Перед изменением общей модалки или другого переиспользуемого компонента найди всех его потребителей. Если мобильный вариант нужен одному сценарию, используй локальные стили или явный prop; не распространяй его оформление на остальные страницы. Например, адаптация подбора товара в заказах не должна менять окно инвентаризации на ПК.
- Проверь результат в локальном Chromium на телефоне и ПК, а также по обе стороны изменённого breakpoint. Для общих компонентов проверь затронутых потребителей, включая соседние разделы. Работа готова, когда мобильный интерфейс удобен, а внешний вид ПК совпадает с исходным; если сравнение недоступно, укажи ограничение и не заявляй, что вид ПК сохранён.

## Адаптивность новых форм

- Каждую новую форму сразу реализуй адаптивной для всего диапазона ширин: от мобильных экранов до планшетов, небольших окон ПК, ноутбуков и широких мониторов. Адаптивность входит в готовность формы и не откладывается на отдельную задачу.
- Используй гибкие размеры, Grid/Flex и существующие брейкпоинты проекта. Макет должен работать и между брейкпоинтами, а не только на нескольких фиксированных разрешениях. На широких экранах ограничивай ширину содержимого для удобного чтения; на узких перестраивай колонки в один столбец.
- Адаптируй всю форму: поля, заголовки, подсказки, ошибки, загрузки файлов, группы кнопок и вложенные элементы. Переноси или располагай кнопки вертикально при нехватке места, сохраняй внутренние отступы и удобные для касания элементы управления. Не допускай наложения, обрезания содержимого и горизонтальной прокрутки всей страницы.
- Формы в модальных окнах и панелях должны помещаться по ширине и оставаться доступными при небольшой высоте окна и открытой мобильной клавиатуре. Предусматривай прокрутку содержимого, чтобы пользователь мог добраться до всех полей и действий.
- Перед завершением проверь реальную форму на характерных ширинах, например 320–375, 768, 1024, 1366 и 1920 CSS-пикселей, и плавно измени размер окна для проверки промежуточных значений. Проверь ввод, ошибки валидации и доступность кнопок на мобильном и ПК; при наличии закреплённого меню учитывай фактическую ширину области формы. Если визуальная проверка недоступна, явно укажи это в отчёте и не заявляй, что она выполнена.

## Refactoring Rules

- Keep `sku` as the internal field and API name when it already exists, but always label it as `Артикул` in frontend UI. Never show `SKU` in user-visible headings, labels, placeholders, descriptions, alerts, tables, or generated frontend content.
- Treat global design tokens such as `--surface`, `--line`, `--orange`, and `--text` as the shared theme contract.
- Give token reads a sensible fallback when a component may render outside the main shell.
- Scope selectors under the component root. Avoid bare `table`, `button`, `th`, `td`, or `input` selectors in component CSS.
- Keep responsive rules beside the component they affect.
- Prefer controlled and uncontrolled value APIs where both are useful.
- Preserve native element props when wrapping inputs and buttons.
- Keep business data fetching and page-specific state outside shared UI components.
- Build new primitives on the existing Radix/shadcn wrappers in `frontend/src/components/ui`; do not restyle those globally for one consumer.

## Decision Guide

- Extend an existing component when the visual role and interaction model match.
- Compose existing components when only the page arrangement differs.
- Create a new shared component only when the pattern recurs or clearly belongs to the design system.
- Keep a one-off visual in the page with a page-local CSS file.

## Completion Check

Confirm that the changed component imports its own CSS, exposes required customization through typed inputs, has no hidden global selector dependency, works on the UI-kit page, and passes the frontend build.

For forms, also confirm visually that content and buttons are inset from the container edges and that field, section, and action spacing remains consistent on desktop and mobile.

For every changed horizontal group of controls, confirm that neighboring inputs, selects, buttons, and embedded components have matching rendered heights. If a rare complexity-based exception is necessary, report it explicitly.

For new forms, complete the responsive checks above: the entire form must remain usable across mobile, tablet, desktop, and intermediate viewport widths.

For mobile adaptation of existing UI, compare the desktop result with the captured baseline and verify affected shared-component consumers. Mobile-only design changes must not alter the desktop appearance.
