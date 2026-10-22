<div align="center">

# Foucusly

### Focus deliberately. Finish consistently.

Um sistema local-first de foco para transformar ciclos Pomodoro em trabalho concluído.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111827)](https://react.dev/)
[![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)](https://fastify.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-local--first-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)

`Pomodoro` · `tarefas` · `projetos` · `relatórios` · `notificações`

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
- Modelos de tarefa para repetir fluxos frequentes.
- Perfis locais para manter dados separados no mesmo dispositivo.
- Timer persistente: recarregar a página não descarta o estado atual.
- Relatórios diários, semanais, mensais e anuais, com detalhes de sessão e rankings por projeto ou tarefa.
- Sons de alarme e ambiente, preferências visuais e modo escuro durante uma sessão.
- Notificações Web Push quando um timer termina, em navegadores e ambientes compatíveis.
- Interface responsiva, incluindo a rota simplificada `/app`.

## Arquitetura

```text
React + Vite (apps/web)
        │  /api + x-profile-id
        ▼
Fastify + Zod (apps/api)
        │
        ▼
SQLite + WAL (data/foucusly.sqlite)
```

O frontend React mantém a experiência ao vivo do timer e se comunica com uma API Fastify. A API valida entradas com Zod, protege os dados por perfil e persiste tudo em SQLite com WAL habilitado. Os contratos TypeScript compartilhados ficam em `packages/contracts`, evitando divergências entre interface e backend.

Para o mapa de componentes, modelo de dados, ciclo do timer, notificações e limites operacionais, veja [architecture.md](architecture.md). Para instruções de contribuição orientadas a agentes, veja [AGENTS.md](AGENTS.md).

## Comece em minutos

**Pré-requisito:** Node.js compatível com as dependências do projeto e npm.

```sh
git clone <seu-repositorio>
cd pomofocus
npm install
npm run dev
```

Abra [http://localhost:5173](http://localhost:5173) para a experiência completa ou [http://localhost:5173/app](http://localhost:5173/app) para a página do timer. A API inicia em `http://localhost:3001`.

O banco de dados é criado em `data/foucusly.sqlite` por padrão. Para usar outro caminho:

```sh
DATABASE_PATH=/caminho/para/foucusly.sqlite npm run dev:api
```

## Comandos

| Comando | Descrição |
| --- | --- |
| `npm run dev` | Inicia API e frontend em modo de desenvolvimento. |
| `npm run dev:api` | Inicia somente a API Fastify com recarregamento. |
| `npm run dev:web` | Inicia somente o Vite. |
| `npm run typecheck` | Verifica os tipos de todos os workspaces. |
| `npm run build` | Compila contratos, API e frontend. |
| `npm start` | Inicia a API compilada. |

## Produção

1. Execute `npm run build`.
2. Inicie a API com `npm start`.
3. Sirva `apps/web/dist` em um servidor estático.
4. Configure esse servidor para encaminhar `/api` à API Fastify.
5. Faça backup de `data/foucusly.sqlite`: ele é a fonte de verdade dos dados da instalação.

As variáveis de ambiente mais relevantes são `PORT`, `HOST`, `DATABASE_PATH`, `CORS_ORIGINS`, `TRUST_PROXY` e `PUSH_POLL_INTERVAL_MS`. As chaves VAPID para Web Push podem ser configuradas ou persistidas localmente pela API.

## Roadmap

O Foucusly já é útil como aplicação local. As próximas evoluções devem preservar essa simplicidade enquanto abrem portas para fluxos conectados:

- [ ] **Autenticação e contas** — login seguro, sessões e separação entre identidade e perfis locais.
- [ ] **Sincronização entre dispositivos** — manter timer, tarefas e histórico consistentes em mais de um dispositivo.
- [ ] **Webhooks** — emitir eventos de sessão iniciada, concluída e tarefa finalizada para automações externas.
- [ ] **Integrações** — conectar projetos e tarefas a ferramentas como calendário, Notion, Todoist ou Slack.
- [ ] **Exportação e backup guiado** — exportar sessões, relatórios e dados do usuário de forma simples.
- [ ] **PWA/offline aprimorado** — instalação no dispositivo e uma experiência resiliente sem conexão.
- [ ] **Relatórios avançados** — metas, tendências, comparações de períodos e insights de hábitos.

## Princípios

> **Foco sem atrito. Dados sob seu controle. Métricas que representam trabalho real.**

Foucusly não tenta ser uma plataforma de produtividade inchada. A ideia é manter o ciclo essencial — decidir, focar, pausar e aprender com o histórico — rápido e confiável.
