# Relatório de Segurança — Foucusly (apps/api + apps/web)

Data: 2026-10-22 · Escopo: monorepo `/Users/davixavier/Desktop/pomofocus` (Fastify 5 + better-sqlite3 + React/Vite)
Método: auditoria estática com base em `security-best-practices` (specs Express/Node + React). Nenhum scanner externo executado.

## Resumo executivo

A API está bem construída na camada de dados (SQL parametrizado, validação zod em todas as rotas, limite de body, IDs UUID), mas **não possui autenticação real, rate limit, CORS explícito nem restrição de interface de rede**. O pior cenário hoje: qualquer pessoa com acesso à rede da máquina que roda a API pode **listar todos os perfis e apagá-los junto com todas as tasks/sessões**, sem autenticação — perda de dados irreversível.

## Crítico

### SEC-001 — Endpoints de perfil públicos e destrutivos sem autenticação

**Impacto:** um atacante com acesso de rede apaga todos os perfis (tasks, sessões e relatórios) em segundos, sem credencial alguma.
- **Local:** `apps/api/src/routes/profiles.ts:9` (listagem), `:28-37` (delete)
- **Evidência:** `GET /api/profiles` é público (o hook `preHandler` em `apps/api/src/server.ts:56` pula `/api/profiles` e `/api/health`) e `DELETE /api/profiles/:id` também não exige o header `x-profile-id`. `deleteProfile` (db.ts:137-148) apaga **todas** as linhas do perfil.
- **Quem explora:** qualquer cliente HTTP que alcance a porta 3001.
- **Fix seguro:** exigir autenticação (ao menos o `x-profile-id` correspondente) para o delete; remover a listagem pública ou protegê-la; nunca devolver UUIDs de perfil sem necessidade.

## Alto

### SEC-002 — API escutando em `0.0.0.0` sem auth amplifica o SEC-001

- **Local:** `apps/api/src/index.ts:9` — `host: process.env.HOST ?? "0.0.0.0"`.
- **Impacto:** em rede local/oficina, qualquer dispositivo alcança a API; com o SEC-001, vira destruição de dados remota.
- **Fix:** default `127.0.0.1` em dev; `0.0.0.0` apenas com env explícita de deploy, atrás de proxy/runtime com auth.

### SEC-003 — `x-profile-id` é a única "autenticação" e é divulgada publicamente

- **Local:** `apps/api/src/server.ts:55-60`; furado por `profiles.ts:9` (GET público devolve todos os UUIDs).
- **Impacto:** o UUID de perfil funciona como bearer token de valor permanente; a listagem pública o entrega a qualquer um. Não há sessão, rotação, revogação ou segredo no servidor.
- **Fix:** tratar o id como credencial (não listá-lo), adicionar auth/sessão real antes de expor publicamente.

## Médio

### SEC-004 — Sem rate limiting (conhecido, confirmado em código)

- **Evidência:** nenhum `@fastify/rate-limit` em `apps/api/package.json`; nenhum throttle no servidor.
- **Impacto:** brute-force de usernames em `POST /api/profiles` (profiles.ts:11-26, com casamento `COLLATE NOCASE` → enumeração de nomes via 409), flood de escritas, DoS do SQLite.
- **Fix:** `@fastify/rate-limit` global + limites mais rígidos por IP em rotas de escrita. **Atenção:** se for limitar por IP atrás de proxy, configure `trustProxy` no Fastify primeiro, senão `X-Forwarded-For` falsificado bota o bypass.

### SEC-005 — CORS ausente (conhecido, confirmado)

- **Evidência:** nenhum `@fastify/cors` registrado (`app/api/package.json`, `server.ts`).
- **Nota honesta:** hoje a ausência de CORS é o default _seguro_ — o front usa proxy do Vite em desenvolvimento (`vite.config.ts:7`, same-origin) e o browser bloqueia chamadas cross-origin em runtime JS. O risco aparece quando o front for servido em outra origem em produção (aí precisa allowlist explícita, nunca `*` + cookies).
- **Fix:** registrar `@fastify/cors` com allowlist de origem via env (vazio = CORS desligado).

### SEC-006 — Escritas sem quota por perfil (abuso de armazenamento)

- **Evidência:** `POST /api/tasks` (server.ts:68) e `POST /api/sessions` (server.ts:180) não têm limite por perfil (templates têm o limite de 3; tasks não têm).
- **Impacto:** encher o arquivo SQLite (exaustão de disco) com requests repetidos — rate limit mitiga, quota aproxima.

### SEC-007 — Credencial de perfil persistida em `localStorage`

- **Evidência:** `apps/web/src/App.tsx:60,73` — `foucusly-profile-id`.
- **Impacto:** o UUID, que é o único fator de acesso ao backend, fica em storage legível por qualquer script; hoje não há sinks de XSS no front, mas um salvá-los bastaria para sequestro de perfil.
- **Fix de médio prazo:** sessão real (cookie HttpOnly) ou, no mínimo, consciência de que o localStorage acopla-se à postura de XSS do front.

## Baixo

### SEC-008 — Sem headers de segurança no shell web

- **Evidência:** `apps/web/index.html` sem CSP/Fastify headers; nenhum header configurado no repo — **verificar na borda/proxy de produção** (pode existir lá sem estar visível aqui).

### SEC-009 — Observações menores

- Logger `Fastify({ logger: true })` (server.ts:47) em produção pode vazar PII em logs — revisar serializers antes de deploy público.
- `trust proxy` não configurado — obrigatório acertar quando rate limit por IP existir atrás de Nginx/CDN.

## Práticas que estão corretas (verificadas)

- ✅ SQL 100% parametrizado (`db.prepare(...).run(...)` em todos os arquivos) — sem SQLi
- ✅ zod validando corpo/params/query em todas as rotas — sem type confusion
- ✅ `bodyLimit: 1_000_000` (server.ts:47) — limite de body presente
- ✅ IDs UUID v4, não auto-incremento exposto
- ✅ Erros 500 genéricos ("Internal server error"), detalhes só no log do servidor
- ✅ `data/` no .gitignore — sem banco comitado
- ✅ Front sem `dangerouslySetInnerHTML`, `eval`, scripts de terceiros ou `postMessage`

## Ordem de correção sugerida

1. **SEC-001 + SEC-002** (1h) — proteger delete de perfil, fechar listagem, `HOST` default `127.0.0.1`
2. **SEC-004 + SEC-005** (0,5–1 dia) — `@fastify/rate-limit` + `@fastify/cors` com allowlist
3. **SEC-003/006/007** — decisão de produto (auth real, quotas) antes de qualquer exposição pública
