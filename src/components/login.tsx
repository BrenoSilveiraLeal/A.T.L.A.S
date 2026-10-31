"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";

export function Login({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState("login"),
    [factorId, setFactorId] = useState("");
  const [secret, setSecret] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const codeFields = useRef<Array<HTMLInputElement | null>>([]);
  // The e-mail (never the password) is kept on this device when "Lembrar de mim" is on.
  const [remember, setRemember] = useState(true);
  const emailField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try { const saved = localStorage.getItem("atlas-email"); if (saved && emailField.current && !emailField.current.value) emailField.current.value = saved; } catch { /* storage blocked */ }
  }, [step]);
  async function send(body: object) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (data.ok) {
        setSecret("");
        router.push("/app");
        router.refresh();
      } else {
        setStep(data.next);
        setFactorId(data.factorId ?? "");
        setSecret(data.secret ?? "");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha de conexão.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-screen">
      <Link className="brand" href="/app">
        <span className="brand-mark">A</span>ATLAS
      </Link>
      <section className="login-panel">
        <ShieldCheck size={32} />
        <h1>Acesso do proprietário</h1>
        <p>Uma operação privada. Identidade verificada em duas etapas.</p>
        {!configured ? (
          <>
            <div className="notice">
              Configure Supabase e ATLAS_OWNER_ID no servidor para habilitar a
              autenticação.
            </div>
            <Link className="button" href="/app/settings">
              Abrir configuração
            </Link>
          </>
        ) : step === "login" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const email = String(f.get("email") ?? "");
              try { if (remember) localStorage.setItem("atlas-email", email); else localStorage.removeItem("atlas-email"); } catch { /* storage blocked */ }
              void send({
                action: "login",
                email,
                password: f.get("password"),
                remember,
              });
            }}
          >
            <label>
              E-mail
              <input
                name="email"
                type="email"
                autoComplete="username"
                ref={emailField}
                required
              />
            </label>
            <label>Senha
              <span className="password-entry">
                <input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required />
                <button className="password-visibility" type="button" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
              </span>
            </label>
            <label className="remember-me">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Lembrar de mim por 30 dias neste aparelho
            </label>
            <button disabled={busy}>
              {busy ? "Verificando…" : "Continuar"}
            </button>
          </form>
        ) : step === "enroll" ? (
          <>
            <p>
              Cadastre o ATLAS em um aplicativo autenticador para proteger seu
              acesso.
            </p>
            <button
              disabled={busy}
              onClick={() => void send({ action: "enroll" })}
            >
              Cadastrar autenticador
            </button>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send({ action: "verify", factorId, code });
            }}
          >
            {secret && (
              <div className="notice">
                <p>
                  Adicione uma conta TOTP no seu autenticador e digite esta
                  chave. Ela aparece somente durante o cadastro.
                </p>
                <code className="totp-secret">{secret}</code>
              </div>
            )}
            <label>Código de 6 dígitos</label>
            <div className="totp-inputs" role="group" aria-label="Código do autenticador, seis dígitos">
              {Array.from({ length: 6 }, (_, index) => (
                <input key={index} ref={(element) => { codeFields.current[index] = element; }} type="text" inputMode="numeric" autoComplete={index === 0 ? "one-time-code" : "off"} aria-label={`Dígito ${index + 1}`} value={code[index] ?? ""} required
                  onChange={(event) => {
                    const digits = event.target.value.replace(/\D/g, "");
                    const chars = code.split("");
                    if (!digits) { chars[index] = ""; setCode(chars.join("")); return; }
                    for (let offset = 0; offset < digits.length && index + offset < 6; offset++) chars[index + offset] = digits[offset];
                    setCode(chars.join("").slice(0, 6));
                    codeFields.current[Math.min(index + digits.length, 5)]?.focus();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Backspace" && !code[index] && index > 0) codeFields.current[index - 1]?.focus();
                    if (event.key === "ArrowLeft" && index > 0) codeFields.current[index - 1]?.focus();
                    if (event.key === "ArrowRight" && index < 5) codeFields.current[index + 1]?.focus();
                  }}
                  onPaste={(event) => {
                    const digits = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
                    if (!digits) return;
                    event.preventDefault();
                    setCode(digits);
                    codeFields.current[Math.min(digits.length, 5)]?.focus();
                  }} />
              ))}
            </div>
            <button disabled={busy || code.length !== 6}>
              {busy ? "Verificando…" : "Entrar no ATLAS"}
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <small>
          Sem cadastro público. Somente o usuário definido pelo proprietário
          pode entrar.
        </small>
      </section>
    </main>
  );
}
