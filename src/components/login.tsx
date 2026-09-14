"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";

export function Login({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState("login"),
    [factorId, setFactorId] = useState("");
  const [secret, setSecret] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
              void send({
                action: "login",
                email: f.get("email"),
                password: f.get("password"),
              });
            }}
          >
            <label>
              E-mail
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </label>
            <label>
              Senha
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
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
              const f = new FormData(e.currentTarget);
              void send({ action: "verify", factorId, code: f.get("code") });
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
            <label>
              Código de 6 dígitos
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
              />
            </label>
            <button disabled={busy}>
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
