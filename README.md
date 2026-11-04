<div align="center">

<img src="apps/web/src/assets/logo.png" alt="Foucusly" width="120" height="120" />

# Foucusly

### Focus deliberately. Finish consistently.

Um sistema local-first de foco para transformar ciclos Pomodoro em trabalho concluído.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111827)](https://react.dev/)
[![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)](https://fastify.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-local--first-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)

`Pomodoro` · `tarefas` · `projetos` · `relatórios` · `notificações` · `webhooks`

</div>

---

## O que é

Foucusly é um aplicativo de foco baseado na técnica Pomodoro. Ele reúne o ciclo de trabalho em um único fluxo: escolha uma tarefa, inicie uma sessão de foco, faça pausas intencionais e acompanhe o que realmente foi concluído.

O app foi pensado para funcionar localmente. Seus perfis, tarefas, projetos, configurações, estado do timer e histórico de sessões ficam em uma base SQLite controlada pela sua instalação — sem depender de login ou de um serviço externo para começar.

> **Perfis não são autenticação.** Eles separam dados locais no mesmo app; autenticação de contas faz parte do roadmap.

## Como funciona

```text
Escolha um perfil
      ↓
Crie um projeto e suas tarefas
      ↓
Inicie um Pomodoro em uma tarefa
      ↓
Conclua o ciclo → a sessão é registrada
      ↓
Faça uma pausa curta ou longa
      ↓
Consulte relatórios, sequência e rankings
```

Cada perfil pode configurar a duração do Pomodoro, das pausas curtas e longas, o intervalo da pausa longa, início automático, sons, tema, ordem das tarefas e comportamento de conclusão automática.

Quando uma sessão de foco termina, o Foucusly registra um histórico idempotente, atualiza o progresso da tarefa relacionada e, se configurado, a conclui ou move para o fim da lista. Os relatórios usam essas sessões concluídas como fonte de verdade.

## Recursos atuais

- Ciclos de Pomodoro, pausa curta e pausa longa, com início automático opcional.
- Projetos persistentes, cores, arquivamento/restauração e tarefas com estimativa de Pomodoros.
- Perfis locais para manter dados separados no mesmo dispositivo.
- Timer persistente: recarregar a página não descarta o estado atual.
- Relatórios diários, semanais, mensais e anuais, com detalhes de sessão e rankings por projeto ou tarefa.
- Sons de alarme e ambiente, preferências visuais e modo escuro durante uma sessão.
- Notificações Web Push quando um timer termina e um lembrete opcional minutos antes do fim, em navegadores e ambientes compatíveis.
- Webhooks de saída opcionais para sessão concluída e tarefa concluída, com ping de teste.
- Interface responsiva, incluindo a rota simplificada `/app`.

## Arquitetura

```text
React + Vite (apps/web)
        │  /api + Authorization: Bearer
        ▼
Fastify + Zod (apps/api)
        │
        ▼
SQLite + WAL (data/foucusly.sqlite)
```

O frontend React mantém a experiência ao vivo do timer e se comunica com uma API Fastify. A API valida entradas com Zod, protege os dados por perfil e persiste tudo em SQLite com WAL habilitado. Os contratos TypeScript compartilhados ficam em `packages/contracts`, evitando divergências entre interface e backend.

Para o mapa de componentes, modelo de dados, ciclo do timer, notificações e limites operacionais, veja [architecture.md](architecture.md). Para instruções de contribuição orientadas a agentes, veja [AGENTS.md](AGENTS.md).

## Entrega contínua

```mermaid
flowchart LR
    PR["Pull Request"] --> CI["GitHub Actions<br/>typecheck · testes · build"]
    CI -->|"merge em main"| GHCR["GHCR<br/>imagens sha-commit"]
    GHCR --> API["Coolify API"]
    GHCR --> WEB["Coolify Web"]
    API --> Smoke["Smoke tests<br/>health + versão"]
    WEB --> Smoke
    Smoke -->|"SHA esperado"| Production["Produção<br/>tag production"]
    Smoke -->|"falha"| Rollback["Restaurar última<br/>release saudável"]
    Rollback --> API
    Rollback --> WEB
```

Cada release usa imagens imutáveis identificadas pelo SHA do commit. O deploy só é considerado concluído quando API e web servem a versão esperada; uma falha restaura a última release saudável, sem alterar os dados persistentes em SQLite.

Para empacotamento, CI/CD, deploy no Coolify e recuperação de releases, veja o [guia de CI/CD](docs/ci-cd.md).

## Comece em minutos

**Pré-requisito:** [Bun](https://bun.com) 1.3+ para dependências e scripts, e Node.js 22+ como runtime da API.

```sh
git clone https://github.com/daviixs/foucusly.git
cd pomofocus
bun install
bun run dev
```

Abra [http://localhost:5173](http://localhost:5173) para a experiência completa ou [http://localhost:5173/app](http://localhost:5173/app) para a página do timer. A API inicia em `http://localhost:3001`.

O banco de dados é criado em `data/foucusly.sqlite` por padrão. Para usar outro caminho:

```sh
DATABASE_PATH=/caminho/para/foucusly.sqlite bun run dev:api
```

## Comandos

| Comando | Descrição |
| --- | --- |
| `bun run dev` | Inicia API e frontend em modo de desenvolvimento. |
| `bun run dev:api` | Inicia somente a API Fastify com recarregamento. |
| `bun run dev:web` | Inicia somente o Vite. |
| `bun run typecheck` | Verifica os tipos de todos os workspaces. |
| `bun run build` | Compila contratos, API e frontend. |
| `bun run start` | Inicia a API compilada. |

## Produção

1. Execute `bun run build`.
2. Inicie a API com `bun run start`.
3. Sirva `apps/web/dist` em um servidor estático.
4. Configure esse servidor para encaminhar `/api` à API Fastify.
5. Faça backup de `data/foucusly.sqlite`: ele é a fonte de verdade dos dados da instalação.

As variáveis de ambiente mais relevantes são `PORT`, `HOST`, `DATABASE_PATH`, `AUTH_SECRET`, `CORS_ORIGINS`, `TRUST_PROXY`, `SIGNUP_LIMIT_PER_IP`, `SIGNUP_WINDOW_HOURS`, `TURNSTILE_SECRET_KEY` e `PUSH_POLL_INTERVAL_MS`. As chaves VAPID para Web Push podem ser configuradas ou persistidas localmente pela API.

### Variáveis de ambiente

| Variável | Onde | Descrição |
| --- | --- | --- |
| `VITE_API_URL` | build do web | URL pública da API, sem `/api` no final (ex.: `https://api.seudominio.com`). Vazia = mesma origem (comportamento atual; em dev o proxy do Vite encaminha `/api` para `localhost:3001`). |
| `VITE_BASE` | build do web | Caminho base do site. Padrão `/`. No Pages de projeto use `/foucusly/`. |
| `AUTH_SECRET` | API | **Obrigatória em produção** (a API não sobe sem ela com `NODE_ENV=production`). Segredo HMAC (≥ 32 caracteres) para assinar os tokens de login (validade 30 dias). Gere com `openssl rand -hex 32`. Trocar o valor desloga todo mundo. |
| `CORS_ORIGINS` | API | Origens permitidas, separadas por vírgula (ex.: `https://daviixs.github.io`). Vazia = sem CORS (apenas mesma origem). Permite os headers `Content-Type`, `Authorization` e os métodos `GET POST PUT PATCH DELETE OPTIONS`. |
| `TRUST_PROXY` | API | `trustProxy` do Fastify: `true`/`false` ou lista de IPs/CIDRs dos proxies confiáveis. Vazia = `true` em produção (a API roda atrás do Traefik/Coolify), `false` fora dela. Necessário para `request.ip` ser o IP real do cliente. |
| `SIGNUP_LIMIT_PER_IP` | API | Máximo de contas criadas com sucesso por IP dentro da janela. Padrão `1`; `0` desativa. |
| `SIGNUP_WINDOW_HOURS` | API | Janela do limite acima, em horas. Padrão `24`. |
| `SIGNUP_IP_SALT` | API | Opcional. Salt do hash SHA-256 dos IPs (padrão: `AUTH_SECRET`). IPs nunca são gravados em texto puro. |
| `TURNSTILE_SECRET_KEY` | API | Opcional. Chave secreta do Cloudflare Turnstile; quando definida, o cadastro exige `turnstileToken` válido (falha → 400 `Captcha verification failed`). |
| `VITE_TURNSTILE_SITE_KEY` | build do web | Opcional. Site key pública do Turnstile; exibe o widget em "Create account". No Pages vem de `vars.VITE_TURNSTILE_SITE_KEY`. |

## Autenticação

Cada perfil tem usuário e senha. `POST /api/auth/register` e `POST /api/auth/login` (`{ username, password }`, senha ≥ 8 caracteres) devolvem `{ token, profile }`. O token (HMAC-SHA256, estilo JWT, 30 dias) vai em `Authorization: Bearer <token>` em todas as chamadas; só `/api/health`, `/api/version` e `/api/auth/*` são públicas. Senhas são guardadas com scrypt (salt aleatório). Não existe mais listagem pública de perfis.

**Limites de cadastro:** login aceita 10 tentativas/min por IP; cadastro aceita 3 tentativas/hora por IP e no máximo `SIGNUP_LIMIT_PER_IP` (padrão 1) conta criada com sucesso por IP a cada `SIGNUP_WINDOW_HOURS` (padrão 24 h), persistido no SQLite (tabela `signup_ips`, só hash do IP). Acima do limite a API responde 429 `Too many accounts created from this network. Try again later.` Com `TURNSTILE_SECRET_KEY`/`VITE_TURNSTILE_SITE_KEY` o cadastro também exige o captcha do Cloudflare Turnstile.

**Perfis antigos (sem senha):** o primeiro login com o nome de usuário de um perfil antigo define a senha informada e "reivindica" o perfil. Depois disso só essa senha funciona. Recomenda-se que os donos façam login logo após o deploy.

## Webhooks

Webhooks de saída fazem parte do app, sem paywall. Em **Settings → Integration**, cole uma URL, ative o envio, escolha os eventos e salve com **OK**. Uma URL vazia deixa o recurso desligado.

O Foucusly faz `POST` de um JSON versão 1, com timeout de 4 segundos e uma nova tentativa se a resposta for 5xx ou se o tempo estourar. Falha de entrega não desfaz a sessão nem a tarefa. O último erro fica em `webhookLastError` nas configurações do perfil. O `session_id` permite ao receptor ignorar uma segunda tentativa do mesmo evento.

HTTPS é obrigatório. `http://localhost` e `http://127.0.0.1` (e o bloco de loopback) valem só para teste local. Endereços privados, link-local e respostas DNS que apontem para eles são recusados. Redirecionamentos não são seguidos.

Se o segredo estiver preenchido, cada requisição inclui `X-Foucusly-Signature: sha256=<hex>`, o HMAC-SHA256 do corpo bruto em UTF-8. Sem segredo, o cabeçalho não vai. Não há header `Authorization: Bearer`.

Eventos ao vivo: `session.finished` (somente insert novo em `POST /api/sessions`; repetir o mesmo id não dispara) e `task.completed` (quando a tarefa passa a concluída, no check automático ou no patch manual). O botão **Test** envia `ping` e mostra o resultado, mesmo antes de ativar os eventos.

Corpo: `{ event, timestamp, profileId, data }`. `session.finished` traz (estilo Pomofocus) `type` (`focus`/`short-break`/`long-break`), `round`, `task`, `project`, `session_start`, `session_end`, `seconds`, além de `session_id`, `task_id` e `project_id`. Com token configurado é enviado `Authorization: Bearer <token>`. `task.completed` traz `task_id`, `task_title`, `project_id`, `project_name`, `estimated_pomos` e `completed_pomos`.

## Roadmap

O Foucusly já é útil como aplicação local. As próximas evoluções devem preservar essa simplicidade enquanto abrem portas para fluxos conectados:

- [x] **Webhooks de saída** — `session.finished` e `task.completed` para uma URL do perfil, com ping de teste. Sessão iniciada, pausa, fila de entregas e vários destinos ficam para depois.
- [x] **Relatórios avançados** — metas, tendências, comparações de períodos e insights de hábitos.
- [ ] **Autenticação e contas** — login seguro, sessões e separação entre identidade e perfis locais.
- [ ] **Sincronização entre dispositivos** — manter timer, tarefas e histórico consistentes em mais de um dispositivo.
- [ ] **Integrações** — conectar projetos e tarefas a ferramentas como calendário, Notion, Todoist ou Slack.
- [ ] **Exportação e backup guiado** — exportar sessões, relatórios e dados do usuário de forma simples.
