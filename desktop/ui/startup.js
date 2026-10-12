const form = document.getElementById("setup");
const title = document.getElementById("title");
const status = document.getElementById("status");
const error = document.getElementById("error");
const importForm = document.getElementById("import");
const importError = document.getElementById("import-error");
const importDescription = document.getElementById("import-description");
let replacingData = false;
const updatePanel = document.getElementById("update");
const updateProgress = document.getElementById("update-progress");
const updateCancel = document.getElementById("update-cancel");

// Same phone format as AppPhoneInput on the website login page.
function formatPhone(value) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  if (!digits.startsWith("7")) digits = `7${digits}`;
  digits = digits.slice(0, 11);
  const body = digits.slice(1);
  let result = "+7";
  if (body.length) result += ` (${body.slice(0, 3)}`;
  if (body.length >= 3) result += ")";
  if (body.length > 3) result += ` ${body.slice(3, 6)}`;
  if (body.length > 6) result += `-${body.slice(6, 8)}`;
  if (body.length > 8) result += `-${body.slice(8, 10)}`;
  return result;
}

for (const id of ["phone", "source-phone"]) {
  const input = document.getElementById(id);
  input.value = formatPhone(input.value);
  input.addEventListener("input", () => {
    const formatted = formatPhone(input.value);
    if (input.value !== formatted) input.value = formatted;
  });
}

window.ovoshiDesktop.onStatus((payload) => {
  updatePanel.hidden = !payload.update;
  if (payload.update) {
    title.textContent = "Обновление приложения";
    status.textContent = payload.message;
    form.hidden = true;
    importForm.hidden = true;
    updateCancel.disabled = !payload.cancellable;
    if (Number.isFinite(payload.percent))
      updateProgress.value = payload.percent;
    else updateProgress.removeAttribute("value");
    return;
  }
  if (payload.setup) {
    title.textContent = "Первый запуск";
    status.textContent = "Настройте доступ к локальной базе.";
    form.hidden = false;
    importForm.hidden = true;
    document.getElementById("phone").focus();
  } else if (payload.import) {
    replacingData = payload.importMode === "replace";
    title.textContent = replacingData
      ? "Обновить данные с сайта"
      : "Загрузить данные с сайта";
    status.textContent = replacingData
      ? "Сначала скачаем и проверим свежую копию, затем попросим подтвердить замену."
      : "Импорт доступен только для пустой локальной базы. После загрузки программа работает с собственной копией данных.";
    importDescription.textContent = replacingData
      ? "Все локальные данные и файлы будут заменены данными сайта. Изменения, сделанные только в приложении, останутся в резервной копии. После обновления войдите с учётной записью сайта."
      : "Загрузите данные из веб-приложения. После переноса вход выполняется с учётной записью сайта.";
    importForm.querySelector('button[type="submit"]').textContent =
      replacingData ? "Скачать свежую копию" : "Загрузить данные";
    document.getElementById("import-cancel").textContent = replacingData
      ? "Вернуться в приложение"
      : "Продолжить без импорта";
    form.hidden = true;
    importForm.hidden = false;
    importError.textContent = payload.error || "";
    importForm.querySelector('button[type="submit"]').disabled = false;
    document.getElementById("import-cancel").disabled = false;
    document.getElementById("source-url").focus();
  } else {
    title.textContent = payload.dataTransfer
      ? payload.importMode === "replace"
        ? "Обновляем данные"
        : "Загружаем данные"
      : "Готовим приложение";
    status.textContent = payload.message;
    form.hidden = true;
    importForm.hidden = true;
  }
});
updateCancel.addEventListener("click", async () => {
  updateCancel.disabled = true;
  status.textContent = "Отменяем обновление…";
  await window.ovoshiDesktop.cancelUpdate();
});
importForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.getElementById("source-password");
  const credentials = {
    url: document.getElementById("source-url").value,
    phone: document.getElementById("source-phone").value,
    password: password.value,
  };
  importError.textContent = "";
  importForm.querySelector('button[type="submit"]').disabled = true;
  document.getElementById("import-cancel").disabled = true;
  password.value = "";
  try {
    const result = await window.ovoshiDesktop.importFromSite(credentials);
    credentials.password = "";
    if (result?.error || result?.cancelled) {
      title.textContent = replacingData
        ? "Обновить данные с сайта"
        : "Загрузить данные с сайта";
      form.hidden = true;
      importForm.hidden = false;
      importError.textContent = result.error || "";
      importForm.querySelector('button[type="submit"]').disabled = false;
      document.getElementById("import-cancel").disabled = false;
    }
  } catch {
    credentials.password = "";
    importError.textContent =
      "Не удалось завершить перенос. Локальные данные сохранены.";
    importForm.hidden = false;
    importForm.querySelector('button[type="submit"]').disabled = false;
    document.getElementById("import-cancel").disabled = false;
  }
});
document.getElementById("import-cancel").addEventListener("click", () => {
  document.getElementById("source-password").value = "";
  void window.ovoshiDesktop.cancelImport();
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.getElementById("password");
  const confirmation = document.getElementById("confirmation");
  if (password.value !== confirmation.value) {
    error.textContent = "Пароли не совпадают.";
    return;
  }
  const button = form.querySelector("button");
  button.disabled = true;
  error.textContent = "";
  try {
    const result = await window.ovoshiDesktop.setup({
      password: password.value,
      phone: document.getElementById("phone").value,
    });
    if (result?.error) {
      error.textContent = result.error;
      button.disabled = false;
    } else {
      password.value = "";
      confirmation.value = "";
    }
  } catch {
    error.textContent = "Не удалось завершить настройку. Попробуйте ещё раз.";
    button.disabled = false;
  }
});
