# Appsmith Admin (MVP)

Objetivo: painel simples para o admin gerenciar espaços e créditos.

## Variáveis no Appsmith

Crie variáveis (Appsmith -> App Settings -> Variables):

- API_BASE_URL (ex: https://seu-dominio/api ou http://espacos_api:3000)
- ORG_ID (UUID da organização)

## Endpoints necessários

1. Listar espaços

GET {{API_BASE_URL}}/admin/spaces?organization_id={{ORG_ID}}

2. Criar espaço

POST {{API_BASE_URL}}/admin/spaces

Body (JSON):

{
  "organization_id": "{{ORG_ID}}",
  "name": "{{InputName.text}}",
  "location": "{{InputLocation.text}}",
  "capacity": {{Number(InputCapacity.text)}},
  "available_start": "{{InputStart.text}}",
  "available_end": "{{InputEnd.text}}"
}

3. Ajustar crédito

POST {{API_BASE_URL}}/admin/credits/adjust

Body (JSON):

{
  "organization_id": "{{ORG_ID}}",
  "phone": "{{InputPhone.text}}",
  "amount": {{Number(InputAmount.text)}},
  "reason": "{{InputReason.text}}"
}

## UI sugerida

- TableSpaces (Table) -> datasource: query Listar espaços
- FormCriarEspaco (Inputs + Button "Criar") -> action: POST criar espaço -> refresh tabela
- FormCredito (Inputs + Button "Aplicar crédito") -> action: POST credits/adjust

## Notas

- Use o token de autenticação (quando existir). Por enquanto, admin é controlado no WhatsApp.
- Depois, podemos adicionar autenticação simples por header.
