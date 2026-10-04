import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LockKeyhole } from "lucide-react";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCard } from "@/shared/ui/AppCard";
import { AppInput, AppPhoneInput } from "@/shared/ui/AppField";
import { AppAlert } from "@/shared/ui/AppFeedback";
import "./AdminLoginPage.css";

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useCommerce();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const current = await login(phone, password);
      if (!current.adminAccess) throw new Error("У пользователя нет доступа в админку");
      navigate("/admin");
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "Ошибка входа");
    }
  }

  return (
    <div className="login-page admin-login-page">
      <AppCard className="login-card admin-login-card">
        <div className="login-mark">ФА</div>
        <p className="login-kicker">Фирма Актив</p>
        <h1>Вход в управление</h1>
        <p>Каталог, заказы, склад и команда вашего магазина.</p>
        <form onSubmit={submit}>
          <AppPhoneInput label="Телефон" value={phone} onValueChange={setPhone} required />
          <AppInput
            label="Пароль"
            type="password"
            value={password}
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
          {error && (
            <AppAlert title="Ошибка входа" tone="danger">
              {error}
            </AppAlert>
          )}
          <AppButton type="submit">
            <LockKeyhole size={18} />
            Войти
          </AppButton>
        </form>
      </AppCard>
    </div>
  );
}
