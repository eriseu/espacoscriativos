# Plataforma de Espaços Compartilhados

Uma plataforma SaaS modular para gerenciar espaços físicos compartilhados como estúdios criativos, quintais culturais, cozinhas, salas terapêuticas e hubs comunitários.

Implantação inicial: Quintal Gonza.

A plataforma foi desenhada para escalar para uma rede de espaços compartilhados.

---

# Conceito Central

Usuários compram créditos.

Créditos são usados para reservar horários nos espaços.

Exemplo:

200 BRL = 10 créditos
1 crédito = 1 hora de uso

Os créditos ficam armazenados em uma carteira e são consumidos automaticamente quando reservas são feitas.

---

# Arquitetura do Sistema

A plataforma segue uma arquitetura modular.

Componentes principais:

Frontend
API
Banco de dados
Automação
Mensageria
Gateway de pagamento

A infraestrutura é baseada em containers.

---

# Stack de Infraestrutura

Proxy reverso
Nginx

Backend
Node.js ou Laravel

Banco de dados
PostgreSQL

Cache
Redis

Automação
n8n

Mensageria
Evolution API

Interface administrativa
Appsmith / ToolJet

Deploy
Containers Docker

---

# Módulos Principais

## Usuários

Contas de usuário com papéis.

Papéis:

admin
space manager
professional
volunteer
customer

---

## Organizações

Cada organização representa um operador de espaço.

Exemplo:

Quintal Gonza

A arquitetura multi-tenant garante isolamento de dados.

---

## Espaços

Uma área física disponível para reserva.

Atributos de exemplo:

name
location
capacity
available_hours

---

## Reservas

Horários reservados por usuários.

Campos:

space_id
user_id
start_time
end_time
credits_consumed
status

---

## Carteira de Créditos

Usuários mantêm um saldo de créditos.

Créditos são adicionados via pagamentos e consumidos via reservas.

---

## Transações de Crédito

Histórico de transações de uso de créditos.

Exemplos:

credit_purchase
reservation_usage
volunteer_reward
manual_adjustment

---

# Integração de Pagamentos

Provedores suportados:

Stripe
Mercado Pago
Pagar.me

Fluxo:

Usuário compra créditos
Gateway de pagamento processa a transação
Webhook confirma o pagamento
Créditos são adicionados à carteira

---

# Automação

O n8n lida com fluxos como:

confirmação de pagamento
lembretes de reserva
notificações de eventos
alertas de crédito

---

# Integração com WhatsApp

A Evolution API fornece mensageria WhatsApp.

Comandos de exemplo:

saldo
agenda hoje
reservar 18:00

Automação via workflows no n8n.

---

# Roadmap

## Fase 1

MVP para Quintal Gonza.

Funcionalidades:

usuários
espaços
reservas
carteira de créditos
integração de pagamentos
dashboard administrativo básico

---

## Fase 2

Expansão da plataforma.

Funcionalidades:

módulo de eventos
sistema de voluntariado
painel de analytics
gestão multi-espaços

---

## Fase 3

Ecossistema de marketplace.

Funcionalidades:

descoberta de espaços
perfis profissionais
reviews e reputação
aplicativo móvel
API pública

---

# Deploy

Serviços rodam em containers Docker.

Layout recomendado de serviços:

nginx
api
postgres
redis
n8n
evolution-api
admin-panel

---

# Visão de Longo Prazo

Uma rede descentralizada de espaços criativos onde profissionais podem:

oferecer workshops
rodar eventos
dar aulas
construir comunidades

A plataforma se torna a infraestrutura que conecta espaços, profissionais e participantes.

---

# MVP WhatsApp (Fase 0)

Objetivo: validar o produto usando primeiro o WhatsApp.

Comandos principais:

saldo
agenda hoje
reservar HH:MM
credito <telefone> <quantidade> (admin)
saldo <telefone> (admin)

---

# Setup Local (API + Postgres)

1. Copiar arquivo de ambiente

```bash
cp .env.example .env
```

2. Subir serviços

```bash
docker compose up -d
```

3. Rodar migrations

```bash
npm run migrate
```

4. Popular dados de demo

```bash
npm run seed
```

Use o ORG_ID e o SPACE_ID impressos para integrar com os workflows do n8n.

---

# WhatsApp API (n8n -> API)

Endpoint:

POST /whatsapp/handle

Exemplo de payload:

```json
{
  "organization_id": "ORG_UUID",
  "phone": "559999999999",
  "text": "saldo",
  "space_id": "SPACE_UUID",
  "today": "2026-03-12"
}
```

Se `organization_id` não for informado, a API usa `ORG_DEFAULT_ID` do `.env`.

Variáveis adicionais:

ADMIN_PHONE (somente este número pode usar o comando `credito`)

---

# Integração n8n + Evolution (Resumo)

Fluxo recomendado:

Webhook (Evolution) -> n8n -> API -> resposta -> Evolution

Campos mínimos esperados pela API:

phone (ex: 559999999999)
text (comando do usuário)
organization_id (UUID) ou use ORG_DEFAULT_ID

Sugestão de mapeamento no n8n:

1. Receber payload do Evolution
2. Normalizar telefone (remover símbolos)
3. Extrair mensagem de texto
4. Chamar POST /whatsapp/handle
5. Enviar reply de volta via Evolution

Resposta da API:

reply (texto pronto para o WhatsApp)
