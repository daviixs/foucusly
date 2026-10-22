# CI/CD de produção

Este guia define a entrega contínua do Foucusly em um VPS com Coolify. O pipeline separa validação, criação de artefatos e publicação: o GitHub Actions constrói imagens imutáveis no GitHub Container Registry (GHCR) e o Coolify apenas as executa.

```text
Pull Request → verificação → merge em main → GHCR
                                              ↓
                                    Coolify: API + Web
                                              ↓
                               health + versão por HTTP
                                      ↙                 ↘
                                sucesso              rollback
```

## Garantias e limites

- Todo deploy de produção usa as imagens `sha-<commit>`, nunca `latest`.
- A tag Git `production` aponta para a última versão que passou pelos smoke tests. Somente o workflow a atualiza.
- O workflow só declara sucesso quando API e web respondem o SHA esperado.
- Rollback restaura imagens; não desfaz alterações de SQLite nem recupera dados. Mantenha alterações de banco compatíveis com a release anterior.
- O banco SQLite é montado no VPS em volume persistente e deve receber snapshot diário do VPS. Teste a restauração antes de depender dela em produção.

## Arquitetura de runtime

| Recurso Coolify | Imagem GHCR | Porta | Domínio | Health check |
| --- | --- | --- | --- | --- |
| API | `ghcr.io/<owner>/foucusly-api:sha-<commit>` | `3001` | `api.seudominio.js.org` | `/api/health` |
| Web | `ghcr.io/<owner>/foucusly-web:sha-<commit>` | `80` | `app.seudominio.js.org` | `/health` |

A API deve receber estas variáveis no Coolify:

```text
HOST=0.0.0.0
DATABASE_PATH=/app/data/foucusly.sqlite
CORS_ORIGINS=https://app.seudominio.js.org
```

Crie um armazenamento persistente no recurso da API para `/app/data`. Não monte banco de dados no recurso web e não deixe o arquivo SQLite apenas na camada da imagem.

O frontend recebe `VITE_API_URL` durante o build da imagem. Em produção ela deve ser `https://api.seudominio.js.org`; localmente, quando não definida, a aplicação continua usando o proxy relativo `/api` do Vite.

## Configuração inicial do Coolify

1. Crie duas aplicações do tipo **Docker Image**, sem conexão Git: uma para a API e outra para a web.
2. Configure a credencial de leitura do GHCR no Coolify e mantenha os pacotes privados.
3. Defina as portas, domínios, health checks e volume descritos acima.
4. Desative deploy automático por Git; o GitHub Actions é o único iniciador de deploy.
5. Configure retenção suficiente no GHCR para manter releases SHA recentes.
6. Habilite a API do Coolify e crie um token com permissão apenas para atualizar/deployar as duas aplicações.

O Coolify precisa alcançar processos em `0.0.0.0`, e uma solicitação de deploy somente entra na fila: saúde deve ser verificada depois. Consulte a documentação de [Docker Image](https://coolify.io/docs/applications/deployments/docker-image), [health checks](https://coolify.io/docs/applications/configuration/health-checks) e [webhooks/deploy](https://coolify.io/docs/core/automation/deploy-webhooks).

## GitHub Actions

O workflow está em [`.github/workflows/ci-cd.yml`](../.github/workflows/ci-cd.yml).

### Em Pull Requests

O job `Verify` executa, na ordem:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Os testes existentes da API usam SQLite em memória. Não há serviço externo de banco no CI.

### Após merge em `main`

1. As imagens da API e da web são construídas a partir da raiz do monorepo e publicadas no GHCR com `sha-$GITHUB_SHA`.
2. O workflow atualiza a tag de imagem dos dois recursos por `PATCH /api/v1/applications/{uuid}` e solicita o deploy ao Coolify.
3. Durante até seis minutos, consulta `/api/health`, `/api/version`, `/health` e `/version.json`.
4. Se os dois SHA coincidirem, move a tag Git `production`.
5. Se falhar e houver baseline, restaura as duas aplicações para `sha-<production>` e confirma a recuperação por HTTP.

O Coolify expõe tanto a atualização de `docker_registry_image_tag` quanto o rollback de imagens; o workflow usa a primeira opção porque o tag SHA existe no GHCR e não depende da retenção local do servidor. [API de atualização](https://coolify.io/docs/api/endpoints/applications/update-application-by-uuid), [API de rollback](https://coolify.io/docs/api/endpoints/applications/rollback-application-by-uuid).

## Secrets e variables

Crie o environment GitHub `production` para os secrets de deploy e registre as URLs como variables no nível do repositório (elas também são necessárias durante o build da imagem web):

| Tipo | Nome | Valor |
| --- | --- | --- |
| Secret no environment `production` | `COOLIFY_API_URL` | URL do painel Coolify, sem `/api/v1` |
| Secret no environment `production` | `COOLIFY_TOKEN` | Token limitado à API/deploy das aplicações |
| Secret no environment `production` | `COOLIFY_API_UUID` | UUID do recurso da API |
| Secret no environment `production` | `COOLIFY_WEB_UUID` | UUID do recurso web |
| Variable do repositório | `PUBLIC_API_URL` | Ex.: `https://api.seudominio.js.org` |
| Variable do repositório | `PUBLIC_WEB_URL` | Ex.: `https://app.seudominio.js.org` |

O `GITHUB_TOKEN` publica no GHCR automaticamente. Em Settings → Actions, permita leitura e escrita de workflows para que a tag `production` possa ser atualizada. Proteja `main`: PR obrigatório, checks `Verify` obrigatórios, sem force push e sem secrets de produção em workflows de PR.

## Primeira publicação e recuperação

1. Configure o Coolify e faça deploy manual de uma imagem conhecida para validar domínio, HTTPS, volume SQLite e health checks.
2. Configure secrets/variables e abra um PR pequeno para confirmar a CI.
3. Faça merge; o primeiro deploy saudável cria a tag `production`.
4. Simule uma imagem com `/api/version` incompatível em ambiente seguro para validar que o workflow detecta a falha.
5. Confirme que a imagem anterior volta a responder nos dois domínios.

No primeiro deploy não existe baseline: se ele falhar, a recuperação é manual. Use os logs de deployment do Coolify e o histórico GHCR para selecionar uma imagem. Um rollback de código não recupera alterações persistentes; restaure o snapshot diário do VPS somente quando a recuperação de dados também for necessária.
