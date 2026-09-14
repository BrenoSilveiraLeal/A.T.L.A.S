"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="error-page"><h1>Não foi possível carregar o ATLAS.</h1><p>Verifique o serviço de autenticação e o banco. A execução permanece bloqueada.</p><button onClick={reset}>Tentar novamente</button></main>;
}
