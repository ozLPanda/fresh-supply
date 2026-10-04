import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, MessageCircleMore, RefreshCw } from "lucide-react";
import { AdminPage } from "@/layouts/AdminPage";
import {
  fetchWhatsAppContacts,
  fetchWhatsAppMessages,
  fetchWhatsAppStatus,
  type WhatsAppContact,
  type WhatsAppMessage,
} from "@/shared/api/whatsapp";
import { formatDateTime } from "@/shared/lib/dateTime";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCard } from "@/shared/ui/AppCard";
import { AppSearchInput } from "@/shared/ui/AppField";
import { AppAlert, AppSkeleton } from "@/shared/ui/AppFeedback";
import "./WhatsAppInboxPage.css";

const CONTACT_PAGE_SIZE = 30;
const MESSAGE_PAGE_SIZE = 50;

const mediaLabels: Record<string, string> = {
  AUDIO: "Голосовое сообщение",
  DOCUMENT: "Документ",
  IMAGE: "Изображение",
  VIDEO: "Видео",
  STICKER: "Стикер",
  LOCATION: "Местоположение",
  CONTACTS: "Контакт",
  REACTION: "Реакция",
  INTERACTIVE: "Интерактивное сообщение",
  BUTTON: "Ответ на кнопку",
  ORDER: "Заказ",
  SYSTEM: "Системное сообщение",
  UNKNOWN: "Сообщение неизвестного типа",
};

const statusLabels: Record<string, string> = {
  SENT: "Отправлено",
  DELIVERED: "Доставлено",
  READ: "Прочитано",
  FAILED: "Не доставлено",
  PENDING: "Ожидает отправки",
};

function messageContent(message: WhatsAppMessage) {
  if (message.body?.trim()) return message.body;
  return mediaLabels[message.type.toUpperCase()] ?? `Сообщение (${message.type.toLowerCase()})`;
}

function statusLabel(status: string | null) {
  if (!status) return null;
  return statusLabels[status.toUpperCase()] ?? status.replace(/_/g, " ").toLowerCase();
}

export function WhatsAppInboxPage() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [contactPage, setContactPage] = useState(0);
  const [messagePage, setMessagePage] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedContact, setSelectedContact] = useState<WhatsAppContact | null>(null);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setContactPage(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const contactsQuery = useQuery({
    queryKey: ["whatsapp", "contacts", query, contactPage],
    queryFn: () => fetchWhatsAppContacts(query, contactPage, CONTACT_PAGE_SIZE),
  });
  const statusQuery = useQuery({
    queryKey: ["whatsapp", "status"],
    queryFn: fetchWhatsAppStatus,
  });
  const contacts = contactsQuery.data?.items ?? [];
  const selected = contacts.find((contact) => contact.id === selectedId) ?? selectedContact;
  const messagesQuery = useQuery({
    queryKey: ["whatsapp", "messages", selectedId, messagePage],
    queryFn: () => fetchWhatsAppMessages(selectedId!, messagePage, MESSAGE_PAGE_SIZE),
    enabled: selectedId !== null,
  });
  const messages = messagesQuery.data?.items ?? [];
  const totalContactPages = Math.ceil((contactsQuery.data?.total ?? 0) / CONTACT_PAGE_SIZE);
  const totalMessagePages = Math.ceil((messagesQuery.data?.total ?? 0) / MESSAGE_PAGE_SIZE);

  function selectContact(contact: WhatsAppContact) {
    setSelectedId(contact.id);
    setSelectedContact(contact);
    setMessagePage(0);
    setMobileConversationOpen(true);
  }

  return (
    <AdminPage title="WhatsApp" className="whatsapp-inbox">
      <div className="whatsapp-inbox__intro">
        <p>Контакты и сообщения, полученные через WhatsApp Business API.</p>
        <AppBadge tone="slate">Только просмотр</AppBadge>
      </div>
      {statusQuery.data?.configured === false && (
        <AppAlert title="Интеграция не настроена" tone="warning">
          Чтобы получать контакты и сообщения, настройте доступ к WhatsApp Business API и webhook на
          сервере.
        </AppAlert>
      )}
      <div
        className={`whatsapp-inbox__columns ${mobileConversationOpen ? "is-conversation-open" : ""}`}
      >
        <AppCard className="whatsapp-inbox__contacts">
          <div className="whatsapp-inbox__contacts-head">
            <div>
              <h2>Контакты</h2>
              {contactsQuery.data && <span>{contactsQuery.data.total}</span>}
            </div>
            <AppButton
              type="button"
              variant="ghost"
              aria-label="Обновить контакты"
              title="Обновить контакты"
              onClick={() => void contactsQuery.refetch()}
              disabled={contactsQuery.isFetching}
            >
              <RefreshCw size={18} />
            </AppButton>
          </div>
          <div className="whatsapp-inbox__search">
            <AppSearchInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Поиск контактов"
              placeholder="Имя или номер телефона"
            />
          </div>
          {contactsQuery.isPending ? (
            <div className="whatsapp-inbox__state">
              <AppSkeleton />
            </div>
          ) : contactsQuery.isError ? (
            <div className="whatsapp-inbox__state">
              <AppAlert
                title="Не удалось загрузить контакты"
                tone="danger"
                onRetry={() => void contactsQuery.refetch()}
              >
                Проверьте подключение и повторите запрос.
              </AppAlert>
            </div>
          ) : contacts.length === 0 ? (
            <div className="whatsapp-inbox__empty">
              <MessageCircleMore size={30} aria-hidden="true" />
              <h3>{query ? "Контакты не найдены" : "Сообщений пока нет"}</h3>
              <p>
                {query
                  ? "Попробуйте другое имя или номер."
                  : statusQuery.data?.configured === false
                    ? "После настройки интеграции и получения первого сообщения контакты появятся здесь."
                    : "Контакты появятся здесь после получения первого сообщения через webhook."}
              </p>
            </div>
          ) : (
            <>
              <div className="whatsapp-inbox__contact-list" aria-label="Контакты WhatsApp">
                {contacts.map((contact) => (
                  <button
                    type="button"
                    key={contact.id}
                    className={`whatsapp-inbox__contact ${selectedId === contact.id ? "is-selected" : ""}`}
                    aria-pressed={selectedId === contact.id}
                    onClick={() => selectContact(contact)}
                  >
                    <span className="whatsapp-inbox__avatar" aria-hidden="true">
                      {(contact.displayName?.trim() || contact.waId).slice(0, 1).toUpperCase()}
                    </span>
                    <span className="whatsapp-inbox__contact-content">
                      <span className="whatsapp-inbox__contact-top">
                        <strong>{contact.displayName?.trim() || contact.waId}</strong>
                        <time dateTime={contact.lastMessageAt ?? undefined}>
                          {contact.lastMessageAt
                            ? formatDateTime(contact.lastMessageAt, {
                                dateStyle: "short",
                                timeStyle: "short",
                              })
                            : ""}
                        </time>
                      </span>
                      {contact.displayName && (
                        <span className="whatsapp-inbox__wa-id">{contact.waId}</span>
                      )}
                      <span className="whatsapp-inbox__preview">
                        {contact.lastMessagePreview || "Нет текстового предпросмотра"}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              {totalContactPages > 1 && (
                <div className="whatsapp-inbox__pager">
                  <AppButton
                    type="button"
                    variant="secondary"
                    disabled={contactPage === 0}
                    onClick={() => setContactPage((page) => page - 1)}
                  >
                    Назад
                  </AppButton>
                  <span>
                    Страница {contactPage + 1} из {totalContactPages}
                  </span>
                  <AppButton
                    type="button"
                    variant="secondary"
                    disabled={contactPage + 1 >= totalContactPages}
                    onClick={() => setContactPage((page) => page + 1)}
                  >
                    Далее
                  </AppButton>
                </div>
              )}
            </>
          )}
        </AppCard>

        <AppCard className="whatsapp-inbox__conversation">
          {selectedId === null ? (
            <div className="whatsapp-inbox__empty whatsapp-inbox__conversation-placeholder">
              <MessageCircleMore size={36} aria-hidden="true" />
              <h2>Выберите контакт</h2>
              <p>История сообщений появится здесь.</p>
            </div>
          ) : (
            <>
              <header className="whatsapp-inbox__conversation-head">
                <AppButton
                  type="button"
                  variant="ghost"
                  className="whatsapp-inbox__mobile-back"
                  onClick={() => setMobileConversationOpen(false)}
                  aria-label="К списку контактов"
                >
                  <ChevronLeft size={20} />
                </AppButton>
                <div>
                  <h2>{selected?.displayName?.trim() || selected?.waId || "Контакт"}</h2>
                  <p>{selected?.waId}</p>
                </div>
                <AppButton
                  type="button"
                  variant="ghost"
                  aria-label="Обновить сообщения"
                  title="Обновить сообщения"
                  onClick={() => void messagesQuery.refetch()}
                  disabled={messagesQuery.isFetching}
                >
                  <RefreshCw size={18} />
                </AppButton>
              </header>
              {messagesQuery.isPending ? (
                <div className="whatsapp-inbox__state">
                  <AppSkeleton />
                </div>
              ) : messagesQuery.isError ? (
                <div className="whatsapp-inbox__state">
                  <AppAlert
                    title="Не удалось загрузить сообщения"
                    tone="danger"
                    onRetry={() => void messagesQuery.refetch()}
                  >
                    Попробуйте повторить запрос.
                  </AppAlert>
                </div>
              ) : messages.length === 0 ? (
                <div className="whatsapp-inbox__empty">
                  <h3>Переписка пуста</h3>
                  <p>Сообщения появятся после получения событий от WhatsApp.</p>
                </div>
              ) : (
                <>
                  {totalMessagePages > 1 && (
                    <div className="whatsapp-inbox__message-pager">
                      <AppButton
                        type="button"
                        variant="secondary"
                        disabled={messagePage + 1 >= totalMessagePages}
                        onClick={() => setMessagePage((page) => page + 1)}
                      >
                        Ранее
                      </AppButton>
                      <span>
                        Страница {messagePage + 1} из {totalMessagePages}
                      </span>
                      <AppButton
                        type="button"
                        variant="secondary"
                        disabled={messagePage === 0}
                        onClick={() => setMessagePage((page) => page - 1)}
                      >
                        Позже
                      </AppButton>
                    </div>
                  )}
                  <ol className="whatsapp-inbox__messages" aria-label="История сообщений">
                    {messages.map((message) => (
                      <li
                        key={message.id}
                        className={`whatsapp-inbox__message ${message.direction === "OUTBOUND" ? "is-outbound" : ""}`}
                      >
                        <div className="whatsapp-inbox__bubble">
                          <p>{messageContent(message)}</p>
                          <div className="whatsapp-inbox__message-meta">
                            <time dateTime={message.occurredAt}>
                              {formatDateTime(message.occurredAt)}
                            </time>
                            {message.direction === "OUTBOUND" && statusLabel(message.status) && (
                              <span>{statusLabel(message.status)}</span>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </>
          )}
        </AppCard>
      </div>
    </AdminPage>
  );
}
