# NTX Expedição — Guia de Publicação no Cloudflare

## O que foi gerado
| Arquivo | Onde vai |
|---|---|
| `worker-ntx-expedicao.js` | Cloudflare Workers (novo Worker) |
| `ntx-expedicao.html` | Cloudflare Pages → nortexcontrol.pages.dev |

---

## PASSO 1 — Criar o Cloudflare Worker

1. Acesse **workers.cloudflare.com** → "Create Worker"
2. Nomeie: `ntx-expedicao-api`
3. Clique em **Edit code** e **cole o conteúdo** de `worker-ntx-expedicao.js`
4. Clique **Save and Deploy**
5. Anote a URL gerada (ex: `https://ntx-expedicao-api.SEU-SUBDOMINIO.workers.dev`)

---

## PASSO 2 — Configurar os Secrets do Worker

No painel do Worker recém-criado → **Settings → Variables → Secrets**:

| Nome da variável | Valor |
|---|---|
| `GOOGLE_SA_EMAIL` | E-mail da Service Account (igual aos outros painéis Nortex) |
| `GOOGLE_PRIVATE_KEY` | Chave privada PEM completa (igual aos outros painéis) |

> Se já usa Service Account nos outros apps (Coletores, Pesagem, Materiais),
> use as **mesmas credenciais** — só precisa dar permissão à planilha
> `1AGUT3jyD1KH3H1UmCTfQjYxzQQoSJgjJBB_Ueu5uu30` para o e-mail da SA.

---

## PASSO 3 — Editar o HTML e configurar a URL

No arquivo `ntx-expedicao.html`, na **primeira linha do script**, troque:

```javascript
var API_BASE = 'https://SEU_WORKER_AQUI.workers.dev';
```
pela URL real do Worker que você criou no Passo 1.

---

## PASSO 4 — Publicar o HTML no Cloudflare Pages

1. Acesse o projeto **nortexcontrol** no Cloudflare Pages
2. Vá em **Uploads** (ou arraste o arquivo)
3. Faça upload de `ntx-expedicao.html`
4. Acesse: `https://nortexcontrol.pages.dev/ntx-expedicao.html`

---

## PASSO 5 — Testar

- Abrir a página → deve mostrar os dados da planilha em segundos
- Inserir uma nota → confirmar que aparece na aba "Controle de coletas NTX"
- Importar planilha → testar com um arquivo Excel de teste
- Gerar e-mail de coleta → selecionar uma transportadora

---

## Rotas do Worker (referência)
```
GET  /dados              Carrega todos os registros + resumo
GET  /transportadoras    Lista transportadoras com pendências
POST /inserir            { data: {nf,emissao,cliente,...} }
POST /atualizar          { nf, campos: {...} }
POST /importar           { notas: [...] }
POST /email-coleta       { transportadora: "LEITE EXPRESS" }
POST /marcar-coleta      { nfs: ["64278","64393"] }
POST /reabrir-coleta     { nfs: ["64278"] }
```
