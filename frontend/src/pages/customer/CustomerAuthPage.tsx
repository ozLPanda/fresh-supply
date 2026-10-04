import { FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { LockKeyhole, UserPlus } from "lucide-react";
import { StoreLayout } from "@/layouts/StoreLayout";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCard } from "@/shared/ui/AppCard";
import { AppInput, AppPhoneInput } from "@/shared/ui/AppField";
import { AppAlert } from "@/shared/ui/AppFeedback";
import "./CommercePages.css";

export function CustomerAuthPage({ mode }: { mode: "login" | "register" }) {
  const { user, login, register } = useCommerce();
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/profile" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (mode === "register" && password !== passwordConfirmation) {
      setError("Пароли не совпадают");
      return;
    }
    setLoading(true);
    try {
      if (mode === "login") await login(phone, password);
      else await register({ name, email, phone, password });
      const target = (location.state as { from?: string } | null)?.from ?? "/profile";
      navigate(target, { replace: true });
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Не удалось выполнить вход");
    } finally {
      setLoading(false);
    }
  }

  return (
    <StoreLayout>
      <section className="commerce-auth">
        <AppCard className="commerce-auth__card">
          <p className="commerce-eyebrow">Личный кабинет</p>
          <h1>{mode === "login" ? "Вход" : "Регистрация"}</h1>
          <p>
            {mode === "login"
              ? "Войдите, чтобы оплатить заказ с баланса и следить за его статусом."
              : "Создайте единый аккаунт для магазина и административной панели."}
          </p>
          <form onSubmit={submit}>
            {mode === "register" && (
              <>
                <AppInput
                  label="Имя"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
                <AppPhoneInput label="Телефон" value={phone} onValueChange={setPhone} required />
                <AppInput
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                />
              </>
            )}
            {mode === "login" && (
              <AppPhoneInput label="Телефон" value={phone} onValueChange={setPhone} required />
            )}
            <AppInput
              label="Пароль"
              type="password"
              value={password}
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {mode === "register" && (
              <AppInput
                label="Повторите пароль"
                type="password"
                value={passwordConfirmation}
                minLength={8}
                onChange={(event) => setPasswordConfirmation(event.target.value)}
                error={
                  passwordConfirmation && password !== passwordConfirmation
                    ? "Пароли не совпадают"
                    : undefined
                }
                required
                autoComplete="new-password"
              />
            )}
            {error && (
              <AppAlert title="Ошибка" tone="danger">
                {error}
              </AppAlert>
            )}
            <AppButton type="submit" loading={loading}>
              {mode === "login" ? <LockKeyhole size={18} /> : <UserPlus size={18} />}
              {mode === "login" ? "Войти" : "Создать аккаунт"}
            </AppButton>
          </form>
          <div className="commerce-auth__switch">
            {mode === "login" ? "Нет аккаунта?" : "Уже зарегистрированы?"}{" "}
            <Link to={mode === "login" ? "/register" : "/login"}>
              {mode === "login" ? "Зарегистрироваться" : "Войти"}
            </Link>
          </div>
        </AppCard>
      </section>
    </StoreLayout>
  );
}
