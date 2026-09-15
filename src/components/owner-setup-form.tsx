"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";

export function OwnerSetupForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const tokenHash = useRef("");
  const initialized = useRef(false);
  const [linkState, setLinkState] = useState<"loading" | "ready" | "missing" | "used">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const candidate = fragment.get("token_hash") ?? "";
    tokenHash.current = /^[A-Za-z0-9_-]{32,512}$/.test(candidate) ? candidate : "";
    // The fragment never reaches the server. Remove it from the visible URL/history immediately.
    window.history.replaceState(window.history.state, "", window.location.pathname);
    queueMicrotask(() => setLinkState(tokenHash.current ? "ready" : "missing"));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !tokenHash.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    let password = String(fields.get("password") ?? "");
    if (password !== fields.get("confirmation")) {
      setError("As senhas precisam ser iguais.");
      return;
    }
    if (password.length > 128 || password.trim().length < 14) {
      setError("Use uma senha de 14 a 128 caracteres.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        body: JSON.stringify({ tokenHash: tokenHash.current, password }),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true || result.next !== "login") {
        setError(typeof result.error === "string" ? result.error : "Não foi possível concluir o primeiro acesso. Gere um novo link.");
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch {
      setError("A conexão foi interrompida. Tente entrar com a senha escolhida; se ela não funcionar, gere um novo link de primeiro acesso.");
    } finally {
      tokenHash.current = "";
      password = "";
      fields.delete("password");
      fields.delete("confirmation");
      form.reset();
      setLinkState("used");
      setBusy(false);
    }
  }

  return (
    <main className="login-screen">
      <Link className="brand" href="/login"><span className="brand-mark">A</span>ATLAS</Link>
      <section className="login-panel">
        <ShieldCheck size={32} aria-hidden="true" />
        <h1>Crie sua senha de acesso</h1>
        <p>Depois, entre com seu e-mail e cadastre seu aplicativo autenticador.</p>
        {!configured ? (
          <div className="notice">A configuração do servidor ainda está pendente.</div>
        ) : linkState === "loading" ? (
          <p role="status">Preparando o primeiro acesso…</p>
        ) : linkState === "missing" ? (
          <div className="notice">Abra o link completo de primeiro acesso gerado para o proprietário. Ele é de uso único.</div>
        ) : linkState === "used" ? (
          <div className="notice">Este envio foi encerrado. Para uma nova tentativa, abra um novo link de primeiro acesso.</div>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <label>Nova senha
              <input name="password" type="password" minLength={14} maxLength={128} autoComplete="new-password" aria-describedby="password-help" disabled={busy} required />
            </label>
            <small id="password-help">De 14 a 128 caracteres. Prefira uma frase longa e exclusiva para o ATLAS.</small>
            <label>Confirmar nova senha
              <input name="confirmation" type="password" minLength={14} maxLength={128} autoComplete="new-password" disabled={busy} required />
            </label>
            <button disabled={busy}>{busy ? "Definindo senha…" : "Criar senha e continuar"}</button>
          </form>
        )}
        {error && <p className="error-text" role="alert">{error}</p>}
        <Link href="/login">Ir para o login</Link>
        <small>A senha é definida nesta página. Não a envie por mensagem.</small>
      </section>
    </main>
  );
}
